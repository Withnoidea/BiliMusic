import type { Track } from '@/types'

export function shuffleArray<T>(items: T[], random = Math.random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Keep the selected song first so a complete shuffle cycle visits every song once. */
export function shuffledFrom(tracks: Track[], currentId?: string): Track[] {
  const current = tracks.find(track => track.id === currentId)
  const rest = shuffleArray(tracks.filter(track => track.id !== currentId))
  return current ? [current, ...rest] : rest
}

/** Metadata/like changes must not shuffle tracks already visited in this cycle. */
export function reconcileShuffle(previous: Track[], tracks: Track[], currentId?: string): Track[] {
  if (!previous.length) return shuffledFrom(tracks, currentId)
  const byId = new Map(tracks.map(track => [track.id, track]))
  const kept = previous.flatMap(track => byId.has(track.id) ? [byId.get(track.id)!] : [])
  const seen = new Set(kept.map(track => track.id))
  return [...kept, ...shuffleArray(tracks.filter(track => !seen.has(track.id)))]
}
