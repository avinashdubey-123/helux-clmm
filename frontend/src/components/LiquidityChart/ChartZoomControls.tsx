import React from 'react'
import resetIcon from '../../assets/reset-btn.svg'

interface ChartZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}

export const ChartZoomControls: React.FC<ChartZoomControlsProps> = ({
  onZoomIn,
  onZoomOut,
  onReset,
}) => {
  return (
    <div className="liq-zoom-controls" role="group" aria-label="Chart zoom controls">
      <button 
        type="button" 
        className="liq-zoom-btn" 
        onClick={onReset} 
        aria-label="Reset zoom"
        title="Reset zoom"
      >
        <img src={resetIcon} alt="Reset" />
      </button>
      <button 
        type="button" 
        className="liq-zoom-btn" 
        onClick={onZoomIn} 
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
      <button 
        type="button" 
        className="liq-zoom-btn" 
        onClick={onZoomOut} 
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
    </div>
  )
}
