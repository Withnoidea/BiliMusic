// Verify the shipped ASAR against the current build and emit an exact artifact inventory.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '..')
process.chdir(root)
const { version } = require('../package.json')
const releaseDir = (process.argv[2] || 'release').replaceAll('\\', '/').replace(/\/$/, '')
const archive = `${releaseDir}/win-unpacked/resources/app.asar`
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
  const shippedPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString())
  assert.equal(shippedPackage.version, version)
  const updateConfig = fs.readFileSync(`${releaseDir}/win-unpacked/resources/app-update.yml`, 'utf8')
  assert.match(updateConfig, /owner: Withnoidea/)
  assert.match(updateConfig, /repo: BiliMusic/)
  assert.ok(!fs.readFileSync('dist-electron/main.js', 'utf8').includes('HanversionOvO/BiliMusic'), 'compiled updater must not reference upstream')
  const smoke = JSON.parse(fs.readFileSync('artifacts/qa-packaged/smoke-result.json', 'utf8'))
  assert.ok(smoke.passed && smoke.packaged, 'Packaged smoke test must pass')
  assert.equal(smoke.appVersion, version)
  assert.equal(smoke.testedAsarSha256, await digest(archive), 'Smoke test must match this exact ASAR')
  const ota = JSON.parse(fs.readFileSync(`${releaseDir}/ota/ota.json`, 'utf8'))
  assert.equal(ota.rendererVersion, version)
  assert.equal(ota.shellVersion, version)
  assert.equal(ota.minShellVersion, version)
  assert.equal(ota.file, `renderer-${version}.asar`)
  const otaBundle = `${releaseDir}/ota/${ota.file}`
  assert.equal(createHash('sha512').update(fs.readFileSync(otaBundle)).digest('base64'), ota.sha512)
  for (const file of walk('dist')) assert.ok(fs.readFileSync(file).equals(asar.extractFile(otaBundle, path.relative('dist', file))), `OTA differs: ${file}`)
  const unpacked = walk(`${releaseDir}/win-unpacked`)
  const installer = `${releaseDir}/BiliMusic-Setup-${version}-x64.exe`
  const portable = `${releaseDir}/BiliMusic-${version}-win-x64-portable.zip`
  const files = [...built, ...unpacked, installer, installer + '.blockmap', portable, `${releaseDir}/latest.yml`, `${releaseDir}/builder-debug.yml`, `${releaseDir}/ota/ota.json`, otaBundle]
  const inventory = []
  for (const file of files) {
    const stat = fs.statSync(file)
    assert.ok(stat.size > 0, `Empty artifact: ${file}`)
    inventory.push({ path: file.replaceAll('\\', '/'), bytes: stat.size, modifiedAt: stat.mtime.toISOString(), sha256: await digest(file) })
  }
  const manifest = {
    version, verifiedAt: new Date().toISOString(), status: 'PASS', buildErrors: 0,
    verifiedPackagedAssets: built.length, packagedSmokeChecks: smoke.checks, packagedSmokeSkipped: smoke.skippedChecks || [],
    unpacked: { path: `${releaseDir}/win-unpacked`, files: unpacked.length, bytes: unpacked.reduce((sum, file) => sum + fs.statSync(file).size, 0) },
    files: inventory,
  }
  fs.writeFileSync(`${releaseDir}/release-manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ status: manifest.status, version, verifiedPackagedAssets: built.length, unpacked: manifest.unpacked, artifacts: inventory.filter(file => [installer, portable, `${releaseDir}/latest.yml`, installer + '.blockmap', `${releaseDir}/win-unpacked/BiliMusic.exe`].includes(file.path)) }, null, 2))
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
