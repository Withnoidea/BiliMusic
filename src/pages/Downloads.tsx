import { useEffect, useState } from 'react'
import { Download, FolderOpen, HardDrive, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayer } from '@/contexts/PlayerContext'
import { ActionButton, EmptyLibrary, MusicHero, MusicPageShell, MusicSection, TrackList, TrackListRow } from '@/components/AppleMusicPage'
import { getDownloadedTracks, useDownloadQueue, downloadSingleTrack, removeDownloadedTrack, clearAllDownloadedTracks, openDownloadsFolder, getDownloadsFolderPath, friendlyDownloadError } from '@/services/downloadManager'

export default function Downloads() {
  const [tracks, setTracks] = useState(getDownloadedTracks)
  const [directory, setDirectory] = useState('')
  const [deleting, setDeleting] = useState(false)
  const jobs = useDownloadQueue()
  const player = usePlayer()
  const navigate = useNavigate()
  useEffect(() => {
    const refresh = () => setTracks(getDownloadedTracks())
    window.addEventListener('bilimusic_downloads_changed', refresh)
    getDownloadsFolderPath().then(setDirectory).catch(() => setDirectory('请在设置中选择下载目录'))
    return () => window.removeEventListener('bilimusic_downloads_changed', refresh)
  }, [])
  const report = (error: unknown) => player.showToast(friendlyDownloadError(error))
  const remove = async (id?: string) => {
    if (deleting || !window.confirm(id ? '删除这首歌曲的本地文件？' : '删除全部已下载音频？此操作不会删除收藏。')) return
    setDeleting(true)
    try { if (id) await removeDownloadedTrack(id); else await clearAllDownloadedTracks() }
    catch (error) { report(error) }
    finally { setDeleting(false) }
  }
  const active = jobs.filter(job => job.state !== 'completed')
  const size = tracks.reduce((sum, track) => sum + (track.fileSize || 0), 0)
  return <MusicPageShell>
    <MusicHero eyebrow="你的离线音乐库" title="下载中心" subtitle="把喜欢的声音留在身边。已下载音轨优先本地播放，无需等待网络。" tone="blue" action={<>
      <ActionButton disabled={!tracks.length} onClick={() => player.playAll(tracks)}><Play size={16} fill="currentColor" />播放全部</ActionButton>
      <ActionButton tone="subtle" onClick={() => void openDownloadsFolder().catch(report)}><FolderOpen size={16} />打开目录</ActionButton>
      <ActionButton tone="subtle" onClick={() => navigate('/settings')}>更改目录</ActionButton>
    </>} />
    <div className="download-summary">
      <span><Download size={18} /><strong>{tracks.length}</strong> 首已下载</span>
      <span><HardDrive size={18} /><strong>{(size / 1024 / 1024).toFixed(1)}</strong> MB</span>
      <span className="download-summary__path" title={directory}>{directory}</span>
    </div>
    {active.length > 0 && <MusicSection title={`下载队列 · ${active.length}`} icon={<Download size={19} />}>
      <div className="download-jobs">{active.map(job => <div className="download-job" key={job.id}>
        <div className="download-job__copy"><strong>{job.track.title}</strong><span>{job.state === 'failed' ? job.error : job.state === 'queued' ? '等待下载 · 最多同时下载 2 首' : job.state === 'transcoding' ? '正在转码 MP3 · 写入封面与标签…' : job.state === 'resolving' ? '正在获取音频…' : job.percent === null ? '正在下载 · 大小未知' : `正在下载 ${Math.floor(job.percent)}%`}</span></div>
        {job.state === 'failed' ? <ActionButton tone="subtle" onClick={() => void downloadSingleTrack(job.track).catch(report)}><RefreshCw size={15} />重试</ActionButton> : <progress aria-label={`${job.track.title} 下载进度`} max={100} value={job.percent ?? undefined} />}
      </div>)}</div>
    </MusicSection>}
    {!tracks.length ? <>
      <EmptyLibrary icon={<Download size={36} />} title="为下一次离线，留一首好歌" subtitle="在搜索、收藏或歌单中下载音乐。完成后，完整音轨会自动加入这里。" />
      <div className="empty-library-action"><ActionButton onClick={() => navigate('/search')}>去发现喜欢的音乐</ActionButton></div>
    </> : <MusicSection title={`已下载 · ${tracks.length}`} action={<ActionButton tone="danger" disabled={deleting} onClick={() => void remove()}><Trash2 size={15} />清空下载</ActionButton>}>
      <TrackList>{tracks.map((track, index) => <TrackListRow key={track.id} index={index + 1} track={track} isCurrent={player.currentTrack?.id === track.id} isPlaying={player.isPlaying} onPlay={() => player.playNow(track)} extra={<button type="button" disabled={deleting} className="track-action-button" title="删除本地音轨" aria-label={`删除 ${track.title}`} onClick={event => { event.stopPropagation(); void remove(track.id) }}><Trash2 size={16} /></button>} />)}</TrackList>
    </MusicSection>}
  </MusicPageShell>
}
