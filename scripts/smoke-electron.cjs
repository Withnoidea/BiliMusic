// Deterministic real-Electron smoke test. Uses a fresh profile and silent audio, never user data.
const { app, session, net, BrowserWindow, globalShortcut, dialog, shell, screen, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const http = require('node:http')
const root = path.resolve(__dirname, '..')
const packaged = process.argv.includes('--packaged')
const releaseDir = process.argv.find(arg => arg.startsWith('--release-dir='))?.slice('--release-dir='.length) || 'release'
const output = path.join(root, 'artifacts', process.argv.includes('--upgrade') ? (packaged ? 'qa-upgrade-packaged' : 'qa-upgrade') : packaged ? 'qa-packaged' : 'qa')
fs.mkdirSync(output, { recursive: true })
// Importing main.js into the test Electron host does not bootstrap package metadata.
const testedPackage = require(path.join(root, packaged ? `${releaseDir}/win-unpacked/resources/app.asar/package.json` : 'package.json'))
app.getVersion = () => testedPackage.version
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('appData', profile)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const silent = fs.readFileSync(path.join(root, 'tests/fixtures/silence.m4a'))
let playRequests = 0, dataSource = false, failures = [], apiRequests = [], qrScanned = false
let qrMode = 'expired', qrGenerated = 0, qrUpstreamPolls = 0, qrCookieHeaderEntries = 0
const qrPollsPerKey = new Map()
// Real Chromium HTTP response, not a JS Response mock: Electron coalesces these headers.
const loginServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const key = url.searchParams.get('qrcode_key')
  const count = (qrPollsPerKey.get(key) || 0) + 1
  qrPollsPerKey.set(key, count)
  qrUpstreamPolls++
  const code = qrMode === 'expired' || count > 2 ? 86038 : count === 1 ? 86090 : 0
  if (code === 0) {
    qrScanned = true
    res.setHeader('Set-Cookie', [
      'DedeUserID=123; Domain=.bilibili.com; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT',
      'SESSDATA=qa-session%2F==; Domain=.bilibili.com; Path=/; Max-Age=86400; HttpOnly; Secure',
      'bili_jct=qa-csrf; Domain=.bilibili.com; Path=/; Max-Age=86400',
    ])
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ code: 0, data: { code, url: '' } }))
})
const loginServerReady = new Promise(resolve => loginServer.listen(0, '127.0.0.1', resolve))
const originalFetch = net.fetch.bind(net)
let updateMode = 'missing'
const updateRequests = [], externalUrls = []
shell.openExternal = async url => { externalUrls.push(url) }
net.fetch = async (url, options) => {
  const address = String(url)
  if (address.startsWith('https://test.bilivideo.com/')) return new Response(silent, { headers: { 'content-type': 'audio/mp4', 'content-length': String(silent.length) } })
  if (address.startsWith('https://github.com/') || address.startsWith('https://api.github.com/')) {
    updateRequests.push(address)
    assert.ok(address.includes('/Withnoidea/BiliMusic/'), 'updates must never query upstream: ' + address)
    if (updateMode === 'error') throw new Error('QA update network unavailable')
    if (address.endsWith('/ota.json') || updateMode === 'missing') return new Response('', { status: 404 })
    return new Response(JSON.stringify({ tag_name: 'v999.0.0', draft: false, prerelease: false }))
  }
  return originalFetch(url, options)
}
const cover = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'electron/icon.png')).toString('base64')
const track = { id: 'BVsmoketest', bvid: 'BVsmoketest', title: '深蓝电台 · 离线试音', artist: 'BiliMusic Lab', coverUrl: cover, duration: 25, videoUrl: '', playCount: 1, isLiked: true }
app.on('browser-window-created', (_event, window) => {
  const wc = window.webContents
  wc.on('console-message', (event) => { console.log('[renderer]', event.message); if (event.level === 'error' && !event.message.includes('Error invoking')) failures.push(event.message) })
  wc.debugger.attach('1.3')
  void wc.debugger.sendCommand('Page.enable').then(() => wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `window.__audioElements=[]; const OriginalAudio=window.Audio; window.Audio=class extends OriginalAudio { constructor(...args) { super(...args); window.__audioElements.push(this); } };` }))
})
app.whenReady().then(() => {
  const auth = session.fromPartition('persist:bili-auth')
  const originalAuthFetch = auth.fetch.bind(auth)
  auth.fetch = async (input, options) => {
    assert.equal(options.credentials, 'include', 'authenticated API requests include cookies')
    const url = new URL(input)
    apiRequests.push(url.pathname + url.search)
    let data = {}
    if (url.pathname.endsWith('/nav')) data = { isLogin: qrScanned, mid: qrScanned ? 123 : 0, uname: qrScanned ? 'QA Listener' : '', face: qrScanned ? cover : '', wbi_img: { img_url: 'https://i.test/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://i.test/abcdefghijklmnopqrstuvwxyz012345.png' } }
    else if (url.pathname.endsWith('/view')) data = { bvid: track.bvid, aid: 1, cid: 1, title: track.title, owner: { name: track.artist }, pic: cover, duration: 25 }
    else if (url.pathname.endsWith('/playurl')) {
      playRequests++
      data = { dash: { audio: [{ id: 30280, bandwidth: 64000, baseUrl: dataSource ? 'data:audio/mp4;base64,' + silent.toString('base64') : 'https://test.bilivideo.com/silent.m4a', mimeType: 'audio/mp4' }] } }
    } else if (url.pathname.endsWith('/generate')) data = { url: 'https://passport.bilibili.com/test', qrcode_key: 'qa-key-' + (++qrGenerated) }
    else if (url.pathname.endsWith('/poll')) {
      await loginServerReady
      const response = await originalAuthFetch(`http://127.0.0.1:${loginServer.address().port}/poll${url.search}`, { ...options, headers: {} })
      if (response.headers.get('set-cookie')) qrCookieHeaderEntries = response.headers.getSetCookie().length
      return response
    } else if (url.pathname.includes('/ranking/')) data = Array.from({ length: 45 }, (_, i) => ({ bvid: `BVrank${url.searchParams.get('rid')}-${i}`, title: `榜单 ${url.searchParams.get('rid')} · ${i}`, pic: cover, duration: 190, owner: { name: 'QA' } }))
    else if (url.pathname.endsWith('/search/type')) data = { numPages: 50, result: Array.from({ length: 40 }, (_, i) => ({ bvid: `BVsearch${url.searchParams.get('keyword')}-${url.searchParams.get('page')}-${i}`, title: `Official ${url.searchParams.get('keyword')} ${url.searchParams.get('page')}-${i}`, author: 'QA Singer', duration: i === 0 ? '00:20' : '03:20', description: i === 1 ? '乐理教学' : '', pic: cover, tag: '单曲' })) }
    else if (url.pathname.endsWith('/newlist')) data = { archives: Array.from({ length: 20 }, (_, i) => ({ bvid: `BVnew${url.searchParams.get('pn')}-${i}`, title: `新歌 Live ${url.searchParams.get('pn')}-${i}`, pic: cover, duration: 205, owner: { name: 'QA' } })) }
    else if (url.pathname.endsWith('/web/rank')) data = { list: Array.from({ length: 5 }, (_, i) => ({ bvid: `BVsong${i}`, music_title: `推荐曲目 ${i}`, author: 'QA', cover, duration: i === 0 ? '03:45' : undefined, related_archive: i === 1 ? { bvid: 'BVrelated', duration: 198 } : undefined })) }
    else if (url.pathname.endsWith('/new/music')) data = { list: [{ bvid: 'BVfresh', music_title: '全新单曲', author: 'QA', cover, duration: '04:01' }] }
    else data = { list: [], result: [], page: 1, numResults: 0 }
    return new Response(JSON.stringify({ code: 0, data }))
  }
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(callback, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await callback()) return; await sleep(100) }
  throw new Error('Timed out: ' + label)
}
async function run() {
  await import(pathToFileURL(path.join(root, packaged ? `${releaseDir}/win-unpacked/resources/app.asar/dist-electron/main.js` : 'dist-electron/main.js')).href)
  await app.whenReady()
  await waitFor(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().startsWith('app://local/')), 'main window')
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('app://local/'))
  const js = code => win.webContents.executeJavaScript(code, true).catch(error => { console.error('FAILED SCRIPT', code); throw error })
  // Native mouse input plus hit-testing: .click() alone would bypass an invisible overlay.
  const physicalClick = async expression => {
    await js(`(${expression})?.scrollIntoView({block:'center', inline:'nearest'})`)
    await sleep(200)
    const point = await js(`(() => {
      const target = (${expression}); if (!target) throw new Error('Missing click target');
      const r = target.getBoundingClientRect(), x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      if (!target.contains(hit)) throw new Error('Click blocked by ' + hit?.outerHTML.slice(0, 250));
      return {x,y};
    })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    await sleep(200)
  }
  await waitFor(() => js('!!window.electronAPI && !!document.querySelector(".player-bar")'), 'renderer mounted')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `window.__audioElements=[]; const NativeAudio=window.Audio; window.Audio=class extends NativeAudio { constructor(...args) { super(...args); window.__audioElements.push(this); } };` })
  win.webContents.reload()
  await sleep(600)
  await waitFor(() => js('!!window.__audioElements?.length && !!document.querySelector(".player-bar")'), 'instrumented renderer')
  assert.equal(app.commandLine.hasSwitch('remote-debugging-port'), process.argv.includes('--debug'))
  const unavailableHotkeys = ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack'].filter(key => !globalShortcut.isRegistered(key))
  if (!process.argv.includes('--allow-hotkey-conflict')) assert.deepEqual(unavailableHotkeys, [], 'global hotkeys registered')
  const skippedChecks = unavailableHotkeys.length ? ['global media hotkeys: already occupied by another app (' + unavailableHotkeys.join(', ') + ')'] : []
  assert.equal(await js('"getCookies" in window.electronAPI.biliApi'), false)
  await js(`localStorage.setItem('bilimusic_favorites', ${JSON.stringify(JSON.stringify([track]))}); location.hash='/favorites';`)
  await waitFor(() => js(`!!document.querySelector('[title="下载到本地"]')`), 'favorite row')
  await js(`document.querySelector('[title="下载到本地"]').click()`)
  await waitFor(() => js('JSON.parse(localStorage.getItem("bilimusic_downloaded_tracks") || "[]").length === 1'), 'download completed')
  const downloaded = await js('JSON.parse(localStorage.getItem("bilimusic_downloaded_tracks"))[0]')
  assert.ok(downloaded.localFilename.endsWith('.mp3'))
  const mp3 = fs.readFileSync(downloaded.filePath)
  assert.equal(mp3.length, downloaded.fileSize)
  for (const frame of ['ID3', 'TIT2', 'TPE1', 'TALB', 'APIC']) assert.ok(mp3.includes(Buffer.from(frame)), frame)
  const selected = path.join(profile, 'chosen-downloads')
  fs.mkdirSync(selected)
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  let opened = ''
  shell.openPath = async value => { opened = value; return '' }
  assert.equal(await js('window.electronAPI.selectFolder()'), selected)
  await js(`window.electronAPI.openPath(${JSON.stringify(selected)})`)
  assert.equal(opened, selected, 'selected directory must be openable')
  const beforeLocal = playRequests
  await js(`document.querySelector('.am-track-row').click()`)
  await waitFor(() => js('!!document.querySelector(".local-audio-badge")'), 'local playback badge')
  await waitFor(() => js('window.__audioElements.some(a => !a.paused && a.currentTime > 0)'), 'local audio playing')
  assert.equal(playRequests, beforeLocal, 'offline playback must not fetch playUrl')
  assert.ok(await js('window.__audioElements.at(-1).src.startsWith("bilimusic-audio://")'))
  await js(`location.hash='/downloads'`)
  await sleep(900)
  fs.writeFileSync(path.join(output, 'downloads-wide.png'), (await win.webContents.capturePage()).toPNG())
  win.setSize(720, 660)
  await sleep(600)
  const overflow = await js(`({ width: innerWidth, body: document.body.scrollWidth, main: document.querySelector('main').clientWidth, sidebar: document.querySelector('aside')?.getBoundingClientRect().width })`)
  assert.ok(overflow.body <= overflow.width, JSON.stringify(overflow))
  assert.ok(await js('document.querySelector(".player-bar__labels").getBoundingClientRect().width >= 90'), 'narrow metadata must remain legible')
  assert.ok(await js('document.querySelector(".local-audio-badge").getBoundingClientRect().height < 20'), 'local badge must not wrap')
  fs.writeFileSync(path.join(output, 'downloads-narrow.png'), (await win.webContents.capturePage()).toPNG())
  win.setSize(680, 660)
  await sleep(200)
  assert.ok(await js('document.body.scrollWidth <= innerWidth'), 'minimum window width must not overflow')
  fs.writeFileSync(path.join(output, 'downloads-minimum.png'), (await win.webContents.capturePage()).toPNG())
  // The same command bridge is used by global hotkeys; verify it while the window is hidden.
  win.hide()
  win.webContents.send('tray:player-command', 'toggle-play')
  await waitFor(() => js('window.__audioElements.at(-1).paused'), 'background pause')
  win.webContents.send('tray:player-command', 'toggle-play')
  await waitFor(() => js('!window.__audioElements.at(-1).paused'), 'background resume')
  win.show()
  await js(`const slider = document.querySelector('[aria-label="播放进度"]'); slider.focus(); slider.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));`)
  assert.ok(await js('!!document.querySelector("[role=tooltip]")'), 'keyboard slider tooltip')
  await sleep(400)
  for (const window of BrowserWindow.getAllWindows()) {
    const prefs = window.webContents.getLastWebPreferences()
    assert.equal(prefs.nodeIntegration, false)
    assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.sandbox, true)
  }
  // Simulate a CDN/network failure after a seek; the player must resolve a fresh source and preserve position.
  dataSource = true
  await js(`window.__audioElements.at(-1).currentTime=8; window.__audioElements.at(-1).dispatchEvent(new Event('error'));`)
  await waitFor(() => playRequests > beforeLocal, 'silent source refresh')
  await waitFor(() => js('window.__audioElements.at(-1).src.startsWith("data:") && !window.__audioElements.at(-1).paused && window.__audioElements.at(-1).currentTime >= 8'), 'resumed playback at saved position')
  await js(`window.electronAPI.updateTrayPlayerState({hasTrack:true,title:'test',artist:'test',coverUrl:'',isPlaying:true,queueLength:1,theme:'dark'})`)
  const invalidPath = await js(`window.electronAPI.openPath(${JSON.stringify('C:\\Windows')}).then(() => false, () => true)`)
  assert.equal(invalidPath, true)
  // Core-fix regression tests run against the actual production React and Electron code.
  await js(`location.hash='/discover'`)
  const visibleTitles = () => js('[...document.querySelectorAll(".am-track-row__main h3, .am-feature-card__body h3")].map(e => e.textContent)')
  const refresh = () => js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('换一换')).click()`)
  const seenTitles = new Set()
  for (let batch = 0; batch < 3; batch++) {
    await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 18'), 'clean discovery batch')
    const titles = await visibleTitles()
    assert.equal(titles.length, 21)
    assert.ok(titles.every(title => !seenTitles.has(title)), 'refresh must not repeat any visible song')
    titles.forEach(title => seenTitles.add(title))
    if (batch < 2) { await refresh(); await sleep(100) }
  }
  assert.ok(apiRequests.some(url => url.includes('tids=3')), 'music-tag search requested')
  await js(`location.hash='/recommend'`)
  await sleep(200)
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 18'), 'mixed recommendations')
  assert.ok(apiRequests.some(url => url.includes('/top/rcmd?') && url.includes('fresh_idx=')))
  const firstRecommended = await visibleTitles()
  const durations = await js('[...document.querySelectorAll(".am-track-row__duration")].map(e => e.textContent)')
  assert.ok(durations.every(value => { const seconds = value.split(':').reduce((n, part) => n * 60 + Number(part), 0); return seconds >= 60 && seconds <= 600 }))
  await refresh(); await sleep(100)
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 18'), 'refreshed recommendations')
  assert.ok((await visibleTitles()).every(title => !firstRecommended.includes(title)))
  await js('document.querySelectorAll(".am-track-row")[2].click()')
  await waitFor(() => js('JSON.parse(localStorage.getItem("bilimusic_player_state")).queue.length === 18'), 'recommendation list queued')
  await js('document.querySelectorAll(".am-track-row")[0].scrollIntoView({block: "start"})')
  await sleep(300)
  fs.writeFileSync(path.join(output, 'recommend-durations.png'), (await win.webContents.capturePage()).toPNG())

  assert.ok(await js('[...document.querySelectorAll(".player-bar button")].every(button => button.title && /[\\u4e00-\\u9fff]/.test(button.title))'))
  await js(`document.querySelector('[title="顺序播放（播完停止）"]').click()`)
  await waitFor(() => js('document.body.textContent.includes("已切换为：列表循环")'), 'repeat mode toast')
  await js(`document.querySelector('[title="列表循环"]').click()`)
  assert.equal(await js(`document.querySelector('[title="单曲循环"]').textContent`), '1')
  await js(`document.querySelector('[title="单曲循环"]').click()`)
  assert.equal(await js(`document.querySelector('[title="顺序播放（播完停止）"]').textContent`), '')
  await js(`document.querySelector('[title="打开桌面歌词"]').click()`)
  await waitFor(() => js(`!!document.querySelector('[title="关闭桌面歌词"]')`), 'desktop lyrics toggled')
  await js(`document.querySelector('[title="关闭桌面歌词"]').click()`)

  const playlistTracks = Array.from({ length: 5 }, (_, i) => ({ ...track, id: 'BVqueue' + i, bvid: 'BVqueue' + i, title: '队列歌曲 ' + i }))
  await js(`localStorage.setItem('bilimusic_favorites', ${JSON.stringify(JSON.stringify(playlistTracks))}); location.hash='/favorites'`)
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 5'), 'full favorite list')
  await js('document.querySelectorAll(".am-track-row")[2].click()')
  const state = () => js('JSON.parse(localStorage.getItem("bilimusic_player_state"))')
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue2', 'clicked favorite selected')
  assert.equal((await state()).queue.length, 5)
  await js(`document.querySelector('[aria-label="下一首"]').click()`)
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue3', 'sequential next')
  await js(`document.querySelector('[aria-label="上一首"]').click()`)
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue2', 'sequential previous')
  await js('document.querySelectorAll(".am-track-row")[4].click()')
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue4' && await js('!window.__audioElements.at(-1).paused'), 'last song playing')
  await js(`window.__audioElements.at(-1).dispatchEvent(new Event('ended'))`)
  await waitFor(() => js('window.__audioElements.at(-1).paused'), 'sequential natural end stops')
  assert.equal((await state()).currentTrack.id, 'BVqueue4')
  await js(`document.querySelector('[title="顺序播放（播完停止）"]').click(); window.__audioElements.at(-1).dispatchEvent(new Event('ended'))`)
  // Wait for the mode state render before firing a new end event.
  await sleep(100)
  await js(`window.__audioElements.at(-1).dispatchEvent(new Event('ended'))`)
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue0', 'list natural end wraps')
  await waitFor(() => js('!window.__audioElements.at(-1).paused'), 'wrapped song playing')
  await js(`document.querySelector('[title="列表循环"]').click()`)
  await sleep(100)
  const beforeRepeat = playRequests
  await js(`window.__audioElements.at(-1).currentTime=10; window.__audioElements.at(-1).dispatchEvent(new Event('ended'))`)
  await waitFor(() => js('window.__audioElements.at(-1).currentTime < 2 && !window.__audioElements.at(-1).paused'), 'single repeat restarts current audio')
  assert.equal((await state()).currentTrack.id, 'BVqueue0')
  assert.equal(playRequests, beforeRepeat, 'single repeat must not resolve another track')
  await js(`document.querySelector('[title="单曲循环"]').click(); document.querySelectorAll('.am-track-row')[2].click()`)
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue2', 'restore favorite for shuffle')
  await js(`document.querySelector('[title$="随机播放"]').click()`)
  const visited = [(await state()).currentTrack.id]
  for (let i = 0; i < 4; i++) {
    const previous = visited.at(-1)
    await js(`document.querySelector('[aria-label="下一首"]').click()`)
    await waitFor(async () => (await state()).currentTrack.id !== previous, 'shuffle advance')
    visited.push((await state()).currentTrack.id)
  }
  assert.equal(new Set(visited).size, 5, 'shuffle must visit every song without repetition')
  await js(`document.querySelector('[aria-label="上一首"]').click()`)
  await waitFor(async () => (await state()).currentTrack.id === visited[3], 'shuffle previous follows history')
  await js(`document.querySelector('[title$="随机播放"]').click()`)
  const playlist = { id: 'qa-list', name: 'QA 完整歌单', tracks: playlistTracks, createdAt: new Date().toISOString() }
  await js(`localStorage.setItem('bilimusic_playlists', ${JSON.stringify(JSON.stringify([playlist]))}); location.hash='/playlists/qa-list'`)
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 5'), 'playlist detail')
  await js('document.querySelectorAll(".am-track-row")[3].click()')
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue3', 'playlist selection')
  assert.equal((await state()).queue.length, 5)
  await js(`document.querySelector('[aria-label="下一首"]').click()`)
  await waitFor(async () => (await state()).currentTrack.id === 'BVqueue4', 'playlist next')

  win.setSize(1200, 800)
  await sleep(500)
  await physicalClick(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('删除歌单'))`)
  await waitFor(() => js('location.hash === "#/playlists" && !document.body.textContent.includes("QA 完整歌单")'), 'deleted playlist removed and overview responsive')
  assert.equal(await js('JSON.parse(localStorage.getItem("bilimusic_playlists")).length'), 0)
  assert.equal(await js('JSON.parse(localStorage.getItem("bilimusic_playlists_deleted")).some(t => t.id === "qa-list")'), true, 'deletion tombstone retained for sync')
  for (const route of ['discover', 'recommend', 'recent', 'favorites', 'downloads', 'import', 'search', 'playlists', 'settings']) {
    await physicalClick(`document.querySelector('a[href="#/${route}"]')`)
    await waitFor(() => js(`location.hash === '#/${route}'`), 'native navigation after deletion: ' + route)
  }
  // A missing/deleted route must settle rather than spin a render-effect loop.
  await js(`location.hash='/playlists/deleted-list'`)
  await waitFor(() => js('document.body.textContent.includes("歌单不存在")'), 'missing playlist route settles')
  await physicalClick(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('返回所有歌单'))`)
  await waitFor(() => js('location.hash === "#/playlists"'), 'missing playlist exit')
  const emptyList = { ...playlist, id: 'empty-delete', name: '空歌单删除回归', tracks: [] }
  await js(`localStorage.setItem('bilimusic_playlists', ${JSON.stringify(JSON.stringify([emptyList]))}); window.dispatchEvent(new Event('bilimusic:playlists-changed')); location.hash='/playlists/empty-delete'`)
  await waitFor(() => js('document.body.textContent.includes("歌单是空的")'), 'empty playlist')
  await physicalClick(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('删除歌单'))`)
  await waitFor(() => js('location.hash === "#/playlists"'), 'empty playlist deleted')
  await js(`localStorage.setItem('bilimusic_playlists', ${JSON.stringify(JSON.stringify([playlist]))}); window.dispatchEvent(new Event('bilimusic:playlists-changed')); location.hash='/playlists/qa-list'`)
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 5'), 'reopened test playlist')
  await js(`localStorage.setItem('bilimusic_playlists', '[]'); window.dispatchEvent(new Event('bilimusic:playlists-changed'))`)
  await waitFor(() => js('document.body.textContent.includes("歌单不存在")'), 'sync deletion while detail mounted')
  await physicalClick(`document.querySelector('a[href="#/settings"]')`)
  await waitFor(() => js('document.body.textContent.includes("Withnoidea/BiliMusic")'), 'fork update source visible')
  const checkUpdateButton = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '检查更新')`
  await physicalClick(checkUpdateButton)
  await waitFor(() => js('document.body.textContent.includes("暂无可用的正式发布版本")'), 'fork without releases is not falsely up-to-date')
  updateMode = 'error'
  await physicalClick(checkUpdateButton)
  await waitFor(() => js('document.body.textContent.includes("QA update network unavailable")'), 'update failure visible')
  updateMode = 'missing'
  await physicalClick(checkUpdateButton)
  await waitFor(() => js('document.body.textContent.includes("暂无可用的正式发布版本")'), 'update check can retry after error')
  fs.writeFileSync(path.join(output, 'fork-updates.png'), (await win.webContents.capturePage()).toPNG())
  await physicalClick(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '关于项目')`)
  assert.equal(externalUrls.at(-1), 'https://github.com/Withnoidea/BiliMusic')
  await physicalClick(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '版本发布页')`)
  assert.equal(externalUrls.at(-1), 'https://github.com/Withnoidea/BiliMusic/releases')
  updateMode = 'release'
  await physicalClick(checkUpdateButton)
  await waitFor(() => js('document.body.textContent.includes("已打开下载页")'), 'release without OTA offers manual fork download')
  assert.equal(externalUrls.at(-1), 'https://github.com/Withnoidea/BiliMusic/releases')
  updateMode = 'missing'
  await physicalClick(`document.querySelector('a[href="#/playlists"]')`)
  fs.writeFileSync(path.join(output, 'playlist-delete-responsive.png'), (await win.webContents.capturePage()).toPNG())

  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('点击登录账号')).click()`)
  await waitFor(() => js('document.body.textContent.includes("BiliBili 扫码登录")'), 'login dialog open')
  await waitFor(() => js('document.body.textContent.includes("二维码已过期")'), 'genuine server expiry')
  qrMode = 'confirm'
  const primaryCookies = session.defaultSession.cookies
  const originalFlush = primaryCookies.flushStore.bind(primaryCookies)
  let failLoginFlush = true
  primaryCookies.flushStore = async () => {
    if (failLoginFlush) throw new Error('synthetic transient cookie flush failure')
    return originalFlush()
  }
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('刷新二维码')).click()`)
  await waitFor(() => js('document.body.textContent.includes("请在手机上确认登录")'), 'QR scanned before confirmation')
  await waitFor(() => js('document.body.textContent.includes("重试完成登录")'), 'confirmation error offers safe retry')
  assert.equal(await js('document.body.textContent.includes("二维码已过期")'), false)
  assert.equal(qrCookieHeaderEntries, 1, 'actual Electron response combines three cookie headers')
  const pollsAfterConfirmation = qrUpstreamPolls
  await sleep(4500)
  assert.equal(qrUpstreamPolls, pollsAfterConfirmation, 'confirmed QR must not be polled again after a failed flush')
  assert.equal(await js('document.body.textContent.includes("二维码已过期")'), false)
  fs.writeFileSync(path.join(output, 'login-retry.png'), (await win.webContents.capturePage()).toPNG())
  failLoginFlush = false
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('重试完成登录')).click()`)
  await waitFor(() => js('!document.body.textContent.includes("BiliBili 扫码登录") && document.body.textContent.includes("QA Listener")'), 'QR retry closes dialog and refreshes profile')
  assert.equal(qrUpstreamPolls, pollsAfterConfirmation, 'retry finalizes saved credentials without consuming QR again')
  primaryCookies.flushStore = originalFlush
  for (const store of [session.defaultSession.cookies, session.fromPartition('persist:bili-auth').cookies]) {
    const cookies = await store.get({ url: 'https://api.bilibili.com' })
    for (const name of ['SESSDATA', 'bili_jct', 'DedeUserID']) assert.ok(cookies.some(cookie => cookie.name === name && !cookie.session), name)
  }
  assert.equal((await js('window.electronAPI.biliApi.getLoginStatus()')).uname, 'QA Listener')

  await js('window.__audioElements.at(-1).pause()')
  await sleep(400)
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.removeItem('bilimusic_player_state')" })
  await js('location.reload()')
  await waitFor(() => js('!!document.querySelector(".player-bar") && !document.querySelector(".player-bar__labels")?.textContent.includes("队列歌曲")'), 'empty player after reload')
  await sleep(400)
  await js(`localStorage.setItem('bilimusic_desktop_lyrics',JSON.stringify({enabled:true,locked:false,style:{fontSize:32,showBg:true}})); window.dispatchEvent(new Event('DESKTOP_LYRICS_CHANGED_EVENT'))`)

  await waitFor(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().startsWith('data:') && w.getBounds().width > 400), 'lyrics window created')
  const lyrics = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('data:') && w !== win && w.getBounds().width > 400)
  await waitFor(() => lyrics.webContents.executeJavaScript('document.getElementById("line")?.textContent.includes("已就绪")'), 'idle lyric preview')
  await waitFor(() => lyrics.isVisible(), 'lyrics ready and visible')
  await sleep(300)
  const lyricJS = code => lyrics.webContents.executeJavaScript(code, true)
  fs.writeFileSync(path.join(output, 'lyrics-preview.png'), (await lyrics.webContents.capturePage()).toPNG())
  const area = screen.getPrimaryDisplay().workArea
  lyrics.setPosition(area.x + area.width - lyrics.getBounds().width - 4, area.y + 4)
  await js(`window.electronAPI.desktopLyrics.setState({hasTrack:true,line:'长歌词测试 · '.repeat(80),nextLine:'下一句歌词',isPlaying:true})`)
  await waitFor(() => lyricJS('document.getElementById("line").scrollWidth > document.getElementById("line").clientWidth'), 'long lyric constrained')
  const box = lyrics.getBounds()
  assert.ok(box.x + box.width <= area.x + area.width)
  assert.equal(await lyricJS('getComputedStyle(document.getElementById("line")).textOverflow'), 'ellipsis')
  assert.equal(await lyricJS('getComputedStyle(document.getElementById("dragBar")).pointerEvents'), 'none')
  assert.equal(await lyricJS('getComputedStyle(document.getElementById("nextLine")).color'), 'rgb(255, 55, 95)')
  fs.writeFileSync(path.join(output, 'lyrics-long.png'), (await lyrics.webContents.capturePage()).toPNG())
  // Simulate native DIP cursor movements without moving the user's real cursor.
  const originalCursor = screen.getCursorScreenPoint
  let cursor = { x: box.x + 50, y: box.y + 20 }
  screen.getCursorScreenPoint = () => cursor
  const lyricEvent = { sender: lyrics.webContents }
  for (const [x, y] of [[-9999,-9999],[9999,9999]]) {
    ipcMain.emit('desktop-lyrics:drag:start', lyricEvent)
    cursor = { x, y }
    ipcMain.emit('desktop-lyrics:drag:move', lyricEvent)
    const edge = lyrics.getBounds()
    const gapX = x < 0 ? edge.x - area.x : area.x + area.width - edge.x - edge.width
    const gapY = y < 0 ? edge.y - area.y : area.y + area.height - edge.y - edge.height
    assert.ok(gapX >= 0 && gapX <= 5, 'DPI-rounded horizontal inset: ' + gapX)
    assert.ok(gapY >= 0 && gapY <= 5, 'DPI-rounded vertical inset: ' + gapY)
    const stable = lyrics.getBounds()
    ipcMain.emit('desktop-lyrics:drag:move', lyricEvent)
    assert.deepEqual(lyrics.getBounds(), stable, 'stationary pointer cannot accumulate movement')
    lyrics.emit('blur')
    cursor = { x: 500, y: 500 }
    ipcMain.emit('desktop-lyrics:drag:move', lyricEvent)
    assert.deepEqual(lyrics.getBounds(), stable, 'blur ends native drag')
  }
  screen.getCursorScreenPoint = originalCursor
  // A captured pointer released outside the handle, cancellation, or blur must stop the renderer.
  lyrics.setPosition(area.x + 40, area.y + 40)
  for (const event of ['pointercancel', 'blur', 'mouseup', 'pointerup']) {
    lyrics.webContents.sendInputEvent({ type: 'mouseDown', x: 60, y: 22, button: 'left', clickCount: 1 })
    await waitFor(() => lyricJS('document.body.classList.contains("dragging")'), 'pointer drag begins')
    await lyricJS(`window.dispatchEvent(new Event('${event}'))`)
    await waitFor(() => lyricJS('!document.body.classList.contains("dragging")'), event + ' cancels drag')
    lyrics.webContents.sendInputEvent({ type: 'mouseUp', x: 60, y: 22, button: 'left', clickCount: 1 })
  }
  await js('window.electronAPI.desktopLyrics.setState({visible:false})')
  assert.equal(failures.length, 0, failures.join('\n'))
  fs.writeFileSync(path.join(output, 'smoke-error.txt'), '')
  const testedAsarSha256 = packaged ? require('node:crypto').createHash('sha256').update(require('original-fs').readFileSync(path.join(root, releaseDir, 'win-unpacked/resources/app.asar'))).digest('hex') : null
  fs.writeFileSync(path.join(output, 'smoke-result.json'), JSON.stringify({ passed: true, releaseDir, appVersion: app.getVersion(), testedAt: new Date().toISOString(), testedAsarSha256, packaged, skippedChecks, updateRequests, externalUrls, qrUpstreamPolls, qrCookieHeaderEntries, checks: ['delete populated/empty playlist then native mouse navigation on all nine pages', 'missing route and externally deleted playlist settle without render loop', 'fork-only update endpoints and about/release links', 'no-release message, network failure retry and manual download without OTA', 'music-only discovery and three disjoint refresh batches', 'all PlayerBar Chinese titles, repeat badge/toast and desktop lyrics toggle', 'clean mixed recommendations and non-repeating refresh', 'full favorites and playlist queues', 'sequential next/previous', 'shuffle full coverage and history', 'QR real HTTP merged headers, double-store persistence and immediate profile refresh', 'confirmed QR flush failure retries without upstream re-poll or false expiry', 'genuine server expiry still works', 'idle lyric preview and long-line ellipsis', 'four-edge lyric clamp, no incremental drift, blur/cancel/global release recovery', 'production debug switch closed', 'no credential bridge', '320kbps MP3 export with title, artist, album and cover', 'verified local playback without playUrl', '720px responsive layout and metadata legibility', 'all three global media shortcuts registered', 'error refresh and position recovery', 'path boundary rejection', 'authorized folder selection and opening', '680px minimum layout', 'hidden-window playback controls', 'keyboard slider tooltip', 'all windows sandboxed and isolated', 'no renderer console errors'].filter(check => !unavailableHotkeys.length || check !== 'all three global media shortcuts registered'), playRequests, viewport: overflow }, null, 2))
  console.log('SMOKE PASS', JSON.stringify({ playRequests, viewport: overflow }))
  if (!process.argv.includes('--interactive')) app.exit(0)
}
run().catch(error => { console.error(error); fs.writeFileSync(path.join(output, 'smoke-error.txt'), String(error.stack || error)); app.exit(1) })
