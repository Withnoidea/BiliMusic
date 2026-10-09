import TrackSkeleton from '@/components/TrackSkeleton'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Flame, Play, RefreshCw, Sparkles } from 'lucide-react'
import { usePlayer } from '@/contexts/PlayerContext'
import { getMusicFeed, type VideoInfo } from '@/services/api'
import { markMusicFeedSeen, nextFeedSeed, seenTrackIds } from '@/services/recommendationSession'
import { loadRecentTracks } from '@/utils/storage'
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

function songToTrack(s: VideoInfo): Track {
  return {
    id: s.bvid,
    title: s.title,
    artist: s.ownerName,
    album: s.album,
    coverUrl: s.pic,
    duration: s.duration,
    videoUrl: `https://www.bilibili.com/video/${s.bvid}`,
    bvid: s.bvid,
    aid: s.aid,
    cid: s.cid,
    playCount: s.stat.view,
    isLiked: false,
  }
}

export default function Recommend() {
  const [recommendedSongs, setRecommendedSongs] = useState<VideoInfo[]>([])
  const [featuredSongs, setFeaturedSongs] = useState<VideoInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const player = usePlayer()

  const [batch, setBatch] = useState(0)
  const requestId = useRef(0)
  useEffect(() => {
    const request = ++requestId.current
    setLoading(true)
    setError(null)
    void getMusicFeed({ mode: 'recommend', seed: nextFeedSeed(), seenTrackIds, recentTracks: loadRecentTracks(), limit: 21 })
      .then(data => {
        if (request !== requestId.current) return
        // Only the committed, visible batch counts as seen (not stale requests).
        markMusicFeedSeen(data)
        setFeaturedSongs(data.slice(0, 3))
        setRecommendedSongs(data.slice(3))
      })
      .catch((reason: unknown) => {
        if (request === requestId.current) setError(reason instanceof Error ? reason.message : '推荐加载失败，请重试')
      })
      .finally(() => { if (request === requestId.current) setLoading(false) })
    return () => { ++requestId.current }
  }, [batch])

  const handlePlay = useCallback((song: VideoInfo, list: VideoInfo[]) => {
    player.playFromList(songToTrack(song), list.map(songToTrack))
  }, [player])

  const handlePlayAll = useCallback((songs: VideoInfo[]) => {
    if (songs.length === 0) return
    player.playAll(songs.map(songToTrack))
  }, [player])

  const heroSong = featuredSongs[0] || recommendedSongs[0]
  const featured = featuredSongs.slice(0, 3)
  const recommendations = recommendedSongs.slice(0, 18)

  return (
    <MusicPageShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span className="text-caption">猜你喜欢 · 音乐动态 · 最近收听的相关歌曲</span>
        <ActionButton tone="subtle" disabled={loading} onClick={() => setBatch(value => value + 1)}>
          <RefreshCw size={16} /> {loading ? '加载中' : '换一换 / 刷新'}
        </ActionButton>
      </div>
      <MusicHero
        eyebrow="For You"
        title="推荐"
        subtitle="融合 B站个性化推荐、新歌动态与收听偏好。登录后可获取更多专属推荐。"
        image={heroSong?.pic}
        tone="red"
        action={(
          <ActionButton onClick={() => handlePlayAll([...featuredSongs, ...recommendedSongs])} disabled={loading || (!recommendedSongs.length && !featuredSongs.length)}>
            <Play size={17} fill="currentColor" />
            播放推荐
          </ActionButton>
        )}
      />

      {loading ? (
        <TrackSkeleton />
      ) : error ? (
        <EmptyLibrary icon={<RefreshCw size={38} />} title="加载失败" subtitle={error} />
      ) : (
        <>
          <MusicSection title="为你精选" icon={<Sparkles size={22} />}>
            <FeaturedGrid>
              {featured.map((song, index) => {
                const track = songToTrack(song)
                return (
                  <FeaturedTrackCard
                    key={song.bvid}
                    track={{ ...track, playCount: 0 }}
                    index={index + 1}
                    isCurrent={player.currentTrack?.id === song.bvid}
                    onPlay={() => handlePlay(song, featuredSongs)}
                  />
                )
              })}
            </FeaturedGrid>
          </MusicSection>

          <MusicSection title="猜你喜欢" icon={<Flame size={22} />}>
            <TrackList>
              {recommendations.map((song, index) => {
                const track = songToTrack(song)
                return (
                  <TrackListRow
                    key={song.bvid}
                    track={track}
                    index={index + 1}
                    isCurrent={player.currentTrack?.id === song.bvid}
                    isPlaying={player.isPlaying}
                    onPlay={() => handlePlay(song, recommendedSongs)}
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
