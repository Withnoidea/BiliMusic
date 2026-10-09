const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const { readFileSync } = require('node:fs')
function load(file, mocks = {}) {
  const source = ts.transpileModule(readFileSync(path.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports = {}
  const context = { exports, require: name => mocks[name] || require(name), console, Buffer, URL, Response, AbortController, AbortSignal, DOMException, performance, setTimeout, clearTimeout, setInterval, clearInterval, process, ...mocks.globals }
  vm.runInNewContext(source, context, { filename: file })
  return exports
}
const trusted = { senderFrame: { url: 'app://local/index.html' }, sender: { isDestroyed: () => false, send() {} } }

test('path boundaries, trusted IPC and CDN allowlist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bilimusic-security-'))
  const security = load('electron/security.ts', { electron: { app: { getPath: () => root } } })
  assert.doesNotThrow(() => security.assertTrustedSender(trusted))
  assert.throws(() => security.assertTrustedSender({ senderFrame: { url: 'https://evil.example' } }))
  for (const name of ['../bad.m4a', 'a\\b.m4a', 'c:evil.m4a', 'CON.m4a', 'song.exe', 'bad\0.m4a']) assert.throws(() => security.validateAudioFilename(name))
  for (const url of ['http://a.bilivideo.com/a', 'https://a.bilivideo.com.evil.test/a', 'https://127.0.0.1/a', 'file:///secret', 'https://user:pass@a.bilivideo.com/a']) assert.throws(() => security.validateAudioUrl(url))
  assert.equal(security.validateAudioUrl('https://cn-test.bilivideo.com/audio'), 'https://cn-test.bilivideo.com/audio')
  const defaultDir = await security.downloadDirectory()
  const custom = path.join(root, 'custom')
  await fs.mkdir(custom)
  await assert.rejects(security.downloadDirectory(custom))
  await security.grantDirectory(custom)
  assert.equal(await security.downloadDirectory(custom), await fs.realpath(custom))
  assert.equal(security.isWithin(defaultDir, path.join(defaultDir, 'a')), true)
  assert.equal(security.isWithin(defaultDir, defaultDir + '-other'), false)
  assert.equal(security.isWithin(defaultDir, path.join(defaultDir, '..', 'secret')), false)
  // Cleanup only the mkdtemp-created test directory.
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'bilimusic-security-')))
  await fs.rm(root, { recursive: true })
})

test('streaming download, range playback, integrity checks and bounded concurrency', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bilimusic-download-'))
  const handlers = new Map(), protocols = new Map(), progress = []
  const body = Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypM4A '), Buffer.alloc(4096, 7)])
  let network = 0, peak = 0, calls = 0
  const electron = { app: { getPath: () => root }, ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, protocol: { handle: (name, callback) => protocols.set(name, callback) }, net: { fetch: async url => {
    calls++
    if (url.includes('/redirect')) return new Response(null, { status: 302, headers: { location: 'https://evil.example/private' } })
    network++; peak = Math.max(peak, network)
    await new Promise(resolve => setTimeout(resolve, 20))
    network--
    return new Response(body, { headers: { 'content-length': String(url.includes('/truncated') ? body.length + 2 : body.length), 'content-type': 'audio/mp4' } })
  } } }
  const security = load('electron/security.ts', { electron })
  load('electron/downloads.ts', { electron, './security': security }).registerDownloadHandlers()
  const event = { ...trusted, sender: { isDestroyed: () => false, send: (_name, data) => progress.push(data) } }
  const invoke = (name, ...args) => handlers.get('bili:' + name)(event, ...args)
  const result = await invoke('downloadAudio', 'https://test.bilivideo.com/a', 'track.m4a')
  assert.equal(result.size, body.length)
  assert.equal(progress.at(-1).percent, 100)
  const local = await invoke('localAudio', 'track.m4a', undefined, body.length)
  assert.ok(local.startsWith('bilimusic-audio://local/'))
  const beforePlayback = calls
  const response = await protocols.get('bilimusic-audio')(new Request(local, { headers: { range: 'bytes=20-29' } }))
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 20-29/${body.length}`)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body.subarray(20, 30))
  assert.equal(calls, beforePlayback, 'local playback must make no network request')
  const invalid = await protocols.get('bilimusic-audio')(new Request(local, { headers: { range: 'bytes=999999-' } }))
  assert.equal(invalid.status, 416)
  await fs.writeFile(result.filePath, Buffer.alloc(body.length, 8))
  assert.equal(await invoke('localAudio', 'track.m4a'), null, 'same-size corruption must be rejected')
  await assert.rejects(invoke('downloadAudio', 'https://test.bilivideo.com/truncated', 'partial.m4a'))
  assert.equal((await fs.readdir(path.dirname(result.filePath))).some(name => name.endsWith('.part')), false)
  await assert.rejects(invoke('downloadAudio', 'https://test.bilivideo.com/redirect', 'redirect.m4a'))
  await Promise.all([1,2,3,4,5].map(i => invoke('downloadAudio', 'https://test.bilivideo.com/a', `queue-${i}.m4a`)))
  assert.ok(peak <= 2)
  assert.equal(await invoke('localAudio', 'missing.m4a'), null)
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'bilimusic-download-')))
  await fs.rm(root, { recursive: true })
})

test('login IPC strips credentials and rejects arbitrary endpoints', async () => {
  const handlers = new Map()
  const auth = { cookies: { get: async () => [{ name: 'SESSDATA', value: 'secret-session' }, { name: 'bili_jct', value: 'secret-csrf' }, { name: 'DedeUserID', value: '123' }] }, fetch: async () => new Response(JSON.stringify({ code: 0, data: { isLogin: true, mid: 123, uname: 'Listener', face: 'https://example/avatar', dangerous: 'not-public', wbi_img: {} } })) }
  const security = load('electron/security.ts', { electron: {} })
  const electron = { ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, session: { fromPartition: () => auth } }
  load('electron/biliApi.ts', { electron, './security': security, './downloads': { registerDownloadHandlers() {} } }).registerBiliApiHandlers()
  const status = await handlers.get('bili:getLoginStatus')(trusted)
  assert.equal(JSON.stringify(status), JSON.stringify({ isLogin: true, isLoggedIn: true, uid: '123', uname: 'Listener', face: 'https://example/avatar' }))
  assert.equal(handlers.has('bili:getCookies'), false)
  const nav = await handlers.get('bili:request')(trusted, '/x/web-interface/nav')
  assert.equal(nav.data.dangerous, undefined)
  await assert.rejects(handlers.get('bili:request')(trusted, 'https://evil.test/x/web-interface/nav'))
  assert.throws(() => handlers.get('bili:getLoginStatus')({ senderFrame: { url: 'https://evil.test' } }))
})

test('long audio bookmarks and smooth, cancellable volume envelope', async () => {
  const store = new Map()
  const localStorage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) }
  const playback = load('src/services/playback.ts', { globals: { localStorage } })
  playback.rememberPosition('short', 60, 800)
  assert.equal(playback.savedPosition('short'), 0)
  playback.rememberPosition('long', 432, 1800)
  assert.equal(playback.savedPosition('long'), 432)
  playback.rememberPosition('long', 1795, 1800)
  assert.equal(playback.savedPosition('long'), 0)
  const audio = { volume: 1 }
  const fade = playback.fadeVolume(audio, 0, 150)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.ok(audio.volume > 0 && audio.volume < 1)
  await playback.fadeVolume(audio, .8, 50)
  await fade
  assert.equal(audio.volume, .8)
})


test('pending playback times out or cancels so CDN refresh cannot hang', async () => {
  const playback = load('src/services/playback.ts')
  const controller = new AbortController()
  const pending = { play: () => new Promise(() => {}) }
  await assert.rejects(playback.startPlayback(pending, controller.signal, 15), /超时/)
  const request = playback.startPlayback(pending, controller.signal)
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
  let called = false
  await assert.rejects(playback.startPlayback({ play: () => { called = true; return Promise.resolve() } }, controller.signal), { name: 'AbortError' })
  assert.equal(called, false)
  await playback.startPlayback({ play: () => Promise.resolve() }, new AbortController().signal)
})


test('QR headers persist full cookie values to both stores, survive init, flush, verify nav and logout', async () => {
  const handlers = new Map()
  function store() {
    const values = new Map()
    return { values, flushes: 0, get: async () => [...values.values()],
      set: async cookie => { values.set(cookie.name, cookie) },
      remove: async (_url, name) => values.delete(name),
      async flushStore() { this.flushes++ } }
  }
  const primary = store(), isolated = store()
  let navMode = 'valid'
  let headers = ['SESSDATA=encoded%2Fsecret==; Domain=.bilibili.com; Path=/; HttpOnly; Secure; Max-Age=86400',
    'bili_jct=csrf-value; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/', 'DedeUserID=123; Path=/', 'DedeUserID__ckMd5=checksum; Path=/']
  const auth = { cookies: isolated, fetch: async input => {
    if (input.includes('/poll')) return new Response(JSON.stringify({ code: 0, data: { code: 0, url: '' } }), { headers: headers.map(value => ['set-cookie', value]) })
    if (navMode === 'network') throw new Error('offline')
    if (navMode === 'expired') return Response.json({ code: -101 })
    return Response.json({ code: 0, data: { isLogin: true, mid: 123, uname: 'Listener', face: 'avatar' } })
  } }
  const electron = { ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, session: { defaultSession: { cookies: primary }, fromPartition: () => auth } }
  const api = load('electron/biliApi.ts', { electron, './security': { assertTrustedSender() {} }, './downloads': { registerDownloadHandlers() {} } })
  api.registerBiliApiHandlers()
  const invoke = (name, ...args) => handlers.get('bili:' + name)(trusted, ...args)
  assert.equal((await invoke('qrPoll', 'test')).status, 0)
  for (const cookies of [primary, isolated]) {
    assert.equal(cookies.values.get('SESSDATA').value, 'encoded%2Fsecret==')
    assert.ok(cookies.values.get('SESSDATA').expirationDate > Date.now() / 1000)
    assert.equal(cookies.values.get('bili_jct').expirationDate, Date.parse('2031-01-01') / 1000)
    assert.equal(cookies.values.get('DedeUserID__ckMd5').value, 'checksum')
    assert.equal(cookies.flushes, 1)
  }
  await api.initializeBiliAuth()
  assert.equal(primary.values.get('SESSDATA').value, isolated.values.get('SESSDATA').value)
  assert.equal((await invoke('getLoginStatus')).uname, 'Listener')
  navMode = 'network'
  assert.equal((await invoke('getLoginStatus')).isLogin, true)
  navMode = 'expired'
  assert.equal((await invoke('getLoginStatus')).isLogin, false)
  assert.equal(api.parseSetCookie('SESSDATA=bad; Domain=evil.test'), null)
  await invoke('logout')
  assert.equal(primary.values.size, 0)
  assert.equal(isolated.values.size, 0)
  headers = ['SESSDATA=partial; Path=/']
  await assert.rejects(invoke('qrPoll', 'partial'), /不完整/)
})

test('duration conversion and video-detail fallback avoid fabricated durations', async () => {
  const duration = load('src/utils/duration.ts')
  assert.equal(duration.parseDuration('03:45'), 225)
  assert.equal(duration.parseDuration('1:02:03'), 3723)
  assert.equal(duration.parseDuration(196), 196)
  assert.equal(duration.parseDuration(undefined, 'bad', 0, '04:01'), 241)
  assert.equal(duration.parseDuration(NaN, Infinity, '-10'), 0)
  let details = 0, active = 0, peak = 0
  const renderer = {
    getMusicComprehensiveRank: async () => [
      { bvid: 'metadata', related_archive: { bvid: 'BV1', duration: '03:45' } },
      ...Array.from({ length: 7 }, (_, i) => ({ bvid: 'BV' + (i + 2) })),
    ],
    getVideoDetail: async () => { details++; active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return { pages: [{ duration: 189 }] } },
  }
  const api = load('src/services/api.ts', { '@/services/bilibiliApi': renderer, '@/utils/duration': duration })
  const songs = await api.getMusicCenterRank()
  assert.equal(songs[0].duration, 225)
  assert.ok(songs.slice(1).every(song => song.duration === 189))
  assert.equal(details, 7)
  assert.ok(peak <= 4)
  await api.getMusicCenterRank()
  assert.equal(details, 7, 'detail durations are cached')
})

test('shuffle visits all songs once and preserves history across metadata updates', () => {
  const { shuffleArray, shuffledFrom, reconcileShuffle } = load('src/utils/playQueue.ts')
  const tracks = Array.from({ length: 30 }, (_, id) => ({ id: String(id), title: String(id) }))
  for (let cycle = 0; cycle < 50; cycle++) {
    const order = shuffledFrom(tracks, '17')
    assert.equal(order[0].id, '17')
    assert.equal(new Set(order.map(t => t.id)).size, tracks.length)
    const updated = reconcileShuffle(order, tracks.map(t => ({ ...t, isLiked: true })), '17')
    assert.equal(updated.map(t => t.id).join(','), order.map(t => t.id).join(','))
    assert.ok(updated.every(t => t.isLiked))
    const next = reconcileShuffle(updated, [...tracks.slice(1), { id: 'new' }], '17')
    assert.equal(next.at(-1).id, 'new')
    assert.ok(next.every(t => t.id !== '0'))
  }
  assert.equal(shuffleArray([1,2,3,4], () => 0).join(','), '2,3,4,1')
  assert.equal(tracks[0].id, '0', 'input remains ordered')
})

test('lyric bounds reach all four edges and remain visible on small/negative-origin screens', () => {
  const { clampLyricBounds } = load('electron/lyricGeometry.ts')
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -800, y: -400, width: 800, height: 600 }]) {
    const left = clampLyricBounds(-9999, -9999, 900, 100, area)
    assert.equal(left.x - area.x, 4)
    assert.equal(left.y - area.y, 4)
    const right = clampLyricBounds(9999, 9999, 900, 100, area)
    assert.equal(area.x + area.width - right.x - right.width, 4)
    assert.equal(area.y + area.height - right.y - right.height, 4)
  }
})
