import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, CheckSquare, Download, ListMusic, Loader2, Music, Play, RotateCw, Square, Trash2, X } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { downloadTracks, downloadSingleTrack, isTrackDownloaded } from '@/services/downloadManager'
import { useImport } from '@/contexts/ImportContext'
import AddToPlaylistButton from '@/components/AddToPlaylistButton'
import {
  EmptyLibrary,
  MusicHero,
  MusicPageShell,
  MusicSection,
  TrackList,
  TrackListRow,
} from '@/components/AppleMusicPage'
import {
  deletePlaylist,
  getPlaylist,
  loadPlaylists,
  PLAYLISTS_CHANGED_EVENT,
  removeTracksFromPlaylist,
} from '@/utils/storage'
import type { Playlist, Track } from '@/types'

// Keep effect dependencies stable while a playlist is deleted or missing.
const EMPTY_TRACKS: Track[] = []

export default function Playlists() {
  const { playlistId } = useParams()
  return playlistId ? <PlaylistDetail key={playlistId} playlistId={playlistId} /> : <PlaylistOverview />
}

function PlaylistOverview() {
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists())

  useEffect(() => {
    const sync = () => setPlaylists(loadPlaylists())
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PLAYLISTS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const heroImage = playlists.find(p => p.coverUrl)?.coverUrl

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="All Playlists"
        title="所有歌单"
        subtitle={playlists.length ? `你创建了 ${playlists.length} 个歌单。` : '点击侧边栏播放列表右侧的 +，创建第一个歌单。'}
        image={heroImage}
        tone="purple"
      />

      {playlists.length === 0 ? (
        <EmptyLibrary icon={<ListMusic size={40} />} title="还没有歌单" subtitle="新建歌单后，会立即显示在这里和侧边栏中。" />
      ) : (
        <MusicSection title="我的歌单" icon={<ListMusic size={22} />}>
          <div className="playlist-grid">
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </MusicSection>
      )}
    </MusicPageShell>
  )
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const cover = playlist.coverUrl || playlist.tracks[0]?.coverUrl
  return (
    <Link to={`/playlists/${playlist.id}`} className="playlist-card">
      <div className="playlist-card__cover">
        {cover ? <img src={cover} alt="" loading="lazy" /> : <Music size={34} />}
      </div>
      <div className="playlist-card__body">
        <h3>{playlist.name}</h3>
        <p>{playlist.tracks.length} 首歌曲</p>
        {playlist.description && <span>{playlist.description}</span>}
      </div>
    </Link>
  )
}

function PlaylistDetail({ playlistId }: { playlistId: string }) {
  const [playlist, setPlaylist] = useState<Playlist | null>(() => getPlaylist(playlistId))
  const [editing, setEditing] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadAllBusy, setDownloadAllBusy] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<string>('')
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const player = usePlayer()
  const { showToast } = player
  const navigate = useNavigate()
  const { records, resumePlaylist } = useImport()

  const tracks = playlist?.tracks ?? EMPTY_TRACKS

  const refreshDownloaded = useCallback(() => {
    const set = new Set<string>()
    for (const t of tracks) {
      if (isTrackDownloaded(t.id)) set.add(t.id)
    }
    setDownloadedIds(previous => previous.size === set.size && [...set].every(id => previous.has(id)) ? previous : set)
  }, [tracks])

  useEffect(() => {
    refreshDownloaded()
    window.addEventListener('bilimusic_downloads_changed', refreshDownloaded)
    return () => window.removeEventListener('bilimusic_downloads_changed', refreshDownloaded)
  }, [refreshDownloaded])

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

  const handleDownloadTracks = async (targetTracks: Track[]) => {
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

  useEffect(() => {
    const sync = () => setPlaylist(getPlaylist(playlistId))
    sync()
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PLAYLISTS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [playlistId])

  const heroImage = playlist?.coverUrl || tracks[0]?.coverUrl
  const updatedText = useMemo(() => {
    if (!playlist?.updatedAt) return ''
    return new Date(playlist.updatedAt).toLocaleDateString()
  }, [playlist?.updatedAt])

  // 该歌单是否有未完成的导入（未处理/失败/待确认/未找到 = 尚无已选结果），供右上角"继续导入"
  const importRecord = records[playlistId]
  const incompleteCount = importRecord
    ? importRecord.results.reduce((n, r, i) => {
        if (!r || r.error) return n + 1
        return (importRecord.selected[i] ?? r.bestMatch?.bvid) ? n : n + 1
      }, 0)
    : 0

  if (!playlist) {
    return (
      <MusicPageShell>
        <EmptyLibrary icon={<ListMusic size={40} />} title="歌单不存在" subtitle="这个歌单可能已经被删除。" />
        <Link className="am-action am-action--subtle" to="/playlists">返回所有歌单</Link>
      </MusicPageShell>
    )
  }

  const handleDelete = () => {
    deletePlaylist(playlist.id)
    navigate('/playlists', { replace: true })
  }

  const removeSelected = () => {
    if (selectedIds.size === 0) return
    const updated = removeTracksFromPlaylist(playlist.id, [...selectedIds])
    setPlaylist(updated)
    setSelectedIds(new Set())
    setEditing(false)
  }

  const removeOne = (trackId: string) => {
    const updated = removeTracksFromPlaylist(playlist.id, [trackId])
    setPlaylist(updated)
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })
  }

  const toggleSelected = (trackId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
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

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Playlist"
        title={playlist.name}
        subtitle={playlist.description || `${tracks.length} 首歌曲${updatedText ? ` · 更新于 ${updatedText}` : ''}`}
        image={heroImage}
        tone="purple"
        action={(
          <>
            {incompleteCount > 0 && (
              <button
                className="am-action am-action--subtle"
                onClick={() => { resumePlaylist(playlistId); navigate('/import') }}
                title={`该歌单还有 ${incompleteCount} 首未完成匹配，点击继续导入`}
              >
                <RotateCw size={16} />
                继续导入 {incompleteCount} 首
              </button>
            )}
            {tracks.length > 0 && (
              <>
                <button className="am-action am-action--primary" onClick={() => player.playAll(tracks)}>
                  <Play size={17} fill="currentColor" />
                  播放全部
                </button>
                <button
                  className="am-action am-action--subtle"
                  onClick={() => handleDownloadTracks(tracks)}
                  disabled={downloadAllBusy}
                >
                  {downloadAllBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {downloadAllBusy ? `正在下载 ${downloadProgress}` : '下载全部'}
                </button>
              </>
            )}
            <button className="am-action am-action--subtle" onClick={handleDelete}>
              <Trash2 size={16} />
              删除歌单
            </button>
          </>
        )}
      />

      {tracks.length === 0 ? (
        <EmptyLibrary icon={<Music size={40} />} title="歌单是空的" subtitle="歌单已经创建并持久化保存，后续可以把歌曲加入到这里。" />
      ) : (
        <MusicSection title="歌曲" icon={<Music size={22} />}>
          <div className={`playlist-editbar ${editing ? 'is-editing' : ''}`}>
            <div>
              <span>{editing ? `已选择 ${selectedIds.size} 首` : `${tracks.length} 首歌曲`}</span>
            </div>
            {editing && (
              <button type="button" onClick={toggleAll}>
                {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                {allSelected ? '取消全选' : '全选'}
              </button>
            )}
            {editing && selectedIds.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const selectedList = tracks.filter(t => selectedIds.has(t.id))
                    handleDownloadTracks(selectedList)
                  }}
                  disabled={downloadAllBusy}
                >
                  {downloadAllBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {downloadAllBusy ? `下载中 ${downloadProgress}` : `下载 (${selectedIds.size})`}
                </button>
                <button type="button" className="playlist-editbar__danger" onClick={removeSelected}>
                  <Trash2 size={16} />
                  移出歌单
                </button>
              </>
            )}
            <button type="button" className="playlist-editbar__primary" onClick={toggleEditing}>
              {editing ? '完成' : '选择'}
            </button>
          </div>
          <TrackList>
            {tracks.map((track, index) => (
              <TrackListRow
                key={track.id + String(index)}
                track={track}
                index={index + 1}
                isCurrent={player.currentTrack?.id === track.id}
                isPlaying={player.isPlaying}
                onPlay={() => editing ? toggleSelected(track.id) : player.playFromList(track, playlist.tracks)}
                leading={editing ? (
                  <button
                    type="button"
                    className={`playlist-select-button ${selectedIds.has(track.id) ? 'is-selected' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleSelected(track.id) }}
                    title={selectedIds.has(track.id) ? '取消选择' : '选择'}
                  >
                    {selectedIds.has(track.id) ? <CheckSquare size={17} /> : <Square size={17} />}
                  </button>
                ) : undefined}
                extra={(
                  <div className="am-extra-actions">
                    <button
                      className="am-icon-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!downloadedIds.has(track.id)) {
                          handleDownloadTrack(track)
                        }
                      }}
                      disabled={downloadingId === track.id || downloadedIds.has(track.id)}
                      title={downloadedIds.has(track.id) ? '已下载到本地' : '下载到本地'}
                    >
                      {downloadingId === track.id ? (
                        <Loader2 size={15} className="animate-spin text-accent" />
                      ) : downloadedIds.has(track.id) ? (
                        <Check size={15} />
                      ) : (
                        <Download size={15} />
                      )}
                    </button>
                    <AddToPlaylistButton track={track} size={15} />
                    {!editing && (
                      <button className="am-icon-danger" onClick={(e) => { e.stopPropagation(); removeOne(track.id) }} title="移出歌单">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                )}
              />
            ))}
          </TrackList>
        </MusicSection>
      )}
    </MusicPageShell>
  )
}
