/** Four DIP inset; the entire text container stays visible on every display. */
export function clampLyricBounds(x: number, y: number, width: number, height: number,
  area: { x: number; y: number; width: number; height: number }) {
  const gap = 4
  width = Math.max(1, Math.min(width, area.width - gap * 2))
  height = Math.max(1, Math.min(height, area.height - gap * 2))
  return {
    x: Math.round(Math.max(area.x + gap, Math.min(x, area.x + area.width - width - gap))),
    y: Math.round(Math.max(area.y + gap, Math.min(y, area.y + area.height - height - gap))),
    width: Math.round(width), height: Math.round(height),
  }
}
