import React from 'react';
import './PoolHoverCard.css';

interface PoolHoverCardProps {
  poolAddress: string;
  token0Mint: string;
  token1Mint: string;
}

const getSphereLabel = (mint: string) => {
  return mint.slice(0, 2).toUpperCase();
};

const PoolHoverCard: React.FC<PoolHoverCardProps> = ({ poolAddress, token0Mint, token1Mint }) => {
  return (
    <div className="pool-hover-card">
      <div className="pool-info">
        <div><strong>Pool Address:</strong> {poolAddress}</div>
        <div><strong>Token0 Mint:</strong> {token0Mint}</div>
        <div><strong>Token1 Mint:</strong> {token1Mint}</div>
      </div>
      <div className="pool-icons">
        <div className="symbol-sphere" title={token0Mint}>${getSphereLabel(token0Mint)}</div>
        <div className="symbol-sphere" title={token1Mint}>${getSphereLabel(token1Mint)}</div>
      </div>
    </div>
  );
};

export default PoolHoverCard;
