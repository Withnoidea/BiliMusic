// Deterministic real-Electron smoke test. Uses a fresh profile and silent audio, never user data.
const { app, session, net, BrowserWindow, globalShortcut, dialog, shell, screen, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const packaged = process.argv.includes('--packaged')
const output = path.join(root, 'artifacts', packaged ? 'qa-packaged' : 'qa')
fs.mkdirSync(output, { recursive: true })
const profile = fs.mkdtempSync(path.join(output, 'profile-'))
app.setPath('appData', profile)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const silent = fs.readFileSync(path.join(root, 'tests/fixtures/silence.m4a'))
let playRequests = 0, dataSource = false, failures = [], apiRequests = [], qrScanned = false
const originalFetch = net.fetch.bind(net)
net.fetch = async (url, options) => String(url).startsWith('https://test.bilivideo.com/')
  ? new Response(silent, { headers: { 'content-type': 'audio/mp4', 'content-length': String(silent.length) } })
  : originalFetch(url, options)
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#457e9a"/><circle cx="120" cy="120" r="74" fill="#234355"/><circle cx="120" cy="120" r="22" fill="#d0ba91"/></svg>')
const track = { id: 'BVsmoketest', bvid: 'BVsmoketest', title: '深蓝电台 · 离线试音', artist: 'BiliMusic Lab', coverUrl: cover, duration: 25, videoUrl: '', playCount: 1, isLiked: true }
app.on('browser-window-created', (_event, window) => {
  const wc = window.webContents
  wc.on('console-message', (event) => { console.log('[renderer]', event.message); if (event.level === 'error' && !event.message.includes('Error invoking')) failures.push(event.message) })
  wc.debugger.attach('1.3')
  void wc.debugger.sendCommand('Page.enable').then(() => wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `window.__audioElements=[]; const OriginalAudio=window.Audio; window.Audio=class extends OriginalAudio { constructor(...args) { super(...args); window.__audioElements.push(this); } };` }))
})
app.whenReady().then(() => {
  session.fromPartition('persist:bili-auth').fetch = async input => {
    const url = new URL(input)
    apiRequests.push(url.pathname + url.search)
    let data = {}
    if (url.pathname.endsWith('/nav')) data = { isLogin: qrScanned, mid: qrScanned ? 123 : 0, uname: qrScanned ? 'QA Listener' : '', face: qrScanned ? cover : '', wbi_img: { img_url: 'https://i.test/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://i.test/abcdefghijklmnopqrstuvwxyz012345.png' } }
    else if (url.pathname.endsWith('/view')) data = { bvid: track.bvid, aid: 1, cid: 1, title: track.title, owner: { name: track.artist }, pic: cover, duration: 25 }
    else if (url.pathname.endsWith('/playurl')) {
      playRequests++
      data = { dash: { audio: [{ id: 30280, bandwidth: 64000, baseUrl: dataSource ? 'data:audio/mp4;base64,' + silent.toString('base64') : 'https://test.bilivideo.com/silent.m4a', mimeType: 'audio/mp4' }] } }
    } else if (url.pathname.endsWith('/generate')) data = { url: 'https://passport.bilibili.com/test', qrcode_key: 'qa-key' }
    else if (url.pathname.endsWith('/poll')) {
      qrScanned = true
      return new Response(JSON.stringify({ code: 0, data: { code: 0 } }), { headers: [
        ['set-cookie', 'SESSDATA=qa-session%2F==; Domain=.bilibili.com; Path=/; Max-Age=86400; HttpOnly; Secure'],
        ['set-cookie', 'bili_jct=qa-csrf; Domain=.bilibili.com; Path=/; Max-Age=86400'],
        ['set-cookie', 'DedeUserID=123; Domain=.bilibili.com; Path=/; Max-Age=86400'],
      ] })
    } else if (url.pathname.includes('/ranking/')) data = Array.from({ length: 45 }, (_, i) => ({ bvid: `BVrank${url.searchParams.get('rid')}-${i}`, title: `榜单 ${url.searchParams.get('rid')} · ${i}`, pic: cover, duration: 190, owner: { name: 'QA' } }))
    else if (url.pathname.endsWith('/newlist')) data = { archives: Array.from({ length: 20 }, (_, i) => ({ bvid: `BVnew${url.searchParams.get('pn')}-${i}`, title: `新投稿 ${i}`, pic: cover, duration: 205, owner: { name: 'QA' } })) }
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
  await import(pathToFileURL(path.join(root, packaged ? 'release/win-unpacked/resources/app.asar/dist-electron/main.js' : 'dist-electron/main.js')).href)
  await app.whenReady()
  await waitFor(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().startsWith('app://local/')), 'main window')
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('app://local/'))
  const js = code => win.webContents.executeJavaScript(code, true).catch(error => { console.error('FAILED SCRIPT', code); throw error })
  await waitFor(() => js('!!window.electronAPI && !!document.querySelector(".player-bar")'), 'renderer mounted')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `window.__audioElements=[]; const NativeAudio=window.Audio; window.Audio=class extends NativeAudio { constructor(...args) { super(...args); window.__audioElements.push(this); } };` })
  win.webContents.reload()
  await sleep(600)
  await waitFor(() => js('!!window.__audioElements?.length && !!document.querySelector(".player-bar")'), 'instrumented renderer')
  assert.equal(app.commandLine.hasSwitch('remote-debugging-port'), process.argv.includes('--debug'))
  for (const key of ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack']) assert.equal(globalShortcut.isRegistered(key), true, key)
  assert.equal(await js('"getCookies" in window.electronAPI.biliApi'), false)
  await js(`localStorage.setItem('bilimusic_favorites', ${JSON.stringify(JSON.stringify([track]))}); location.hash='/favorites';`)
  await waitFor(() => js(`!!document.querySelector('[title="下载到本地"]')`), 'favorite row')
  await js(`document.querySelector('[title="下载到本地"]').click()`)
  await waitFor(() => js('JSON.parse(localStorage.getItem("bilimusic_downloaded_tracks") || "[]").length === 1'), 'download completed')
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
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 17'), 'discover ranking')
  const firstDiscover = await js('document.querySelector(".am-track-row").textContent')
  const refresh = () => js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('换一换')).click()`)
  await refresh()
  await waitFor(() => apiRequests.some(url => url.includes('rid=28')), 'original chart requested')
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 17'), 'original chart rendered')
  assert.notEqual(await js('document.querySelector(".am-track-row").textContent'), firstDiscover)
  await refresh()
  await waitFor(() => apiRequests.some(url => url.includes('/newlist?') && url.includes('pn=1')), 'latest chart requested')
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 17'), 'latest chart rendered')
  await refresh()
  await waitFor(() => js('document.querySelector(".am-track-row")?.textContent.includes("23")'), 'next ranking page')
  await js(`location.hash='/recommend'`)
  await waitFor(() => js('document.querySelectorAll(".am-track-row").length === 5'), 'recommendations with durations')
  const durations = await js('[...document.querySelectorAll(".am-track-row__duration")].map(e => e.textContent)')
  assert.deepEqual(durations, ['3:45','3:18','0:25','0:25','0:25'])
  await js('document.querySelectorAll(".am-track-row")[2].click()')
  await waitFor(() => js('JSON.parse(localStorage.getItem("bilimusic_player_state")).queue.length === 5'), 'recommendation list queued')
  await js('document.querySelectorAll(".am-track-row")[0].scrollIntoView({block: "start"})')
  await sleep(300)
  fs.writeFileSync(path.join(output, 'recommend-durations.png'), (await win.webContents.capturePage()).toPNG())

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
  await js(`document.querySelector('[aria-label="随机播放"]').click()`)
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
  await js(`document.querySelector('[aria-label="随机播放"]').click()`)
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
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('点击登录账号')).click()`)
  await waitFor(() => js('document.body.textContent.includes("BiliBili 扫码登录")'), 'login dialog open')
  await waitFor(() => js('!document.body.textContent.includes("BiliBili 扫码登录") && document.body.textContent.includes("QA Listener")'), 'QR login closes dialog and refreshes profile')
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
  fs.writeFileSync(path.join(output, 'smoke-result.json'), JSON.stringify({ passed: true, packaged, checks: ['dynamic discovery dimensions and pagination', 'recommendation durations and detail fallback', 'full favorites and playlist queues', 'sequential next/previous', 'shuffle full coverage and history', 'QR double-store persistence and immediate profile refresh', 'idle lyric preview and long-line ellipsis', 'four-edge lyric clamp, no incremental drift, blur/cancel/global release recovery', 'production debug switch closed', 'no credential bridge', 'download completion', 'verified local playback without playUrl', '720px responsive layout and metadata legibility', 'all three global media shortcuts registered', 'error refresh and position recovery', 'path boundary rejection', 'authorized folder selection and opening', '680px minimum layout', 'hidden-window playback controls', 'keyboard slider tooltip', 'all windows sandboxed and isolated', 'no renderer console errors'], playRequests, viewport: overflow }, null, 2))
  console.log('SMOKE PASS', JSON.stringify({ playRequests, viewport: overflow }))
  if (!process.argv.includes('--interactive')) app.exit(0)
}
run().catch(error => { console.error(error); fs.writeFileSync(path.join(output, 'smoke-error.txt'), String(error.stack || error)); app.exit(1) })
