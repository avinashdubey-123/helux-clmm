import { useState, useMemo, useRef, useEffect } from 'react';
import { useTokenRegistry } from '../../contexts/TokenRegistryContext';
import { useConnection } from '@solana/wallet-adapter-react';
import './TokenSelector.css';

interface TokenSelectorProps {
  selectedMint: string;
  onSelect: (mint: string) => void;
  excludeMint?: string;
}

export default function TokenSelector({ selectedMint, onSelect, excludeMint }: TokenSelectorProps) {
  const { tokens, searchTokens, addCustomToken, isLoading, error } = useTokenRegistry();
  const { connection } = useConnection();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredTokens = useMemo(() => {
    return searchTokens(query).filter(t => t.mint !== excludeMint);
  }, [searchTokens, query, excludeMint]);

  const selectedToken = useMemo(() => {
    return tokens.find(t => t.mint === selectedMint);
  }, [tokens, selectedMint]);

  const handleAdd = async () => {
    if (!query) return;
    const newEntry = await addCustomToken(connection, query);
    if (newEntry) {
      onSelect(newEntry.mint);
      setIsOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="token-selector-wrapper" ref={containerRef}>
      <button className="token-selector-trigger" type="button" onClick={() => setIsOpen(!isOpen)}>
        {selectedToken ? (
          <span className="token-selector-value">
            <span className="token-selector-sphere" style={{ backgroundColor: selectedToken.color || '#555' }}>
              {selectedToken.symbol.slice(0, 2).toUpperCase()}
            </span>
            <strong>{selectedToken.symbol}</strong>
            <small>{selectedToken.mint.slice(0, 4)}...{selectedToken.mint.slice(-4)}</small>
          </span>
        ) : (
          <span className="token-selector-placeholder">Select Token</span>
        )}
        <svg className="token-selector-caret" viewBox="0 0 24 24">
          <path fill="currentColor" d="M7 10l5 5 5-5H7z" />
        </svg>
      </button>

      {isOpen && (
        <div className="token-selector-dropdown">
          <div className="token-selector-search">
            <input
              type="text"
              placeholder="Search symbol or paste mint address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="token-selector-list">
            {filteredTokens.length > 0 ? (
              filteredTokens.map(token => (
                <button
                  key={token.mint}
                  className="token-selector-item"
                  type="button"
                  onClick={() => {
                    onSelect(token.mint);
                    setIsOpen(false);
                    setQuery('');
                  }}
                >
                  <div className="token-selector-item-main">
                    <span className="token-selector-sphere-small" style={{ backgroundColor: token.color || '#555' }}>
                      {token.symbol.slice(0, 2).toUpperCase()}
                    </span>
                    <strong>{token.symbol}</strong>
                    <span>{token.name}</span>
                  </div>
                  <div className="token-selector-item-mint">
                    {token.mint.slice(0, 4)}...{token.mint.slice(-4)}
                  </div>
                </button>
              ))
            ) : (
              <div className="token-selector-empty">
                {query.length >= 32 ? (
                  <div className="token-selector-add-custom">
                    <p>Token not found in registry.</p>
                    {isLoading ? (
                      <button type="button" disabled className="token-selector-btn">Adding...</button>
                    ) : (
                      <button type="button" onClick={handleAdd} className="token-selector-btn">Add Custom Token</button>
                    )}
                    {error && <p className="token-selector-error">{error}</p>}
                  </div>
                ) : (
                  <p>No tokens found.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
