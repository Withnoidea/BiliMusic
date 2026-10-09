const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
function load(file, mocks = {}) {
  const source = ts.transpileModule(readFileSync(path.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports = {}
  vm.runInNewContext(source, { exports, require: name => mocks[name] || require(name), console, process, Buffer, URL, Response, AbortController, setTimeout, clearTimeout, ...mocks.globals }, { filename: file })
  return exports
}
const duration = load('src/utils/duration.ts')
const video = (id, changes = {}) => ({ bvid: id, aid: 1, title: '原创歌曲 Live', desc: '', duration: 180, pic: '', ownerName: 'Artist', ownerMid: 1, cid: 1, stat: { view: 1000, like: 10, favorite: 5 }, ...changes })
const api = (mocks = {}) => load('src/services/api.ts', { '@/utils/duration': duration, '@/services/bilibiliApi': mocks })

test('natural end: repeat-one takes precedence, list loops with/without shuffle, sequential stops', () => {
  const { trackEndAction, shuffledFrom } = load('src/utils/playQueue.ts')
  assert.equal(trackEndAction('one', false, 0, -1), 'replay')
  assert.equal(trackEndAction('all', false, 3, 0), 'stop')
  assert.equal(trackEndAction('all', true, 0, -1), 'stop')
  for (const shuffled of [false, true]) {
    const tracks = ['a', 'b', 'c'].map(id => ({ id }))
    const queue = shuffled ? shuffledFrom(tracks, 'a') : tracks
    let index = 0
    const visited = []
    for (let count = 0; count < 3; count++) { visited.push(queue[index].id); index = trackEndAction('all', true, queue.length, index) }
    assert.equal(new Set(visited).size, 3)
    assert.equal(index, 0)
    assert.equal(trackEndAction('none', true, 3, 2), 'stop')
  }
  assert.equal(trackEndAction('all', true, 1, 0), 0)
  assert.equal(trackEndAction('none', true, 1, 0), 'stop')
})

test('music cleaning enforces inclusive duration, title/description blacklist, category and weighting', () => {
  const { cleanMusicVideos, musicScore } = api()
  const list = [video('short', { duration: 59 }), video('long', { duration: 601 }), video('unknown', { duration: 0 }), video('bad', { desc: '这是一个乐理教学' }), video('review', { title: 'MV 解说' }), video('unrelated', { title: '今日美食' }), video('trailer', { title: 'Official Live Trailer' }), video('min', { duration: 60 }), video('max', { duration: 600 }), video('min'), video('seen')]
  assert.deepEqual(Array.from(cleanMusicVideos(list, new Set(['seen'])), item => item.bvid), ['min', 'max'])
  assert.ok(musicScore(video('cover', { title: 'Cover', musicCategory: true })) > musicScore(video('plain', { title: '晴天', musicCategory: true })))
  assert.equal(cleanMusicVideos([video('html', { title: '<em>MV</em> 翻唱' })])[0].title, 'MV 翻唱')
})

test('refresh replenishes across genre pages, never repeats seen tracks and tolerates failed sources', async () => {
  const calls = []
  let count = 0
  const service = api({
    searchVideo: async (keyword, page, _size, filters) => {
      calls.push({ keyword, page, filters })
      return { numPages: 50, result: [0, 1, 2, 3].map(() => ({ bvid: 'BV' + ++count, aid: 1, title: 'Official 单曲', author: 'Singer', duration: '03:20', description: '', tag: 'MV', pic: '', play: 20 })) }
    },
    getMusicRanking: async () => [],
    getRecommendedVideos: async () => { throw new Error('offline') },
    getMusicDynamics: async () => { throw new Error('not logged in') },
    getMusicComprehensiveRank: async () => [],
    getNewMusic: async () => [],
    getRelatedVideos: async () => [],
  })
  const seen = new Set()
  const first = await service.getMusicFeed({ mode: 'recommend', seed: 10, seenTrackIds: seen, limit: 12 })
  first.forEach(item => seen.add(item.bvid))
  const second = await service.getMusicFeed({ mode: 'discover', seed: 11, seenTrackIds: seen, limit: 12 })
  assert.equal(first.length, 12)
  assert.equal(second.length, 12)
  assert.ok(second.every(item => !seen.has(item.bvid)))
  assert.ok(new Set(calls.map(call => call.keyword)).size >= 3)
  assert.ok(calls.every(call => call.filters.order && call.page >= 1))
  const mix = service.mixMusicPools([[video('a'), video('b')], [video('a'), video('c')]], new Set(), 3)
  assert.equal(new Set(mix.map(item => item.bvid)).size, 3)
})

test('default settings migrate to MP3 while an explicit M4A preference survives', () => {
  let raw = '{}'
  const storage = load('src/utils/storage.ts', { '@/utils/persistentStorage': { readStoredItem: () => raw } })
  assert.equal(storage.loadAppSettings().downloadFormat, 'mp3')
  raw = '{"downloadFormat":"m4a"}'
  assert.equal(storage.loadAppSettings().downloadFormat, 'm4a')
  raw = '{"downloadFormat":"exe"}'
  assert.equal(storage.loadAppSettings().downloadFormat, 'mp3')
})

test('real FFmpeg export contains MP3 audio, ID3 title/artist/album/cover and final-size integrity receipt', async () => {
  const root = await fs.mkdtemp(path.resolve('artifacts/mp3-test-'))
  const handlers = new Map(), protocols = new Map(), reports = []
  const source = await fs.readFile('tests/fixtures/silence.m4a')
  const cover = await fs.readFile('electron/icon.png')
  const electron = {
    app: { getPath: () => root },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { handle: (name, fn) => protocols.set(name, fn) },
    net: { fetch: async url => new Response(url.includes('hdslb.com') ? cover : source, { headers: { 'content-type': url.includes('hdslb.com') ? 'image/png' : 'audio/mp4', 'content-length': String(url.includes('hdslb.com') ? cover.length : source.length) } }) },
  }
  const transcode = load('electron/transcode.ts', { electron })
  const security = load('electron/security.ts', { electron })
  load('electron/downloads.ts', { electron, './security': security, './transcode': transcode }).registerDownloadHandlers()
  const event = { senderFrame: { url: 'app://local/index.html' }, sender: { isDestroyed: () => false, send: (_channel, data) => reports.push(data) } }
  const invoke = (name, ...args) => handlers.get('bili:' + name)(event, ...args)
  try {
    const metadata = { title: '测试歌曲', artist: '测试歌手', album: '测试专辑', coverUrl: 'https://i0.hdslb.com/cover.png' }
    const result = await invoke('downloadAudio', 'https://test.bilivideo.com/audio', 'test.mp3', undefined, metadata)
    const bytes = await fs.readFile(result.filePath)
    assert.equal(bytes.length, result.size)
    assert.notEqual(bytes.length, source.length)
    assert.equal(bytes.toString('ascii', 0, 3), 'ID3')
    for (const frame of ['TIT2', 'TPE1', 'TALB', 'APIC']) assert.ok(bytes.includes(Buffer.from(frame)), frame)
    for (const text of [metadata.title, metadata.artist, metadata.album]) assert.ok(bytes.includes(Buffer.from(text, 'utf16le')), text)
    assert.ok(bytes.includes(Buffer.from('image/jpeg')))
    execFileSync(require('ffmpeg-static'), ['-v', 'error', '-i', result.filePath, '-map', '0:a:0', '-f', 'null', '-'], { windowsHide: true })
    assert.ok(reports.some(item => item.phase === 'transcoding'))
    assert.equal(reports.at(-1).percent, 100)
    const local = await invoke('localAudio', 'test.mp3', undefined, result.size)
    assert.ok(local)
    const response = await protocols.get('bilimusic-audio')({ url: local, method: 'GET', headers: new Headers({ range: 'bytes=0-15' }) })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-type'), 'audio/mpeg')
    await response.arrayBuffer()
    await fs.writeFile(result.filePath, Buffer.alloc(result.size))
    assert.equal(await invoke('localAudio', 'test.mp3', undefined, result.size), null)
    await assert.rejects(invoke('downloadAudio', 'https://test.bilivideo.com/audio', 'bad.mp3', undefined, { ...metadata, coverUrl: 'https://evil.test/cover' }))
    assert.ok(!(await fs.readdir(path.dirname(result.filePath))).some(name => name.includes('.part')))
    assert.throws(() => transcode.validateMetadata({ title: 'bad\0tag' }))
    assert.doesNotThrow(() => security.validateAudioFilename('song.mp3'))
  } finally {
    assert.ok(root.startsWith(path.resolve('artifacts') + path.sep))
    await fs.rm(root, { recursive: true, force: true })
  }
})
