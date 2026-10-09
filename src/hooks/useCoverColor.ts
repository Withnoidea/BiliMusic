import { useEffect, useState } from 'react'
const fallback = '110, 131, 190'
const colors = new Map<string, Promise<string>>()
function colorFor(url: string) {
  if (!colors.has(url)) {
    if (colors.size > 60) colors.delete(colors.keys().next().value!)
    colors.set(url, new Promise(resolve => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 24
          const context = canvas.getContext('2d', { willReadFrequently: true })!
          context.drawImage(image, 0, 0, 24, 24)
          const { data } = context.getImageData(0, 0, 24, 24)
          const buckets = new Map<string, { count: number; rgb: number[] }>()
          for (let i = 0; i < data.length; i += 4) {
            const rgb = [data[i], data[i + 1], data[i + 2]]
            const high = Math.max(...rgb), low = Math.min(...rgb)
            if (high < 35 || low > 225) continue
            const key = rgb.map(v => v >> 5).join(',')
            const bucket = buckets.get(key) || { count: 0, rgb: [0, 0, 0] }
            const weight = 1 + (high - low) / 255
            bucket.count += weight
            rgb.forEach((v, channel) => { bucket.rgb[channel] += v * weight })
            buckets.set(key, bucket)
          }
          const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0]
          resolve(best ? best.rgb.map(v => Math.round(v / best.count)).join(', ') : fallback)
        } catch { resolve(fallback) }
      }
      image.onerror = () => resolve(fallback)
      image.src = url
    }))
  }
  return colors.get(url)!
}
export function useCoverColor(url?: string) {
  const [color, setColor] = useState(fallback)
  useEffect(() => {
    let alive = true
    if (!url) { setColor(fallback); return }
    void colorFor(url).then(color => { if (alive) setColor(color) })
    return () => { alive = false }
  }, [url])
  return color
}
