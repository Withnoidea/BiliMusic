import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import asar from '@electron/asar'

// 把构建好的 dist/ 打成 renderer-<version>.asar，算 sha512，生成 ota.json。
// 与整包安装器一同发布到 GitHub Releases，供渲染热补丁（方案 B）下发。
const root = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version

const distDir = path.join(root, 'dist')
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/index.html 不存在，请先运行 npm run build')
  process.exit(1)
}

const outDir = path.join(root, 'release', 'ota')
fs.mkdirSync(outDir, { recursive: true })

const asarName = `renderer-${version}.asar`
const asarPath = path.join(outDir, asarName)
await asar.createPackage(distDir, asarPath)

const buf = fs.readFileSync(asarPath)
const sha512 = crypto.createHash('sha512').update(buf).digest('base64')

// minShellVersion：能运行此渲染包的最低外壳版本。渲染层若未用到新 IPC/主进程能力，
// 默认使用当前版本，避免主进程修复仅更新界面；确认兼容旧外壳后才设置 OTA_MIN_SHELL。
const minShellVersion = process.env.OTA_MIN_SHELL || version

const manifest = {
  rendererVersion: version,
  shellVersion: version,
  minShellVersion,
  file: asarName,
  sha512,
  size: buf.length,
  notes: process.env.OTA_NOTES || '',
  releasedAt: new Date().toISOString(),
}
fs.writeFileSync(path.join(outDir, 'ota.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`OTA 渲染包：release/ota/${asarName} (${(buf.length / 1048576).toFixed(2)} MB)`)
console.log(`manifest：release/ota/ota.json  rendererVersion=${version} minShellVersion=${minShellVersion}`)
