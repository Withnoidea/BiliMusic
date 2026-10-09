import { app, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

export function assertTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url || ''
  const dev = process.env.VITE_DEV_SERVER_URL
  if (url.startsWith('app://local/') || (dev && new URL(url).origin === new URL(dev).origin)) return
  throw new Error('不允许的 IPC 来源')
}

export function validateAbsolutePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f]/.test(value)
    || !path.isAbsolute(value) || /^[/\\]{2}/.test(value) || value.slice(2).includes(':')
    || value.split(/[/\\]/).includes('..')) throw new Error('无效的本地路径')
  return path.resolve(value)
}
export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}
const grantsFile = () => path.join(app.getPath('userData'), 'download-roots.json')
async function grantedRoots(): Promise<string[]> {
  try { const data = JSON.parse(await fs.readFile(grantsFile(), 'utf8')); return Array.isArray(data) ? data : [] } catch { return [] }
}
export async function grantDirectory(value: string): Promise<string> {
  const root = await fs.realpath(validateAbsolutePath(value))
  if (!(await fs.stat(root)).isDirectory() || root === path.parse(root).root) throw new Error('请选择具体的文件夹，而不是磁盘根目录')
  const roots = await grantedRoots()
  if (!roots.includes(root)) await fs.writeFile(grantsFile(), JSON.stringify([...roots, root]))
  return root
}
export async function downloadDirectory(custom?: string): Promise<string> {
  const defaultRoot = path.join(app.getPath('userData'), 'downloads')
  await fs.mkdir(defaultRoot, { recursive: true })
  const requested = validateAbsolutePath(custom || defaultRoot)
  const actual = await fs.realpath(requested).catch(() => { throw new Error('下载目录不存在，请在设置中重新选择') })
  const allowed = [await fs.realpath(defaultRoot), ...await grantedRoots()]
  if (!allowed.some(root => path.relative(root, actual) === '')) throw new Error('下载目录未授权，请在设置中重新选择目录')
  return actual
}
export function validateAudioFilename(filename: unknown): asserts filename is string {
  if (typeof filename !== 'string' || filename.length > 180 || !filename.endsWith('.m4a')
    || /[<>:"/\\|?*\x00-\x1f]/.test(filename) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) throw new Error('无效的音频文件名')
}
export async function audioFile(filename: string, custom?: string): Promise<string> {
  validateAudioFilename(filename)
  const root = await downloadDirectory(custom)
  const target = path.join(root, filename)
  const stat = await fs.lstat(target).catch(() => null)
  if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error('不允许访问链接或非音频文件')
  if (stat && !isWithin(root, await fs.realpath(target))) throw new Error('文件超出授权目录')
  return target
}
export function validateAudioUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !['bilivideo.com', 'bilivideo.cn', 'akamaized.net'].some(domain => url.hostname.endsWith('.' + domain))) throw new Error('不允许的音频源地址')
  return url.href
}
