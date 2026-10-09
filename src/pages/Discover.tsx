import TrackSkeleton from '@/components/TrackSkeleton'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Disc3, Play, RefreshCw, TrendingUp } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { getMusicFeed, type VideoInfo } from '@/services/api'
import { markMusicFeedSeen, nextFeedSeed, seenTrackIds } from '@/services/recommendationSession'
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
    aid: video.aid,
    cid: video.cid,
    album: video.album,
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
  const sourceLabel = '多风格音乐精选'

  useEffect(() => {
    void loadMusicRanking()
    return () => { ++requestId.current }
  }, [batch])

  async function loadMusicRanking() {
    const request = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const data = await getMusicFeed({ mode: 'discover', seed: nextFeedSeed(), seenTrackIds, limit: 21 })
      if (request === requestId.current) { markMusicFeedSeen(data); setTracks(data) }
    } catch (e: unknown) {
      if (request === requestId.current) setError(e instanceof Error ? e.message : '加载失败')
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
        <span className="text-caption">{sourceLabel} · 第 {batch + 1} 批</span>
        <ActionButton tone="subtle" disabled={loading} onClick={() => setBatch(value => value + 1)}>
          <RefreshCw size={16} /> {loading ? '加载中' : '换一换 / 刷新'}
        </ActionButton>
      </div>
      <MusicHero
        eyebrow={sourceLabel}
        title="发现新声音"
        subtitle="从 ACG、华语流行、摇滚、电音、古风等风格中发掘 1–10 分钟的歌曲，自动过滤非听歌内容。"
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
