// Real Chromium HTTP transport probe. Synthetic cookies only, isolated persistent profile.
const { app, session } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const output = path.resolve('artifacts/qr-network')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/set') res.setHeader('Set-Cookie', [
      'SESSDATA=synthetic%2Fvalue==; Path=/; HttpOnly',
      'bili_jct=synthetic-csrf; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT',
      'DedeUserID=123; Path=/',
    ])
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || 'http://127.0.0.1')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ cookieSent: !!req.headers.cookie }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const auth = session.fromPartition('persist:network-regression')
    const url = `http://127.0.0.1:${server.address().port}`
    console.log('network probe: response headers')
    const response = await auth.fetch(url + '/set', { credentials: 'include' })
    await response.text()
    const headers = response.headers.getSetCookie()
    const options = { headers: { Origin: `http://127.0.0.1:${server.address().port + 1}` } }
    console.log('network probe: implicit credentials')
    const implicit = await (await auth.fetch(url + '/echo', options)).json()
    console.log('network probe: explicit credentials')
    const explicit = await (await auth.fetch(url + '/echo', { ...options, credentials: 'include' })).json()
    assert.equal(headers.length, 1, 'Electron 36 coalesces three Set-Cookie headers into one entry')
    assert.ok(headers[0].includes('SESSDATA=') && headers[0].includes('bili_jct=') && headers[0].includes('DedeUserID='))
    assert.equal(implicit.cookieSent, false, 'cross-origin default credentials omit session cookies')
    assert.equal(explicit.cookieSent, true, 'explicit include sends session cookies')
    const result = { passed: true, electron: process.versions.electron, serverSetCookieCount: 3, getSetCookieCount: headers.length, defaultCrossOriginCookieSent: implicit.cookieSent, explicitIncludeCookieSent: explicit.cookieSent }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } finally { await new Promise(resolve => server.close(resolve)) }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
