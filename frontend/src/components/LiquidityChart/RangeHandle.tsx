import React, { useRef, useEffect } from 'react'
export type HandleType = 'lower' | 'upper'

interface RangeHandleProps {
  type: HandleType
  pct: number
  priceDisplay: string
  plotBox: { x: number; width: number }
  orientation: 'token0PerToken1' | 'token1PerToken0'
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, type: HandleType) => void
  isDragging: boolean
}

export const RangeHandle: React.FC<RangeHandleProps> = ({
  type,
  pct,
  priceDisplay,
  plotBox,
  onPointerDown,
  isDragging,
}) => {
  const handleRef = useRef<HTMLDivElement>(null)
  
  // Update position via ref to avoid React render-phase delays when dragging
  useEffect(() => {
    if (handleRef.current) {
      const clampedPct = Math.max(0, Math.min(100, pct))
      const x = plotBox.x + (clampedPct / 100) * plotBox.width
      handleRef.current.style.transform = `translateX(${x}px)`
    }
  }, [pct, plotBox])

  const labelPrefix = type === 'lower' ? 'Min: ' : 'Max: '
  const gripIcon = type === 'lower' ? '◀' : '▶'

  return (
    <div
      ref={handleRef}
      className={`liq-range-handle ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: `translateX(${plotBox.x + (Math.max(0, Math.min(100, pct)) / 100) * plotBox.width}px)` }}
    >
      <div 
        className="liq-range-handle-hitarea"
        onPointerDown={(e) => onPointerDown(e, type)}
        aria-label={`${type} price handle`}
        role="slider"
      >
        <div className="liq-range-handle-line" />
        <div className="liq-range-handle-grip">{gripIcon}</div>
        <div className="liq-handle-tooltip">
          {labelPrefix}{priceDisplay}
        </div>
      </div>
    </div>
  )
}
