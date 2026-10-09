const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const cookieHeaders = [
  'DedeUserID=123; Path=/; Domain=.bilibili.com; Expires=Wed, 01 Jan 2031 00:00:00 GMT',
  'DedeUserID__ckMd5=checksum; Path=/; Domain=.bilibili.com',
  'SESSDATA=synthetic%2Cvalue%2F==; Path=/; Domain=.bilibili.com; HttpOnly; Secure',
  'bili_jct=synthetic-csrf; Path=/; Domain=.bilibili.com',
  'sid=synthetic-sid; Path=/; Domain=.bilibili.com',
]
function setup() {
  const handlers = new Map()
  const calls = []
  const stores = [0, 1].map(() => ({ values: new Map(), flushes: 0,
    async get() { return [...this.values.values()] },
    async set(cookie) { this.values.set(cookie.name, cookie) },
    async flushStore() { this.flushes++ },
    async remove(_url, name) { this.values.delete(name) },
  }))
  const state = { nav: 'ok', payload: { code: 0, data: { code: 0, url: '' } }, headers: cookieHeaders, block: null }
  const auth = { cookies: stores[1], fetch: async (url, options) => {
    calls.push({ url, options })
    assert.equal(options.credentials, 'include', 'all authenticated requests must explicitly include credentials')
    if (url.includes('/poll')) {
      if (state.block) await state.block
      // Exact Electron 36 shape: ONE header entry, not new Response's header array.
      return Response.json(state.payload, { headers: { 'set-cookie': state.headers.join(', ') } })
    }
    assert.ok(url.endsWith('/nav'), 'never navigate credential-bearing callback URLs')
    if (state.nav === 'offline') throw new Error('simulated network failure')
    return Response.json({ code: 0, data: { isLogin: state.nav === 'ok', mid: 123, uname: 'Listener', face: 'avatar' } })
  } }
  const exports = {}
  const electron = { session: { defaultSession: { cookies: stores[0] }, fromPartition: () => auth }, ipcMain: { handle: (key, fn) => handlers.set(key, fn) } }
  const source = ts.transpileModule(readFileSync('electron/biliApi.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(source, { exports, require: name => name === 'electron' ? electron : name === './security' ? { assertTrustedSender() {} } : { registerDownloadHandlers() {} }, URL, Response, AbortSignal, console })
  exports.registerBiliApiHandlers()
  return { api: exports, state, stores, calls, poll: key => handlers.get('bili:qrPoll')({}, key), logout: () => handlers.get('bili:logout')({}) }
}
test('Electron-coalesced Set-Cookie preserves all credentials, Expires commas and embedded equals', async () => {
  const { api, stores, poll, calls } = setup()
  assert.equal(api.splitSetCookieHeaders([cookieHeaders.join(', ')]).length, 5)
  const result = await poll('joined')
  assert.equal(result.status, 0)
  for (const store of stores) {
    assert.equal(store.values.size, 5)
    assert.equal(store.values.get('SESSDATA').value, 'synthetic%2Cvalue%2F==')
    assert.equal(store.values.get('DedeUserID').expirationDate, Date.parse('2031-01-01') / 1000)
    assert.equal(store.flushes, 1)
  }
  assert.equal((await poll('joined')).status, 0)
  assert.equal(calls.filter(c => c.url.includes('/poll')).length, 1, 'completed QR cannot be consumed twice')
  assert.equal(JSON.stringify(result).includes('synthetic'), false, 'no credentials in IPC')
})
test('confirmation followed by cookie-write failure is retryable, not expired, and does not re-poll consumed QR', async () => {
  const { stores, poll, calls } = setup()
  const originalSet = stores[0].set.bind(stores[0])
  stores[0].set = async () => { throw new Error('Chromium cookie failure with synthetic-secret') }
  const failed = await poll('write-failure')
  assert.equal(failed.status, -2)
  assert.equal(failed.confirmed, true)
  assert.equal(failed.retryable, true)
  assert.ok(!JSON.stringify(failed).includes('synthetic-secret'))
  stores[0].set = originalSet
  assert.equal((await poll('write-failure')).status, 0)
  assert.equal(calls.filter(c => c.url.includes('/poll')).length, 1)
})
test('flush failure and nav outage retry saved confirmation; unverified credentials are not called logged in', async () => {
  const { stores, state, poll, calls } = setup()
  const flush = stores[1].flushStore.bind(stores[1])
  stores[1].flushStore = async () => { throw new Error('disk temporarily unavailable') }
  assert.equal((await poll('retry')).status, -2)
  stores[1].flushStore = flush
  state.nav = 'offline'
  assert.equal((await poll('retry')).status, -2)
  state.nav = 'logged-out'
  assert.equal((await poll('retry')).status, -2)
  state.nav = 'ok'
  assert.equal((await poll('retry')).status, 0)
  assert.equal(calls.filter(c => c.url.includes('/poll')).length, 1)
})
test('legacy HTTP callback is read locally without decoding cookie values or following URLs', async () => {
  const { state, stores, poll, calls } = setup()
  state.headers = []
  state.payload.data.url = 'http://passport.bilibili.com/crossDomain?DedeUserID=123&SESSDATA=synthetic%2Cvalue%2F==&bili_jct=csrf&gourl=https%3A%2F%2Fevil.test'
  assert.equal((await poll('callback')).status, 0)
  assert.equal(stores[0].values.get('SESSDATA').value, 'synthetic%2Cvalue%2F==')
  assert.equal(calls.length, 2)
})
test('malformed optional callback cannot discard complete response headers', async () => {
  const { state, poll } = setup()
  state.payload.data.url = 'not a URL'
  assert.equal((await poll('invalid-callback')).status, 0)
})
test('missing credentials and hostile callbacks stay confirmed errors instead of becoming expired', async () => {
  for (const url of ['https://passport.bilibili.com.evil.test/?', 'file://bilibili.com/?', 'https://user:pass@bilibili.com/?']) {
    const { state, poll, calls } = setup()
    state.headers = []
    state.payload.data.url = url + 'DedeUserID=123&SESSDATA=bad&bili_jct=bad'
    assert.equal((await poll('incomplete')).status, -2)
    state.payload = { code: 0, data: { code: 86038 } } // what the server returns after consuming it
    assert.equal((await poll('incomplete')).status, -2)
    assert.equal(calls.length, 1)
  }
})
test('partial new-account cookies never merge credentials from a different old account', async () => {
  const { stores, state, poll } = setup()
  for (const [name, value] of [['DedeUserID', '999'], ['SESSDATA', 'old-secret'], ['bili_jct', 'old-csrf']]) {
    await stores[1].set({ name, value })
  }
  state.headers = ['DedeUserID=123; Path=/']
  assert.equal((await poll('other-account')).status, -2)
})
test('concurrent calls share one poll; unconfirmed 86038 alone represents QR expiry', async () => {
  const { state, poll, calls } = setup()
  let release
  state.block = new Promise(resolve => { release = resolve })
  const a = poll('same-key'), b = poll('same-key')
  release()
  assert.equal((await a).status, 0)
  assert.equal((await b).status, 0)
  assert.equal(calls.filter(c => c.url.includes('/poll')).length, 1)
  state.payload = { code: 0, data: { code: 86038 } }
  const expired = await poll('expired')
  assert.equal(expired.status, 86038)
  assert.equal(expired.confirmed, undefined)
})
