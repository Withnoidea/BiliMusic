import { useCallback, useRef, useState } from 'react'

export interface PlayerSliderProps {
  ariaLabel: string
  value: number
  max: number
  onChange: (value: number) => void
  min?: number
  step?: number
  width?: number | string
  disabled?: boolean
  formatValue?: (value: number) => string
  variant: 'progress' | 'volume'
}

/**
 * 可拖拽进度/音量条。从 PlayerBar 抽出共享，供底部播放栏与歌词页复用。
 */
export default function PlayerSlider({
  ariaLabel,
  value,
  max,
  onChange,
  min = 0,
  step,
  width = '100%',
  disabled = false,
  formatValue,
  variant,
}: PlayerSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const draftRef = useRef<number | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const safeMax = Math.max(max, min)
  const valueRange = safeMax - min
  const clampedValue = clamp(draft ?? value, min, safeMax)
  const percent = valueRange > 0 ? ((clampedValue - min) / valueRange) * 100 : 0
  const isActive = isHovered || isDragging || focused
  const tooltipValue = isDragging ? clampedValue : (isHovered ? preview ?? clampedValue : clampedValue)
  const keyboardStep = step ?? Math.max(valueRange / 100, 1)

  const updateFromClientX = useCallback((clientX: number) => {
    if (disabled || valueRange <= 0) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const nextPercent = clamp((clientX - rect.left) / rect.width, 0, 1)
    const next = min + nextPercent * valueRange
    setDraft(next)
    draftRef.current = next
    if (variant === 'volume') onChange(next)
  }, [disabled, min, onChange, valueRange, variant])

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.type !== 'pointercancel' && draftRef.current !== null) onChange(draftRef.current)
    draftRef.current = null
    setDraft(null)
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [onChange])

  return (
    <div
      ref={trackRef}
      className="player-slider"
      role="slider"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(clampedValue)}
      aria-valuetext={formatValue ? formatValue(clampedValue) : String(Math.round(clampedValue))}
      aria-disabled={disabled || undefined}
      data-slider={variant}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(event) => {
        if (disabled) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsDragging(true)
        updateFromClientX(event.clientX)
      }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setPreview(min + clamp((event.clientX - rect.left) / rect.width, 0, 1) * valueRange)
        if (isDragging) updateFromClientX(event.clientX)
      }}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setPreview(null) }}
      onKeyDown={(event) => {
        if (disabled) return

        if (event.key === 'Home') {
          event.preventDefault()
          onChange(min)
          return
        }

        if (event.key === 'End') {
          event.preventDefault()
          onChange(safeMax)
          return
        }

        const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
            ? -1
            : 0

        if (direction !== 0) {
          event.preventDefault()
          onChange(clamp(clampedValue + direction * keyboardStep, min, safeMax))
        }
      }}
      style={{
        flex: width === '100%' ? 1 : undefined,
        width,
        height: 20,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.75 : 1,
        touchAction: 'none',
        outline: 'none',
      }}
    >
      {isActive && !disabled && <span className="player-slider__tooltip" role="tooltip" style={{ left: `${clamp(((tooltipValue) - min) / (valueRange || 1), 0, 1) * 100}%` }}>
        {formatValue ? formatValue(tooltipValue) : `${Math.round(tooltipValue)}${variant === 'volume' ? '%' : ''}`}
      </span>}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: isActive ? 6 : 4,
          transform: 'translateY(-50%)',
          background: 'var(--track-bg, var(--color-border))',
          borderRadius: 'var(--radius-full)',
          transition: 'height var(--duration-fast)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          height: isActive ? 6 : 4,
          width: `${percent}%`,
          transform: 'translateY(-50%)',
          background: 'var(--track-fill, var(--color-accent))',
          borderRadius: 'var(--radius-full)',
          transition: isDragging
            ? 'height var(--duration-fast)'
            : 'width 200ms linear, height var(--duration-fast)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${percent}%`,
          top: '50%',
          width: 12,
          height: 12,
          borderRadius: 'var(--radius-full)',
          background: 'var(--track-thumb, var(--color-on-accent))',
          border: '2px solid var(--track-fill, var(--color-accent))',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
          opacity: isActive && !disabled ? 1 : 0,
          transform: `translate(-50%, -50%) scale(${isActive ? 1 : 0.7})`,
          transition: 'opacity var(--duration-fast), transform var(--duration-fast)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
