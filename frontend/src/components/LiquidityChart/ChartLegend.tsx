import React from 'react'

interface ChartLegendProps {
  currentPriceDisplay: string
  orientationLabel: string
  onToggleOrientation: () => void
}

export const ChartLegend: React.FC<ChartLegendProps> = ({
  currentPriceDisplay,
  orientationLabel,
  onToggleOrientation,
}) => {
  return (
    <div className="liq-chart-legend">
      <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
        <div className="liq-legend-item">
          <span>Current Price</span>
          <strong>{currentPriceDisplay}</strong>
        </div>
      </div>
      <button 
        type="button" 
        className="liq-toggle-btn" 
        onClick={onToggleOrientation}
      >
        {orientationLabel} <span>↔</span>
      </button>
    </div>
  )
}
