const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, mocks = {}, append = '', globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8') + append, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(source, { exports, require: name => mocks[name] ?? require(name), console, Buffer, URL, Response,
    AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, process, ...globals }, { filename: file })
  return exports
}
const project = load('src/config/project.ts')

// Run the detail's actual hooks/effects to a fixed point, with a hard render cap.
function detailHarness(initial) {
  let playlist = initial, cursor = 0, pending = false, renders = 0, tree
  const hooks = [], effects = [], listeners = new Map(), navigations = []
  const depsChanged = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  const react = {
    useState(initialValue) {
      const i = cursor++
      if (!hooks[i]) hooks[i] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }
      return [hooks[i].value, update => {
        const next = typeof update === 'function' ? update(hooks[i].value) : update
        if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; pending = true }
      }]
    },
    useMemo(fn, deps) {
      const i = cursor++
      if (depsChanged(hooks[i]?.deps, deps)) hooks[i] = { deps, value: fn() }
      return hooks[i].value
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const i = cursor++
      if (depsChanged(hooks[i]?.deps, deps)) effects.push(() => {
        hooks[i]?.cleanup?.()
        hooks[i] = { deps, cleanup: fn() }
      })
    },
  }
  const notify = () => { for (const fn of listeners.get('changed') || []) fn() }
  const storage = {
    getPlaylist: () => playlist ? JSON.parse(JSON.stringify(playlist)) : null,
    PLAYLISTS_CHANGED_EVENT: 'changed',
    deletePlaylist() { playlist = null; notify() },
  }
  const window = {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn) },
  }
  const { PlaylistDetail } = load('src/pages/Playlists.tsx', {
    react, 'react-router-dom': { useNavigate: () => (...args) => navigations.push(args) },
    '@/contexts/PlayerContext': { usePlayer: () => ({ showToast() {} }) },
    '@/contexts/ImportContext': { useImport: () => ({ records: {} }) },
    '@/services/downloadManager': { isTrackDownloaded: () => false },
    '@/components/AddToPlaylistButton': {}, '@/components/AppleMusicPage': {}, '@/utils/storage': storage,
  }, '\nexport { PlaylistDetail }', { window })
  function settle() {
    do {
      assert.ok(++renders < 30, 'detail render/effect loop must settle after missing or deleted playlist')
      cursor = 0; pending = false; tree = PlaylistDetail({ playlistId: 'test' })
      while (effects.length) effects.shift()()
    } while (pending)
    return tree
  }
  return { settle, delete: storage.deletePlaylist, navigations, get renders() { return renders } }
}

test('missing, empty and externally deleted playlists settle without render loops', () => {
  for (const initial of [null, { id: 'test', name: 'Test', tracks: [] }, { id: 'test', name: 'Test', tracks: [{ id: 'one' }] }]) {
    const harness = detailHarness(initial)
    harness.settle()
    harness.delete()
    harness.settle()
    assert.ok(harness.renders < 10)
  }
})

test('build publisher and runtime URLs all belong to the fork', () => {
  const pkg = require('../package.json')
  assert.equal(`${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}`, project.PROJECT_REPOSITORY)
  assert.equal(project.PROJECT_REPOSITORY, 'Withnoidea/BiliMusic')
  assert.equal(pkg.homepage, project.PROJECT_URL)
  assert.equal(pkg.build.appId, 'com.hanversion.bilimusic', 'preserve app identity and user data')
  for (const file of ['electron/updater.ts', 'electron/otaUpdater.ts', 'src/pages/Settings.tsx']) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes('HanversionOvO/BiliMusic'), file)
  }
})

const validManifest = { rendererVersion: '1.0.5', shellVersion: '1.0.5', minShellVersion: '1.0.4', file: 'renderer-1.0.5.asar', sha512: Buffer.alloc(64).toString('base64') }
function otaHarness(fetch, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilimusic-ota-test-'))) {
  const events = [], handlers = new Map()
  const ota = load('electron/otaUpdater.ts', {
    electron: { app: { getPath: () => dir, getVersion: () => '1.0.4' }, net: { fetch }, ipcMain: { on: (name, cb) => handlers.set(name, cb) } },
    './updaterBus': { emitUpdater: event => events.push(event), ulog() {} }, '../src/config/project': project,
  })
  ota.initOtaUpdater({ bundledRendererRoot: '/bundled', reload() {} })
  return { ota, events, handlers, dir }
}

test('OTA 404 is absent, invalid metadata/errors are not silently up-to-date', async () => {
  const urls = []
  let response = new Response('', { status: 404 })
  const { ota } = otaHarness(async (url, options) => { urls.push(url); assert.ok(options.signal); return response })
  assert.equal(await ota.fetchManifest(), null)
  response = new Response('{}')
  await assert.rejects(ota.fetchManifest(), /清单格式无效/)
  response = new Response('', { status: 503 })
  await assert.rejects(ota.fetchManifest(), /HTTP 503/)
  response = new Response(JSON.stringify(validManifest))
  assert.equal((await ota.fetchManifest()).file, validManifest.file)
  assert.ok(urls.every(url => url === project.RELEASE_DOWNLOAD_BASE + '/ota.json'))
  await assert.rejects(ota.stageRendererUpdate({ ...validManifest, file: '../outside.asar' }), /清单格式无效/)
})

test('upstream OTA, stale fork bundles and path traversal never replace shipped renderer', () => {
  for (const [namespace, version, file] of [['', '9.0.0', 'renderer-9.0.0.asar'], ['Withnoidea-BiliMusic', '1.0.3', 'renderer-1.0.3.asar'], ['Withnoidea-BiliMusic', '9.0.0', '../outside.asar']]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilimusic-ota-migration-'))
    const otaDir = path.join(dir, 'ota', namespace)
    fs.mkdirSync(otaDir, { recursive: true })
    fs.writeFileSync(path.join(otaDir, file), 'fake old bundle')
    fs.writeFileSync(path.join(otaDir, 'state.json'), JSON.stringify({ activeVersion: version, activeFile: file, verified: true, pendingVersion: version, pendingFile: file, failedVersions: [] }))
    const { ota } = otaHarness(null, dir)
    assert.equal(ota.getActiveRendererRoot(), '/bundled')
    assert.ok(fs.existsSync(path.join(otaDir, file)), 'migration does not remove legacy data')
  }
})

test('valid newer fork renderer stages, promotes, verifies and survives next boot', async () => {
  const bundle = Buffer.from('test renderer bundle')
  const manifest = { ...validManifest, sha512: require('node:crypto').createHash('sha512').update(bundle).digest('base64') }
  const { ota, dir, events, handlers } = otaHarness(async (url, options) => {
    assert.equal(url, project.RELEASE_DOWNLOAD_BASE + '/' + manifest.file)
    assert.ok(options.signal)
    return new Response(bundle)
  })
  await ota.stageRendererUpdate(manifest)
  assert.equal(events.at(-1).type, 'renderer-ready-to-apply')
  handlers.get('updater:apply-now')()
  ota.markRendererVerified()
  const reloaded = otaHarness(null, dir).ota
  assert.equal(reloaded.getActiveRendererRoot(), path.join(dir, 'ota', 'Withnoidea-BiliMusic', manifest.file))
})

function updaterHarness({ fetch, manifest = null, packaged = false, rendererAvailable = false } = {}) {
  const events = [], opened = [], feed = [], listeners = new Map()
  let staged = 0, shellChecks = 0
  const updater = load('electron/updater.ts', {
    electron: { app: { getVersion: () => '1.0.4', isPackaged: packaged }, net: { fetch }, shell: { openExternal: async url => opened.push(url) } },
    './updaterBus': { emitUpdater: event => events.push(event), ulog() {} },
    '../src/config/project': project,
    './otaUpdater': { fetchManifest: async () => manifest, semverGt: (a, b) => a.localeCompare(b, undefined, { numeric: true }) > 0, rendererUpdateAvailable: () => rendererAvailable, stageRendererUpdate: async () => staged++ },
    'electron-updater': { autoUpdater: { setFeedURL: options => feed.push(options), on: (name, cb) => listeners.set(name, cb), checkForUpdates: async () => { shellChecks++; listeners.get('update-not-available')() } } },
  }, '', { process: { platform: 'win32', env: {} } })
  return { updater, events, opened, feed, get staged() { return staged }, get shellChecks() { return shellChecks } }
}

test('fork without a Release reports unavailable; network error releases check lock for retry', async () => {
  let mode = 'missing', calls = 0
  const h = updaterHarness({ fetch: async (url, opts) => {
    calls++; assert.equal(url, project.LATEST_RELEASE_API); assert.ok(opts.signal)
    if (mode === 'error') throw new Error('network unavailable')
    return new Response('', { status: 404 })
  } })
  await h.updater.checkForUpdates(true)
  assert.equal(h.events.at(-1).type, 'unavailable')
  assert.match(h.events.at(-1).message, /Withnoidea\/BiliMusic/)
  mode = 'error'; await h.updater.checkForUpdates(true)
  assert.equal(h.events.at(-1).type, 'error')
  mode = 'missing'; await h.updater.checkForUpdates(true)
  assert.equal(h.events.at(-1).type, 'unavailable')
  assert.equal(calls, 3)
  assert.equal(h.opened.length, 0)
})

test('missing OTA with newer stable Release opens only fork page; current Release is up-to-date', async () => {
  let tag = 'v1.0.5'
  const h = updaterHarness({ fetch: async () => new Response(JSON.stringify({ tag_name: tag })) })
  await h.updater.checkForUpdates(true)
  assert.deepEqual(h.opened, [project.RELEASES_URL])
  assert.equal(h.events.at(-1).type, 'manual')
  tag = 'v1.0.4'; await h.updater.checkForUpdates(true)
  assert.equal(h.events.at(-1).type, 'up-to-date')
  tag = 'invalid'; await h.updater.checkForUpdates(true)
  assert.equal(h.events.at(-1).type, 'error')
})

test('new shell takes precedence over OTA and electron-updater feed is pinned to fork', async () => {
  const h = updaterHarness({ manifest: validManifest, packaged: true, rendererAvailable: true })
  await h.updater.checkForUpdates(true)
  assert.equal(h.staged, 0)
  assert.equal(h.shellChecks, 1)
  assert.equal(h.feed[0].owner, 'Withnoidea')
  assert.equal(h.feed[0].repo, 'BiliMusic')
  assert.equal(h.events.at(-1).type, 'up-to-date')
})

test('manual click during automatic check receives the result without parallel requests', async () => {
  let resolveResponse, calls = 0
  const h = updaterHarness({ fetch: async () => {
    calls++
    return new Promise(resolve => { resolveResponse = resolve })
  } })
  const automatic = h.updater.checkForUpdates(false)
  await new Promise(resolve => setImmediate(resolve))
  await h.updater.checkForUpdates(true)
  assert.equal(h.events.at(-1).type, 'checking')
  resolveResponse(new Response('', { status: 404 }))
  await automatic
  assert.equal(h.events.at(-1).type, 'unavailable')
  assert.equal(calls, 1)
})
