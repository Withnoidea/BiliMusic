/** API durations can be numeric seconds, mm:ss or hh:mm:ss. Unknown stays unknown. */
export function parseDuration(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const parts = String(value).trim().split(':')
    if (parts.length > 3 || parts.some(p => !/^\d+(?:\.\d+)?$/.test(p))) continue
    const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0)
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds)
  }
  return 0
}
