import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { net } from 'electron'
import ffmpegStatic from 'ffmpeg-static'

export interface AudioMetadata {
  title: string
  artist: string
  album?: string
  coverUrl?: string
}

export function validateMetadata(value: unknown): AudioMetadata {
  if (value === undefined) return { title: '', artist: '', album: '' }
  if (!value || typeof value !== 'object') throw new Error('音频标签无效')
  const result: AudioMetadata = { title: '', artist: '' }
  for (const key of ['title', 'artist', 'album', 'coverUrl'] as const) {
    const field = (value as Record<string, unknown>)[key]
    if (field !== undefined && (typeof field !== 'string' || field.length > (key === 'coverUrl' && field.startsWith('data:image/') ? 16 * 1024 * 1024 : 2048) || /[\x00-\x1f]/.test(field))) throw new Error('音频标签无效')
    result[key] = field as string || ''
  }
  return result
}

function coverUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !url.hostname.endsWith('.hdslb.com')) throw new Error('不允许的封面地址')
  return url.href
}

async function downloadCover(value: string, file: string) {
  const inline = /^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=]+)$/i.exec(value)
  if (inline) {
    const data = Buffer.from(inline[1], 'base64')
    if (!data.length || data.length > 12 * 1024 * 1024) throw new Error('歌曲封面大小无效')
    await fs.writeFile(file, data, { flag: 'wx' })
    return
  }
  let url = coverUrl(value)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    for (let hop = 0; hop < 5; hop++) {
      const response = await net.fetch(url, { credentials: 'omit', redirect: 'manual', signal: controller.signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location')
        await response.body?.cancel()
        if (!next) throw new Error('封面重定向无效')
        url = coverUrl(new URL(next, url).href)
        continue
      }
      if (!response.ok || !response.body || !/^image\/(jpeg|png|webp)/i.test(response.headers.get('content-type') || '')) throw new Error('无法下载歌曲封面，请重试')
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value: chunk } = await reader.read()
          if (done) break
          size += chunk.length
          if (size > 12 * 1024 * 1024) throw new Error('歌曲封面过大')
          chunks.push(chunk)
        }
      } finally { await reader.cancel().catch(() => {}) }
      if (!size) throw new Error('歌曲封面为空')
      await fs.writeFile(file, Buffer.concat(chunks), { flag: 'wx' })
      return
    }
    throw new Error('歌曲封面重定向过多')
  } finally { clearTimeout(timeout); controller.abort() }
}

/** Explicit argv, no shell; FFmpeg can only read local files, never remote playlists. */
export function runFfmpeg(args: string[], timeoutMs = 10 * 60 * 1000): Promise<void> {
  if (!ffmpegStatic) return Promise.reject(new Error('此平台未提供 FFmpeg 转码器'))
  const binary = ffmpegStatic.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let diagnostic = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs)
    child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-3000) })
    child.once('error', (error) => { clearTimeout(timer); reject(new Error(`无法启动 MP3 转码器：${error.message}`)) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error('MP3 转码超时，请重试'))
      else if (code !== 0) reject(new Error(`MP3 转码失败：${diagnostic || code}`))
      else resolve()
    })
  })
}

export async function transcodeMp3(input: string, output: string, metadata: AudioMetadata): Promise<void> {
  const cover = output + '.cover'
  try {
    if (metadata.coverUrl) await downloadCover(metadata.coverUrl, cover)
    const args = ['-y', '-protocol_whitelist', 'file,pipe', '-i', input]
    if (metadata.coverUrl) args.push('-protocol_whitelist', 'file,pipe', '-i', cover)
    args.push('-map', '0:a:0')
    if (metadata.coverUrl) args.push('-map', '1:v:0', '-c:v', 'mjpeg', '-vf', "scale='min(1200,iw)':-2", '-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)')
    args.push('-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '320k', '-threads', '1', '-id3v2_version', '3', '-write_id3v1', '1',
      '-metadata', `title=${metadata.title}`, '-metadata', `artist=${metadata.artist}`, '-metadata', `album=${metadata.album || metadata.title}`,
      '-f', 'mp3', output)
    await runFfmpeg(args)
    const stat = await fs.stat(output)
    if (stat.size < 128) throw new Error('MP3 转码结果无效')
  } finally { await fs.unlink(cover).catch(() => {}) }
}
