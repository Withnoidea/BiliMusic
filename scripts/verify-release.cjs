// Verify the shipped ASAR against the current build and emit an exact artifact inventory.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '..')
process.chdir(root)
const { version } = require('../package.json')
const archive = 'release/win-unpacked/resources/app.asar'
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function verify() {
  const built = [...walk('dist'), ...walk('dist-electron')]
  for (const file of built) assert.ok(fs.readFileSync(file).equals(asar.extractFile(archive, file)), `ASAR differs: ${file}`)
  for (const name of ['preload.cjs', 'auxiliary-preload.cjs']) assert.ok(fs.readFileSync(`electron/${name}`).equals(fs.readFileSync(`dist-electron/${name}`)), `Preload differs: ${name}`)
  const smoke = JSON.parse(fs.readFileSync('artifacts/qa-packaged/smoke-result.json', 'utf8'))
  assert.ok(smoke.passed && smoke.packaged, 'Packaged smoke test must pass')
  const unpacked = walk('release/win-unpacked')
  const installer = `release/BiliMusic-Setup-${version}-x64.exe`
  const portable = `release/BiliMusic-${version}-win-x64-portable.zip`
  const files = [...built, ...unpacked, installer, installer + '.blockmap', portable, 'release/latest.yml', 'release/builder-debug.yml']
  const inventory = []
  for (const file of files) {
    const stat = fs.statSync(file)
    assert.ok(stat.size > 0, `Empty artifact: ${file}`)
    inventory.push({ path: file.replaceAll('\\', '/'), bytes: stat.size, modifiedAt: stat.mtime.toISOString(), sha256: await digest(file) })
  }
  const manifest = {
    version, verifiedAt: new Date().toISOString(), status: 'PASS', buildErrors: 0,
    verifiedPackagedAssets: built.length, packagedSmokeChecks: smoke.checks,
    unpacked: { path: 'release/win-unpacked', files: unpacked.length, bytes: unpacked.reduce((sum, file) => sum + fs.statSync(file).size, 0) },
    files: inventory,
  }
  fs.writeFileSync('release/release-manifest.json', JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ status: manifest.status, version, verifiedPackagedAssets: built.length, unpacked: manifest.unpacked, artifacts: inventory.filter(file => [installer, portable, 'release/latest.yml', installer + '.blockmap', 'release/win-unpacked/BiliMusic.exe'].includes(file.path)) }, null, 2))
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
