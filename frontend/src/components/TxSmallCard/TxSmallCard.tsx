import React from 'react'
import './TxSmallCard.css'

interface TxSmallCardProps {
  title: string
  description: string
  signature: string | null
  onClose: () => void
}

const TxSmallCard: React.FC<TxSmallCardProps> = ({ title, description, signature, onClose }) => {
  return (
    <div className="tx-card-toast">
      <div className="tx-card-header">
        <h4>{title}</h4>
        <button onClick={onClose} className="tx-card-close">✕</button>
      </div>
      <p className="tx-card-desc">{description}</p>
      {signature && (
        <a 
          href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} 
          target="_blank" 
          rel="noreferrer"
          className="tx-card-link"
        >
          View on Explorer &nearr;
        </a>
      )}
      <div className="tx-card-timer-bar"></div>
    </div>
  )
}

export default TxSmallCard
