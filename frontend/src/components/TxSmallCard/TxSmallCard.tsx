import React, { useState, useEffect } from 'react'
import './TxSmallCard.css'

export const CARD_LIFETIME_MS = 12000
const CLOSE_ANIMATION_MS = 260

interface TxSmallCardProps {
  status: 'success' | 'error' | 'info'
  title: string
  description: string
  signature: string | null
  details?: string
  onClose: () => void
}

const TxSmallCard: React.FC<TxSmallCardProps> = ({ status, title, description, signature, details, onClose }) => {
  const [isClosing, setIsClosing] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  
  useEffect(() => {
    const startCloseTimer = window.setTimeout(() => {
      setIsClosing(true)
      window.setTimeout(() => {
        onClose()
      }, CLOSE_ANIMATION_MS)
    }, CARD_LIFETIME_MS)

    return () => {
      window.clearTimeout(startCloseTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div 
      className={`tx-card-toast tx-card-toast--${status} ${isClosing ? 'tx-card-toast--closing' : ''}`}
      style={{
        ['--tx-card-lifetime' as any]: `${CARD_LIFETIME_MS}ms`,
        ['--tx-card-close-duration' as any]: `${CLOSE_ANIMATION_MS}ms`,
      }}
    >
      <div className={`tx-card-timer-bar ${status === 'info' ? 'tx-card-timer-bar--info' : 'tx-card-timer-bar--timed'}`}></div>
      <div className="tx-card-header">
        <h4>{title}</h4>
        <button onClick={onClose} className="tx-card-close">✕</button>
      </div>
      <p className="tx-card-desc">{description}</p>
      {details && (
        <div className="tx-card-details" style={{ marginTop: '8px' }}>
          <button 
            onClick={() => setShowDetails(!showDetails)} 
            style={{ background: 'none', border: 'none', color: 'var(--tx-card-link-color)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
          >
            {showDetails ? 'Hide Details ▲' : 'Show Details ▼'}
          </button>
          {showDetails && (
            <pre style={{ 
              marginTop: '8px', 
              padding: '8px', 
              background: 'rgba(0,0,0,0.2)', 
              borderRadius: '4px', 
              fontSize: '11px', 
              whiteSpace: 'pre-wrap', 
              wordBreak: 'break-all',
              maxHeight: '150px',
              overflowY: 'auto'
            }}>
              {details}
            </pre>
          )}
        </div>
      )}
      {signature && (
        <a 
          className="tx-card-link"
          href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} 
          target="_blank" 
          rel="noreferrer"
        >
          View on Explorer ↗
        </a>
      )}
    </div>
  )
}

export default TxSmallCard
