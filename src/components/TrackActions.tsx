import { downloadSingleTrack, friendlyDownloadError } from '@/services/downloadManager'
import { ListStart, Plus, Check, Download } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import AddToPlaylistButton from '@/components/AddToPlaylistButton'
import type { Track } from '@/types'

/**
 * 歌曲行内操作：下一首播放 / 加入播放列表
 *
 * 点击歌曲本身 = 立即播放（playNow）；这两个按钮才执行队列追加/插入逻辑。
 * 外层 stopPropagation，避免触发所在行/卡片的点击播放。
 */
export default function TrackActions({ track, size = 16 }: { track: Track; size?: number }) {
  const player = usePlayer()
  const queued = player.queue.some(t => t.id === track.id)

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <ActionButton
        title="下一首播放"
        onClick={() => player.playNext(track)}
        icon={<ListStart size={size} />}
      />
      <ActionButton
        title={queued ? '已在播放列表' : '加入播放列表'}
        onClick={() => player.addToQueue(track)}
        icon={queued ? <Check size={size} /> : <Plus size={size} />}
        color={queued ? 'var(--color-muted)' : undefined}
      />
      <ActionButton title="下载音轨" onClick={() => {
        player.showToast('已加入下载队列，可在下载中心查看进度')
        void downloadSingleTrack(track).catch(error => player.showToast(friendlyDownloadError(error)))
      }} icon={<Download size={size} />} />
      <AddToPlaylistButton track={track} size={size} />
    </div>
  )
}

function ActionButton({ title, onClick, icon, color }: {
  title: string
  onClick: () => void
  icon: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="track-action-button"
      style={{ color: color || undefined }}
    >
      {icon}
    </button>
  )
}
