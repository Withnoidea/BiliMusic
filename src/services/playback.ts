const BOOKMARKS_KEY = 'bilimusic_audio_bookmarks'
type Bookmark = { position: number; updatedAt: number }
function bookmarks(): Record<string, Bookmark> {
  try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '{}') } catch { return {} }
}
export function savedPosition(id: string): number { return Math.max(0, Number(bookmarks()[id]?.position) || 0) }
export function rememberPosition(id: string, position: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 15 * 60 || !Number.isFinite(position)) return
  const data = bookmarks()
  if (position >= duration - 10 || position < 3) delete data[id]
  else data[id] = { position, updatedAt: Date.now() }
  const recent = Object.entries(data).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 200)
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Object.fromEntries(recent))) } catch { /* storage full */ }
}
const fades = new WeakMap<HTMLAudioElement, () => void>()
export function fadeVolume(audio: HTMLAudioElement, target: number, milliseconds = 150): Promise<void> {
  fades.get(audio)?.()
  return new Promise(resolve => {
    const start = audio.volume, started = performance.now()
    let timer: ReturnType<typeof setTimeout>
    const finish = () => { clearTimeout(timer); fades.delete(audio); resolve() }
    fades.set(audio, finish)
    const tick = () => {
      const fraction = Math.min(1, (performance.now() - started) / milliseconds)
      const curve = fraction * fraction * (3 - 2 * fraction)
      audio.volume = Math.max(0, Math.min(1, start + (target - start) * curve))
      if (fraction < 1) timer = setTimeout(tick, 10)
      else finish()
    }
    tick()
  })
}
export function waitForMetadata(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', ready); audio.removeEventListener('error', failed); signal.removeEventListener('abort', aborted) }
    const ready = () => { clean(); resolve() }
    const failed = () => { clean(); reject(new Error('音频加载失败')) }
    const aborted = () => { clean(); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = setTimeout(failed, 20000)
    audio.addEventListener('loadedmetadata', ready)
    audio.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
    else if (audio.readyState >= 1) ready()
  })
}

// play() can remain pending after metadata arrives if the CDN stalls before the first frame.
// Bound that phase as well, so the source lifecycle can refresh rather than spin forever.
export function startPlayback(audio: HTMLAudioElement, signal: AbortSignal, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted) }
    const failed = (error: unknown) => { clean(); reject(error) }
    const aborted = () => failed(new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => failed(new Error('音频连接超时')), timeoutMs)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) { aborted(); return }
    try { audio.play().then(() => { clean(); resolve() }, failed) } catch (error) { failed(error) }
  })
}
