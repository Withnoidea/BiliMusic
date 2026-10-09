import { useState, useCallback, useEffect } from 'react'
import { Check, CheckSquare, Download, Heart, Loader2, Play, Square, X } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import AddToPlaylistButton from '@/components/AddToPlaylistButton'
import { loadFavoriteTracks, removeFavoriteTrack, removeMultipleFavoriteTracks, FAVORITES_CHANGED_EVENT } from '@/utils/storage'
import {
  downloadTracks, downloadSingleTrack,
  isTrackDownloaded,
} from '@/services/downloadManager'
import {
  ActionButton,
  EmptyLibrary,
  MusicHero,
  MusicPageShell,
  MusicSection,
  TrackList,
  TrackListRow,
  defaultIconFor,
} from '@/components/AppleMusicPage'
import type { Track } from '@/types'

export default function Favorites() {
  const [tracks, setTracks] = useState<Track[]>(() => loadFavoriteTracks())
  const [editing, setEditing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadAllBusy, setDownloadAllBusy] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<string>('')
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set())

  const player = usePlayer()
  const { showToast } = player

  const refreshDownloaded = useCallback(() => {
    const list = loadFavoriteTracks()
    const set = new Set<string>()
    for (const t of list) {
      if (isTrackDownloaded(t.id)) {
        set.add(t.id)
      }
    }
    setDownloadedIds(set)
  }, [])

  useEffect(() => {
    const refresh = () => {
      setTracks(loadFavoriteTracks())
      refreshDownloaded()
    }
    refresh()
    window.addEventListener(FAVORITES_CHANGED_EVENT, refresh)
    window.addEventListener('bilimusic_downloads_changed', refreshDownloaded)
    return () => {
      window.removeEventListener(FAVORITES_CHANGED_EVENT, refresh)
      window.removeEventListener('bilimusic_downloads_changed', refreshDownloaded)
    }
  }, [refreshDownloaded])

  const handleRemove = useCallback((trackId: string) => {
    setTracks(removeFavoriteTrack(trackId))
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })
  }, [])

  const handlePlayAll = useCallback(() => {
    if (tracks.length > 0) player.playAll(tracks)
  }, [tracks, player])

  const handleDownloadTrack = async (track: Track) => {
    if (downloadingId || downloadAllBusy) return
    setDownloadingId(track.id)
    try {
      showToast(`开始下载《${track.title}》`)
      await downloadSingleTrack(track)
      showToast(`《${track.title}》下载完成`)
      refreshDownloaded()
    } catch (err: any) {
      showToast(`下载失败: ${err?.message || '未知错误'}`)
    } finally {
      setDownloadingId(null)
    }
  }

  // 批量下载指定列表
  const handleDownloadBatch = async (targetTracks: Track[]) => {
    if (downloadAllBusy || targetTracks.length === 0) return
    setDownloadAllBusy(true)
    const { successCount, failCount } = await downloadTracks(targetTracks, (done, total) => {
      setDownloadProgress(`(${done}/${total})`)
      refreshDownloaded()
    })

    setDownloadAllBusy(false)
    setDownloadProgress('')
    showToast(`批量下载完成：成功 ${successCount} 首${failCount > 0 ? `，失败 ${failCount} 首` : ''}`)
  }

  const toggleSelect = (trackId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) {
        next.delete(trackId)
      } else {
        next.add(trackId)
      }
      return next
    })
  }

  const allSelected = tracks.length > 0 && selectedIds.size === tracks.length
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(tracks.map(track => track.id)))
  }

  const toggleEditing = () => {
    setEditing(prev => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }

  const removeSelected = () => {
    if (selectedIds.size === 0) return
    setTracks(removeMultipleFavoriteTracks(Array.from(selectedIds)))
    setSelectedIds(new Set())
    setEditing(false)
  }

  const downloadSelected = () => {
    if (selectedIds.size === 0) return
    const targets = tracks.filter(t => selectedIds.has(t.id))
    handleDownloadBatch(targets)
  }

  const heroImage = tracks[0]?.coverUrl

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Favorites"
        title="我喜欢"
        subtitle={tracks.length ? `收藏的 ${tracks.length} 首歌曲都在这里。` : '点击歌曲旁的心形按钮收藏喜欢的音乐。'}
        image={heroImage}
        tone="red"
        action={
          tracks.length > 0 && (
            <div className="flex items-center gap-2">
              <ActionButton onClick={handlePlayAll}>
                <Play size={17} fill="currentColor" />
                播放全部
              </ActionButton>
              <ActionButton
                tone="subtle"
                onClick={() => handleDownloadBatch(tracks)}
                disabled={downloadAllBusy}
              >
                {downloadAllBusy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {downloadAllBusy ? `正在下载 ${downloadProgress}` : '下载全部'}
              </ActionButton>
              <ActionButton tone="subtle" onClick={toggleEditing}>
                {editing ? '完成多选' : '批量操作'}
              </ActionButton>
            </div>
          )
        }
      />

      {tracks.length === 0 ? (
        <EmptyLibrary icon={defaultIconFor('favorites')} title="暂无收藏" subtitle="播放时点亮爱心，把反复想听的声音收藏在这里。" />
      ) : (
        <MusicSection
          title="收藏曲目"
          icon={<Heart size={22} />}
          action={
            editing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 hover:bg-white/5 transition-colors"
                >
                  {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  {allSelected ? '取消全选' : '全选'}
                </button>
                <button
                  type="button"
                  onClick={downloadSelected}
                  disabled={selectedIds.size === 0 || downloadAllBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent hover:bg-accent/80 disabled:opacity-50 transition-colors"
                >
                  <Download size={14} />
                  下载所选 ({selectedIds.size})
                </button>
                <button
                  type="button"
                  onClick={removeSelected}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-red-500/20 text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                >
                  <X size={14} />
                  移除所选 ({selectedIds.size})
                </button>
              </div>
            ) : null
          }
        >
          <TrackList>
            {tracks.map((track, index) => {
              const isDownloaded = downloadedIds.has(track.id)
              const isDownloading = downloadingId === track.id
              const isSelected = selectedIds.has(track.id)

              return (
                <TrackListRow
                  key={track.id + String(index)}
                  track={track}
                  index={index + 1}
                  isCurrent={player.currentTrack?.id === track.id}
                  isPlaying={player.isPlaying}
                  onPlay={() => player.playFromList(track, tracks)}
                  leading={
                    editing ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(track.id)}
                        className="rounded border-white/20 bg-white/5 text-accent focus:ring-accent"
                      />
                    ) : undefined
                  }
                  extra={(
                    <div className="am-extra-actions">
                      <button
                        type="button"
                        className={`am-icon-btn ${isDownloaded ? 'text-green-400' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!isDownloaded) {
                            handleDownloadTrack(track)
                          }
                        }}
                        disabled={isDownloading || isDownloaded}
                        title={isDownloaded ? '已下载到本地' : '下载到本地'}
                      >
                        {isDownloading ? (
                          <Loader2 size={15} className="animate-spin text-accent" />
                        ) : isDownloaded ? (
                          <Check size={15} />
                        ) : (
                          <Download size={15} />
                        )}
                      </button>
                      <AddToPlaylistButton track={track} size={15} />
                      <button className="am-icon-danger" onClick={(e) => { e.stopPropagation(); handleRemove(track.id) }} title="取消收藏">
                        <X size={16} />
                      </button>
                    </div>
                  )}
                />
              )
            })}
          </TrackList>
        </MusicSection>
      )}
    </MusicPageShell>
  )
}
