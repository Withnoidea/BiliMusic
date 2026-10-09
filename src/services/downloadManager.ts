import { useSyncExternalStore } from 'react'
import { loadAppSettings } from '@/utils/storage'
import { extractAudio } from '@/services/api'
import type { Track } from '@/types'

export interface DownloadedTrack extends Track {
  filePath?: string
  fileSize?: number
  downloadedAt: number
  localFilename: string
}
export interface DownloadJob {
  id: string
  track: Track
  state: 'queued' | 'resolving' | 'downloading' | 'transcoding' | 'completed' | 'failed'
  percent: number | null
  error?: string
}
const STORAGE_KEY = 'bilimusic_downloaded_tracks'
const JOBS_KEY = 'bilimusic_download_jobs'
const EVENT_CHANGE = 'bilimusic_downloads_changed'
const listeners = new Set<() => void>()
let jobs: DownloadJob[] = []
try {
  const saved = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]')
  if (Array.isArray(saved)) jobs = saved.filter(j => j?.track?.id).map(j => ({ ...j, state: 'failed', error: j.error || '上次下载已中断，点击重试继续' }))
} catch { /* damaged storage must not prevent startup */ }
function publish() {
  jobs = [...jobs]
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.filter(j => j.state !== 'completed'))) } catch { /* storage full */ }
  listeners.forEach(listener => listener())
}
export function useDownloadQueue() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => jobs)
}
export function sanitizeFilename(name: string): string {
  return name.replace(/[\x00-\x1f/\\?%*:|"<>]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 65) || 'untitled'
}
export function getDownloadedTracks(): DownloadedTrack[] {
  try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data.filter(t => t?.id && t.localFilename) : [] } catch { return [] }
}
export function saveDownloadedTracks(tracks: DownloadedTrack[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks))
  window.dispatchEvent(new CustomEvent(EVENT_CHANGE))
}
export function isTrackDownloaded(id: string): boolean { return getDownloadedTracks().some(t => t.id === id) }
export function getDownloadedTrackPath(id: string) { return getDownloadedTracks().find(t => t.id === id)?.filePath }
const directoryOf = (track: DownloadedTrack) => track.filePath?.replace(/[/\\][^/\\]+$/, '')
export async function getLocalAudio(track: Track): Promise<string | null> {
  if (!window.electronAPI?.biliApi) return null
  const item = getDownloadedTracks().find(t => t.id === track.id || (track.bvid && t.bvid === track.bvid && String(t.cid || '') === String(track.cid || '')))
  if (!item) return null
  return window.electronAPI.biliApi.localAudio(item.localFilename, directoryOf(item), item.fileSize).catch(() => null)
}
export function friendlyDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/412|429/.test(message)) return 'B站暂时限制请求，请稍候再重试'
  if (/403|401/.test(message)) return '音频链接已失效，点击重试将重新获取'
  if (/timeout|abort|network|fetch|net::/i.test(message)) return '网络连接中断，请检查网络后重试'
  if (/ENOSPC/.test(message)) return '磁盘空间不足，请释放空间后重试'
  if (/EACCES|EPERM/.test(message)) return '无法写入下载目录，请在设置中更换目录'
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
let active = 0
const tasks: (() => Promise<void>)[] = []
const pending = new Map<string, Promise<DownloadedTrack>>()
function pump() {
  while (active < 2 && tasks.length) {
    active++
    void tasks.shift()!().finally(() => { active--; pump() })
  }
}
export function downloadSingleTrack(track: Track, onProgress?: (message: string) => void): Promise<DownloadedTrack> {
  const existing = pending.get(track.id)
  if (existing) return existing
  const job: DownloadJob = { id: track.id, track, state: 'queued', percent: 0 }
  jobs = [...jobs.filter(j => j.id !== track.id).slice(-199), job]
  publish()
  const promise = new Promise<DownloadedTrack>((resolve, reject) => {
    tasks.push(async () => {
      let unsubscribe: (() => void) | undefined
      try {
        if (!window.electronAPI?.biliApi) throw new Error('请在桌面客户端中下载音乐')
        const settings = loadAppSettings()
        const format = settings.downloadFormat === 'm4a' ? 'm4a' : 'mp3'
        const recorded = getDownloadedTracks().find(item => item.id === track.id)
        const local = recorded?.localFilename.endsWith(`.${format}`) ? await getLocalAudio(track) : null
        if (local) {
          const item = getDownloadedTracks().find(t => t.id === track.id)!
          if (item) { job.state = 'completed'; job.percent = 100; resolve(item); return }
        }
        job.state = 'resolving'; publish(); onProgress?.('正在解析音频地址…')
        const fallback = track.aid && track.cid ? { aid: track.aid, cid: track.cid } : undefined
        const source = await extractAudio(track.bvid || track.id, fallback)
        if (!source.audioUrl) throw new Error('未找到可用音频流')
        const filename = `${sanitizeFilename(track.title)} - ${sanitizeFilename(track.artist)}_${sanitizeFilename(track.id).slice(0, 28)}.${format}`
        const directory = settings.downloadDir?.trim() || undefined
        job.state = 'downloading'; publish()
        unsubscribe = window.electronAPI.biliApi.onDownloadProgress(data => {
          if (data.filename !== filename) return
          job.state = data.phase === 'transcoding' ? 'transcoding' : 'downloading'
          job.percent = data.percent; publish()
          onProgress?.(data.phase === 'transcoding' ? '正在转码 MP3 并写入封面标签…' : data.percent === null ? '正在下载…' : `正在下载 ${Math.floor(data.percent)}%`)
        })
        const result = await window.electronAPI.biliApi.downloadAudio(source.audioUrl, filename, directory, { title: track.title, artist: track.artist, album: track.album || track.title, coverUrl: track.coverUrl || source.coverUrl })
        const item: DownloadedTrack = { ...track, filePath: result.filePath, fileSize: result.size, localFilename: filename, downloadedAt: Date.now() }
        saveDownloadedTracks([item, ...getDownloadedTracks().filter(t => t.id !== track.id)])
        job.state = 'completed'; job.percent = 100
        onProgress?.('下载完成'); resolve(item)
      } catch (error) {
        job.state = 'failed'; job.error = friendlyDownloadError(error)
        reject(new Error(job.error))
      } finally { unsubscribe?.(); pending.delete(track.id); publish() }
    })
  })
  pending.set(track.id, promise)
  pump()
  return promise
}
export async function downloadTracks(tracks: Track[], onProgress?: (completed: number, total: number) => void) {
  let completed = 0
  const results = await Promise.allSettled(tracks.map(track => downloadSingleTrack(track).finally(() => onProgress?.(++completed, tracks.length))))
  return { successCount: results.filter(r => r.status === 'fulfilled').length, failCount: results.filter(r => r.status === 'rejected').length }
}
export async function removeDownloadedTrack(id: string): Promise<void> {
  const target = getDownloadedTracks().find(t => t.id === id)
  if (target && window.electronAPI) {
    const result = await window.electronAPI.biliApi.deleteDownloadedFile(target.localFilename, directoryOf(target))
    if (!result.success) throw new Error(result.error || '删除失败')
  }
  saveDownloadedTracks(getDownloadedTracks().filter(t => t.id !== id))
}
export async function clearAllDownloadedTracks(): Promise<void> {
  for (const track of getDownloadedTracks()) await removeDownloadedTrack(track.id)
}
export async function getDownloadsFolderPath(): Promise<string> {
  if (!window.electronAPI) return ''
  return window.electronAPI.biliApi.getDownloadDir(loadAppSettings().downloadDir?.trim() || undefined)
}
export async function openDownloadsFolder(): Promise<void> {
  const directory = await getDownloadsFolderPath()
  if (!directory) throw new Error('请在桌面客户端中打开目录')
  const error = await window.electronAPI.openPath(directory)
  if (error) throw new Error(error)
}
