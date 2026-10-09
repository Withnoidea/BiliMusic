import type { VideoInfo } from '@/services/api'

// Shared for the renderer session, including navigation between both pages.
export const seenTrackIds = new Set<string>()
let seed = Math.floor(Math.random() * 100000)
export function nextFeedSeed(): number { return ++seed }
export function markMusicFeedSeen(videos: VideoInfo[]): void {
  for (const video of videos) seenTrackIds.add(video.bvid)
}
