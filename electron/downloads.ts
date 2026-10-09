import { ipcMain, net, protocol, app } from 'electron'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { assertTrustedSender, audioFile, downloadDirectory, validateAudioUrl } from './security'

import { transcodeMp3, validateMetadata, type AudioMetadata } from './transcode'

const activeFiles = new Set<string>()
const tokens = new Map<string, { filename: string; directory: string; size: number }>()
let active = 0
const waiting: (() => void)[] = []
async function acquire() { if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve)); else active++ }
function release() { const next = waiting.shift(); if (next) next(); else active-- }
const digest = async (file: string) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const receiptPath = (file: string) => path.join(app.getPath('userData'), 'audio-receipts', createHash('sha256').update(file).digest('hex') + '.json')

export function registerDownloadHandlers() {
  ipcMain.handle('bili:getDownloadDir', async (event, custom?: string) => { assertTrustedSender(event); return downloadDirectory(custom) })
  ipcMain.handle('bili:downloadAudio', async (event, url: string, filename: string, custom?: string, metadata?: AudioMetadata) => {
    assertTrustedSender(event)
    const tags = validateMetadata(metadata)
    validateAudioUrl(url)
    const file = await audioFile(filename, custom)
    if (activeFiles.has(file)) throw new Error('该音频正在下载')
    activeFiles.add(file)
    await acquire()
    const temporary = file + '.' + randomUUID() + '.part'
    const converted = temporary + '.mp3'
    const controller = new AbortController()
    let timeout = setTimeout(() => controller.abort(), 30000)
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      // Validate every redirect, never forward authenticated session cookies to a CDN.
      let response: Response | undefined
      for (let hop = 0; hop < 5; hop++) {
        response = await net.fetch(validateAudioUrl(url), { headers: { Referer: 'https://www.bilibili.com' }, credentials: 'omit', redirect: 'manual', signal: controller.signal })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const next = response.headers.get('location')
        await response.body?.cancel()
        if (!next) throw new Error('音频源重定向无效')
        url = new URL(next, url).href
      }
      if (!response?.ok || !response.body) throw new Error(`下载失败 (${response?.status || '网络异常'})`)
      const type = response.headers.get('content-type') || ''
      if (/text\/|json/.test(type)) throw new Error('音频源返回了无效内容')
      const total = Number(response.headers.get('content-length') || 0)
      handle = await fs.open(temporary, 'wx')
      let received = 0, lastReport = 0
      const reader = response.body.getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        clearTimeout(timeout)
        timeout = setTimeout(() => controller.abort(), 30000)
        await handle.writeFile(value)
        received += value.length
        if (Date.now() - lastReport > 120) {
          if (!event.sender.isDestroyed()) event.sender.send('bili:downloadProgress', { filename, received, total, phase: 'downloading', percent: total ? Math.min(89, received / total * 90) : null })
          lastReport = Date.now()
        }
      }
      if (!received || (total && received !== total)) throw new Error('文件未完整下载，请重试')
      await handle.sync()
      await handle.close(); handle = undefined
      clearTimeout(timeout)
      let output = temporary
      if (filename.endsWith('.mp3')) {
        if (!event.sender.isDestroyed()) event.sender.send('bili:downloadProgress', { filename, received, total, percent: 90, phase: 'transcoding' })
        await transcodeMp3(temporary, converted, tags)
        output = converted
      }
      // Receipts and renderer records describe the exported file, not the CDN stream.
      const size = (await fs.stat(output)).size
      const sha256 = await digest(output)
      // Recheck the parent/target before commit (directory may have changed mid-transfer).
      if (await audioFile(filename, custom) !== file) throw new Error('下载目录已改变，请重试')
      await fs.rename(output, file)
      const receipt = receiptPath(file)
      await fs.mkdir(path.dirname(receipt), { recursive: true })
      await fs.writeFile(receipt, JSON.stringify({ size, sha256 }))
      if (!event.sender.isDestroyed()) event.sender.send('bili:downloadProgress', { filename, received: size, total: size, percent: 100, phase: 'completed' })
      return { filePath: file, size }
    } finally {
      clearTimeout(timeout)
      controller.abort()
      await handle?.close().catch(() => {})
      await fs.unlink(temporary).catch(() => {})
      await fs.unlink(converted).catch(() => {})
      activeFiles.delete(file)
      release()
    }
  })
  ipcMain.handle('bili:deleteDownloadedFile', async (event, filename: string, custom?: string) => {
    assertTrustedSender(event)
    const file = await audioFile(filename, custom)
    await fs.unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    await fs.unlink(receiptPath(file)).catch(() => {})
    for (const [token, entry] of tokens) if (entry.filename === filename && entry.directory === path.dirname(file)) tokens.delete(token)
    return { success: true }
  })
  ipcMain.handle('bili:checkDownloadedFiles', async (event, filenames: string[], custom?: string) => {
    assertTrustedSender(event)
    if (!Array.isArray(filenames) || filenames.length > 5000) throw new Error('文件列表无效')
    const result: Record<string, { exists: boolean; size?: number }> = {}
    for (const filename of filenames) {
      try { const stat = await fs.stat(await audioFile(filename, custom)); result[filename] = { exists: stat.isFile() && stat.size > 0, size: stat.size } }
      catch { result[filename] = { exists: false } }
    }
    return result
  })
  ipcMain.handle('bili:localAudio', async (event, filename: string, custom?: string, expectedSize?: number) => {
    assertTrustedSender(event)
    try {
      const file = await audioFile(filename, custom)
      const stat = await fs.stat(file)
      if (!stat.size || !stat.isFile()) return null
      const receipt = JSON.parse(await fs.readFile(receiptPath(file), 'utf8').catch(() => 'null'))
      if (receipt) {
        if (receipt.size !== stat.size || receipt.sha256 !== await digest(file)) return null
      } else {
        // Legacy downloads have no hash: require their recorded size and MP4 container header.
        if (!expectedSize || stat.size !== expectedSize) return null
        const handle = await fs.open(file, 'r')
        const header = Buffer.alloc(12)
        try { await handle.read(header, 0, 12, 0) } finally { await handle.close() }
        const valid = filename.endsWith('.mp3')
          ? header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
          : header.toString('ascii', 4, 8) === 'ftyp'
        if (!valid) return null
      }
      const token = randomUUID()
      if (tokens.size >= 64) tokens.delete(tokens.keys().next().value!)
      tokens.set(token, { filename, directory: path.dirname(file), size: stat.size })
      return `bilimusic-audio://local/${token}`
    } catch { return null }
  })
  protocol.handle('bilimusic-audio', async request => {
    const url = new URL(request.url)
    const entry = url.hostname === 'local' ? tokens.get(url.pathname.slice(1)) : undefined
    if (!entry || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 })
    try {
      const file = await audioFile(entry.filename, entry.directory)
      const stat = await fs.stat(file)
      if (stat.size !== entry.size) return new Response(null, { status: 410 })
      const range = request.headers.get('range')
      let start = 0, end = stat.size - 1
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 })
        if (!match[1]) start = Math.max(0, stat.size - Number(match[2]))
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
        if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
      }
      const headers: Record<string, string> = { 'Content-Type': entry.filename.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store' }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
      const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
      return new Response(body, { status: range ? 206 : 200, headers })
    } catch { return new Response(null, { status: 404 }) }
  })
}
