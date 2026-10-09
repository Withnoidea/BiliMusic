import TrackSkeleton from '@/components/TrackSkeleton'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Disc3, Play, RefreshCw, TrendingUp } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { getMusicRanking, type DiscoverSource, type VideoInfo } from '@/services/api'
import type { Track } from '@/types'
import {
  ActionButton,
  EmptyLibrary,
  FeaturedGrid,
  FeaturedTrackCard,
  MusicHero,
  MusicPageShell,
  MusicSection,
  TrackList,
  TrackListRow,
} from '@/components/AppleMusicPage'

function videoToTrack(video: VideoInfo): Track {
  return {
    id: video.bvid,
    title: video.title,
    artist: video.ownerName,
    coverUrl: video.pic,
    duration: video.duration,
    videoUrl: `https://www.bilibili.com/video/${video.bvid}`,
    bvid: video.bvid,
    playCount: video.stat?.view || 0,
    isLiked: false,
  }
}

export default function Discover() {
  const [tracks, setTracks] = useState<VideoInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const player = usePlayer()
  const [batch, setBatch] = useState(0)
  const requestId = useRef(0)
  const sources: DiscoverSource[] = ['hot', 'original', 'latest']
  const labels = ['热门音乐榜', '原创音乐榜', '最新音乐投稿']
  const sourceLabel = labels[batch % sources.length]

  useEffect(() => {
    void loadMusicRanking(batch)
    return () => { ++requestId.current }
  }, [batch])

  async function loadMusicRanking(cursor: number) {
    const request = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const data = await getMusicRanking({ source: sources[cursor % sources.length], page: Math.floor(cursor / sources.length) + 1, pageSize: 20 })
      if (request === requestId.current) setTracks(data)
    } catch (e: any) {
      if (request === requestId.current) setError(e.message || '加载失败')
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }

  const handlePlayAll = useCallback(() => {
    const playlist = tracks.map(videoToTrack)
    if (playlist.length > 0) player.playAll(playlist)
  }, [tracks, player])

  const handlePlayOne = useCallback((video: VideoInfo) => {
    player.playFromList(videoToTrack(video), tracks.map(videoToTrack))
  }, [player, tracks])

  const featured = tracks.slice(0, 3)
  const list = tracks.slice(3)
  const heroImage = featured[0]?.pic

  return (
    <MusicPageShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span className="text-caption">{sourceLabel} · 第 {Math.floor(batch / sources.length) + 1} 批</span>
        <ActionButton tone="subtle" disabled={loading} onClick={() => setBatch(value => value + 1)}>
          <RefreshCw size={16} /> {loading ? '加载中' : '换一换 / 刷新'}
        </ActionButton>
      </div>
      <MusicHero
        eyebrow={sourceLabel}
        title="发现新声音"
        subtitle="精选热门音乐投稿，用 Apple Music 式的节奏探索今天值得播放的内容。"
        image={heroImage}
        tone="pink"
        action={(
          <ActionButton onClick={handlePlayAll} disabled={loading || tracks.length === 0}>
            <Play size={17} fill="currentColor" />
            播放全部
          </ActionButton>
        )}
      />

      {loading ? (
        <TrackSkeleton />
      ) : error ? (
        <EmptyLibrary
          icon={<RefreshCw size={38} />}
          title="加载失败"
          subtitle={error}
        />
      ) : (
        <>
          <MusicSection title="精选推荐" icon={<TrendingUp size={22} />}>
            <FeaturedGrid>
              {featured.map((video, index) => {
                const track = videoToTrack(video)
                return (
                  <FeaturedTrackCard
                    key={video.bvid}
                    track={track}
                    index={index + 1}
                    isCurrent={player.currentTrack?.id === video.bvid}
                    onPlay={() => handlePlayOne(video)}
                  />
                )
              })}
            </FeaturedGrid>
          </MusicSection>

          <MusicSection title={sourceLabel} icon={<Disc3 size={22} />}>
            <TrackList>
              {list.map((video, index) => {
                const track = videoToTrack(video)
                return (
                  <TrackListRow
                    key={video.bvid}
                    track={track}
                    index={featured.length + index + 1}
                    isCurrent={player.currentTrack?.id === video.bvid}
                    isPlaying={player.isPlaying}
                    onPlay={() => handlePlayOne(video)}
                  />
                )
              })}
            </TrackList>
          </MusicSection>
        </>
      )}
    </MusicPageShell>
  )
}
