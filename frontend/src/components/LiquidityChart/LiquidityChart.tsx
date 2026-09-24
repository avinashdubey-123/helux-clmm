import React, { useCallback } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts'
import { RangeHandle } from './RangeHandle'
import { ChartZoomControls } from './ChartZoomControls'
import { ChartLegend } from './ChartLegend'
import { useRangeDrag } from './useRangeDrag'
import './LiquidityChart.css'

interface LiquidityDataPoint {
  price: number
  liquidity: number
}

interface LiquidityChartProps {
  liquidityData: LiquidityDataPoint[]
  currentPrice: number
  selectedMinPrice: number
  selectedMaxPrice: number
  onRangeChange: (minPrice: number, maxPrice: number) => void
  priceOrientation: 'token0PerToken1' | 'token1PerToken0'
  displayBaseLabel: string
  token0Name: string
  token1Name: string
  onToggleOrientation: () => void
  onResetZoom: () => void
}

const formatAmount = (value: number) => {
  if (value === Infinity) return '∞'
  if (value === -Infinity) return '-∞'
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return value.toFixed(6).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1')
}

// PlotBoxReporter removed in favor of ResizeObserver

const LiquidityTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', padding: '10px 14px', borderRadius: '12px', boxShadow: '0 8px 24px var(--app-shadow)' }}>
        <p style={{ margin: 0, color: 'var(--app-ink)', fontSize: '12px', fontWeight: 600 }}>Price: {formatAmount(payload[0].payload.price)}</p>
      </div>
    )
  }
  return null
}

const getTickStep = (min: number, max: number, maxTicks = 7) => {
  const range = max - min;
  if (range <= 0) return 1;
  const rawStep = range / (maxTicks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalizedStep = rawStep / mag;

  let stepMultiplier;
  if (normalizedStep <= 1) stepMultiplier = 1;
  else if (normalizedStep <= 2) stepMultiplier = 2;
  else if (normalizedStep <= 2.5) stepMultiplier = 2.5;
  else if (normalizedStep <= 5) stepMultiplier = 5;
  else stepMultiplier = 10;

  return stepMultiplier * mag;
}

const calculateTicks = (min: number, max: number, maxTicks = 7) => {
  if (max - min <= 0) return [min];
  
  const step = getTickStep(min, max, maxTicks);


  const firstTick = Math.ceil(min / step) * step;
  const ticks = [];
  for (let t = firstTick; t <= max + step * 0.01; t += step) {
    ticks.push(t);
  }
  return ticks;
}

const StaticRechartsPlot = React.memo(({ liquidityData, animDomain, currentPrice, displayBaseLabel, width, height }: any) => (
  <AreaChart width={width} height={height} data={liquidityData} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
    <defs>
      <linearGradient id="liquidityGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--app-chart)" stopOpacity={0.35} />
        <stop offset="100%" stopColor="var(--app-chart)" stopOpacity={0.04} />
      </linearGradient>
    </defs>
    <CartesianGrid strokeDasharray="3 4" stroke="var(--app-border)" vertical={false} />
    <XAxis
      dataKey="price"
      type="number"
      domain={animDomain}
      ticks={calculateTicks(animDomain[0], animDomain[1])}
      allowDataOverflow={true}
      tickFormatter={(v: any) => formatAmount(Number(v))}
      tick={{ fill: 'var(--app-muted)', fontSize: 11 }}
      tickLine={false}
      axisLine={{ stroke: 'var(--app-border)' }}
      label={{
        value: `Price (${displayBaseLabel})`,
        position: 'insideBottom',
        offset: -8,
        fill: 'var(--app-muted)',
        fontSize: 11,
      }}
      height={44}
    />
    <YAxis
      tickFormatter={(v: any) => `${v.toFixed(0)}`}
      tick={{ fill: 'var(--app-muted)', fontSize: 11 }}
      tickLine={false}
      axisLine={false}
      width={40}
    />
    <Tooltip content={<LiquidityTooltip />} />
    <Area
      type="stepAfter"
      dataKey="liquidity"
      stroke="var(--app-chart)"
      strokeWidth={1.5}
      fill="url(#liquidityGrad)"
      dot={false}
      activeDot={false}
      isAnimationActive={false}
    />
    <ReferenceLine
      x={currentPrice}
      stroke="var(--app-current)"
      strokeDasharray="3 3"
      strokeWidth={2}
      label={{
        value: 'Current',
        position: 'insideTopLeft',
        fill: 'var(--app-current)',
        fontSize: 10,
        fontWeight: 700,
      }}
    />
  </AreaChart>
), (prevProps, nextProps) => {
  return prevProps.liquidityData === nextProps.liquidityData &&
         prevProps.animDomain[0] === nextProps.animDomain[0] &&
         prevProps.animDomain[1] === nextProps.animDomain[1] &&
         prevProps.currentPrice === nextProps.currentPrice &&
         prevProps.displayBaseLabel === nextProps.displayBaseLabel &&
         prevProps.width === nextProps.width &&
         prevProps.height === nextProps.height;
})

export const LiquidityChart: React.FC<LiquidityChartProps> = ({
  liquidityData,
  currentPrice,
  selectedMinPrice,
  selectedMaxPrice,
  onRangeChange,
  priceOrientation,
  displayBaseLabel,
  token0Name,
  token1Name,
  onToggleOrientation,
  onResetZoom
}) => {
  // --- Progressive Scaling State ---
  const [scaleLevelLower, setScaleLevelLower] = React.useState(0)
  const [scaleLevelUpper, setScaleLevelUpper] = React.useState(0)
  const [zoomCenter, setZoomCenter] = React.useState<number | null>(null)

  const getUnits = React.useCallback((level: number) => {
    if (level === 0) return 1
    if (level < 0) {
      return Math.pow(0.5, -level)
    }
    let units = 1
    for (let i = 1; i <= level; i++) {
      if (i % 2 === 1) units += 2
      else units *= 2
    }
    return units
  }, [])

  React.useEffect(() => {
    if (scaleLevelLower === 0 && scaleLevelUpper === 0) {
      setZoomCenter(null);
    }
  }, [scaleLevelLower, scaleLevelUpper]);

  const activeZoomCenter = zoomCenter !== null ? zoomCenter : currentPrice;
  const baseUnit = currentPrice * 0.15
  
  const targetMin = Math.max(0, activeZoomCenter - getUnits(scaleLevelLower) * baseUnit)
  const targetMax = Math.min(9e15, activeZoomCenter + getUnits(scaleLevelUpper) * baseUnit)

  const [animDomain, setAnimDomain] = React.useState<[number, number]>([targetMin, targetMax])
  const animDomainRef = React.useRef([targetMin, targetMax])
  
  // Animate to target domain smoothly
  React.useEffect(() => {
    let animationFrame: number
    let startTimestamp: number
    const duration = 150
    const startMin = animDomainRef.current[0]
    const startMax = animDomainRef.current[1]
    
    if (startMin === targetMin && startMax === targetMax) return
    
    const animate = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / duration, 1)
      
      const ease = 1 - Math.pow(1 - progress, 3)
      
      const newMin = startMin + (targetMin - startMin) * ease
      const newMax = startMax + (targetMax - startMax) * ease
      
      animDomainRef.current = [newMin, newMax]
      setAnimDomain([newMin, newMax])
      
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate)
      }
    }
    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [targetMin, targetMax])

  const handleDragEnd = useCallback((handle: 'lower' | 'upper', finalPrice: number) => {
    let newPrice = Math.max(0, Math.min(9e15, finalPrice))

    if (handle === 'lower') {
      onRangeChange(newPrice, selectedMaxPrice)
    } else {
      onRangeChange(selectedMinPrice, newPrice)
    }
  }, [selectedMinPrice, selectedMaxPrice, onRangeChange])

  const { dragState, onPointerDown, onPointerMove, onPointerUp, setPlotBox: hookSetPlotBox, updateDragContextForNewDomain } = useRangeDrag({
    initialLowerPrice: selectedMinPrice,
    initialUpperPrice: selectedMaxPrice,
    domain: [targetMin, targetMax],
    onDragEnd: handleDragEnd
  })

  // Handle progressive edge transitions during drag
  React.useEffect(() => {
    if (!dragState.isDragging || !dragState.draggingHandle) return;
    const handle = dragState.draggingHandle;
    const pointerPrice = handle === 'lower' ? dragState.visualPriceLower : dragState.visualPriceUpper;

    if (handle === 'upper') {
      const bound = currentPrice + getUnits(scaleLevelUpper) * baseUnit;
      if (pointerPrice >= bound) {
        const nextLevel = scaleLevelUpper + 1;
        setScaleLevelUpper(nextLevel);
        const newMax = Math.min(9e15, currentPrice + getUnits(nextLevel) * baseUnit);
        updateDragContextForNewDomain([targetMin, newMax]);
      } else if (scaleLevelUpper > 0) {
        const prevBound = currentPrice + getUnits(scaleLevelUpper - 1) * baseUnit;
        if (pointerPrice < prevBound - baseUnit * 0.05) {
          const nextLevel = scaleLevelUpper - 1;
          setScaleLevelUpper(nextLevel);
          const newMax = Math.min(9e15, currentPrice + getUnits(nextLevel) * baseUnit);
          updateDragContextForNewDomain([targetMin, newMax]);
        }
      }
    } else {
      const bound = currentPrice - getUnits(scaleLevelLower) * baseUnit;
      if (pointerPrice <= bound) {
        const nextLevel = scaleLevelLower + 1;
        setScaleLevelLower(nextLevel);
        const newMin = Math.max(0, currentPrice - getUnits(nextLevel) * baseUnit);
        updateDragContextForNewDomain([newMin, targetMax]);
      } else if (scaleLevelLower > 0) {
        const prevBound = currentPrice - getUnits(scaleLevelLower - 1) * baseUnit;
        if (pointerPrice > prevBound + baseUnit * 0.05) {
          const nextLevel = scaleLevelLower - 1;
          setScaleLevelLower(nextLevel);
          const newMin = Math.max(0, currentPrice - getUnits(nextLevel) * baseUnit);
          updateDragContextForNewDomain([newMin, targetMax]);
        }
      }
    }
  }, [
    dragState.visualPriceLower, dragState.visualPriceUpper, dragState.isDragging, 
    dragState.draggingHandle, currentPrice, baseUnit, scaleLevelUpper, 
    scaleLevelLower, targetMin, targetMax, updateDragContextForNewDomain, getUnits
  ]);

  const handleZoomIn = React.useCallback(() => {
    const center = (selectedMinPrice + selectedMaxPrice) / 2;
    const nextLowerLevel = scaleLevelLower - 1;
    const nextUpperLevel = scaleLevelUpper - 1;
    
    const nextMin = Math.max(0, center - getUnits(nextLowerLevel) * baseUnit);
    const nextMax = Math.min(9e15, center + getUnits(nextUpperLevel) * baseUnit);
    
    // Prevent zooming if the tick increment would drop below 0.05
    if (getTickStep(nextMin, nextMax) < 0.05) {
      return;
    }

    setZoomCenter(center);
    setScaleLevelLower(nextLowerLevel);
    setScaleLevelUpper(nextUpperLevel);
  }, [selectedMinPrice, selectedMaxPrice, scaleLevelLower, scaleLevelUpper, baseUnit, getUnits]);

  const handleZoomOut = React.useCallback(() => {
    setZoomCenter((selectedMinPrice + selectedMaxPrice) / 2);
    setScaleLevelLower(prev => prev + 1);
    setScaleLevelUpper(prev => prev + 1);
  }, [selectedMinPrice, selectedMaxPrice]);

  const handleResetZoom = React.useCallback(() => {
    setZoomCenter(null);
    setScaleLevelLower(0);
    setScaleLevelUpper(0);
    if (onResetZoom) onResetZoom();
  }, [onResetZoom]);

  const [plotBox, setPlotBoxState] = React.useState({ x: 40, width: 0 })
  const chartRef = React.useRef<HTMLDivElement>(null)
  
  React.useEffect(() => {
    if (!chartRef.current) return
    const observer = new ResizeObserver((entries) => {
      const containerWidth = entries[0].contentRect.width
      // Recharts renders plot area with a left padding (approx 40px for YAxis) and right padding (16px)
      // So plot width is containerWidth - 56
      const width = containerWidth > 56 ? containerWidth - 56 : 400
      const box = { x: 40, width }
      setPlotBoxState(box)
      hookSetPlotBox(box)
    })
    observer.observe(chartRef.current)
    return () => observer.disconnect()
  }, [hookSetPlotBox])

  // Derive visual prices during drag
  const currentMinPrice = dragState.isDragging && dragState.draggingHandle === 'lower' 
    ? dragState.visualPriceLower 
    : selectedMinPrice;
  const currentMaxPrice = dragState.isDragging && dragState.draggingHandle === 'upper' 
    ? dragState.visualPriceUpper 
    : selectedMaxPrice;

  // Calculate percentages based on animDomain
  const animRange = animDomain[1] - animDomain[0];
  const pctLower = animRange > 0 ? ((currentMinPrice - animDomain[0]) / animRange) * 100 : 0;
  const pctUpper = animRange > 0 ? ((currentMaxPrice - animDomain[0]) / animRange) * 100 : 100;
  
  const clampedPctLower = Math.max(0, Math.min(100, pctLower));
  const clampedPctUpper = Math.max(0, Math.min(100, pctUpper));

  return (
    <div className="liq-chart-container" ref={chartRef}>
      <div className="liq-chart-header">
        <div className="liq-chart-title">
          <strong>Liquidity Depth</strong>
          <span>On-chain distribution</span>
        </div>
        <ChartZoomControls 
          onZoomIn={handleZoomIn} 
          onZoomOut={handleZoomOut} 
          onReset={handleResetZoom} 
        />
      </div>

      <div className="liq-chart-wrapper" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <ResponsiveContainer width="100%" height="100%">
          <StaticRechartsPlot 
            liquidityData={liquidityData}
            animDomain={animDomain}
            currentPrice={currentPrice}
            displayBaseLabel={displayBaseLabel}
          />
        </ResponsiveContainer>

        {liquidityData.length > 0 && animRange > 0 && (
          <>
            {/* Dimmed Left Overlay */}
            {clampedPctLower > 0 && (
              <div style={{ position: 'absolute', top: 16, bottom: 44, left: plotBox.x, width: (clampedPctLower / 100) * plotBox.width, background: 'var(--app-bg)', opacity: 0.4, pointerEvents: 'none' }} />
            )}
            
            {/* Active Range Overlay */}
            <div style={{ position: 'absolute', top: 16, bottom: 44, left: plotBox.x + (clampedPctLower / 100) * plotBox.width, width: ((clampedPctUpper - clampedPctLower) / 100) * plotBox.width, background: 'var(--app-accent)', opacity: 0.15, pointerEvents: 'none' }} />
            
            {/* Dimmed Right Overlay */}
            {clampedPctUpper < 100 && (
              <div style={{ position: 'absolute', top: 16, bottom: 44, left: plotBox.x + (clampedPctUpper / 100) * plotBox.width, width: ((100 - clampedPctUpper) / 100) * plotBox.width, background: 'var(--app-bg)', opacity: 0.4, pointerEvents: 'none' }} />
            )}
          </>
        )}

        {liquidityData.length > 0 && animRange > 0 && (
          <>
            <RangeHandle 
              type="lower"
              pct={pctLower}
              priceDisplay={formatAmount(currentMinPrice)}
              plotBox={plotBox}
              orientation={priceOrientation}
              onPointerDown={onPointerDown}
              isDragging={dragState.isDragging && dragState.draggingHandle === 'lower'}
            />
            <RangeHandle 
              type="upper"
              pct={pctUpper}
              priceDisplay={formatAmount(currentMaxPrice)}
              plotBox={plotBox}
              orientation={priceOrientation}
              onPointerDown={onPointerDown}
              isDragging={dragState.isDragging && dragState.draggingHandle === 'upper'}
            />
          </>
        )}

        {liquidityData.length === 0 && (
          <div className="liq-empty-state">No on-chain liquidity data available.</div>
        )}
      </div>

      <ChartLegend 
        currentPriceDisplay={`${formatAmount(currentPrice)} ${displayBaseLabel}`}
        orientationLabel={priceOrientation === 'token1PerToken0' ? `Show ${token0Name} / ${token1Name}` : `Show ${token1Name} / ${token0Name}`}
        onToggleOrientation={onToggleOrientation}
      />
    </div>
  )
}
