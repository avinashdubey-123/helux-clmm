import { createContext, useContext, useState, ReactNode, useEffect } from 'react'
import TxSmallCard from '../components/TxSmallCard/TxSmallCard'

export interface TransactionRecord {
  signature: string | null
  description: string
  timestamp: number
  title?: string
}

interface TxContextType {
  transactions: TransactionRecord[]
  addTransaction: (signature: string | null, description: string, title?: string) => void
}

const TxContext = createContext<TxContextType>({
  transactions: [],
  addTransaction: () => {},
})

export function TxProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [latestTx, setLatestTx] = useState<TransactionRecord | null>(null)

  const addTransaction = (signature: string | null, description: string, title?: string) => {
    const tx = { signature, description, timestamp: Date.now(), title }
    setTransactions((prev) => [tx, ...prev])
    setLatestTx(tx)
  }

  useEffect(() => {
    if (latestTx) {
      const timer = setTimeout(() => {
        setLatestTx(null)
      }, 10000)
      return () => clearTimeout(timer)
    }
  }, [latestTx])

  return (
    <TxContext.Provider value={{ transactions, addTransaction }}>
      {children}
      {latestTx && (
        <TxSmallCard 
          title={latestTx.title || "Transaction Submitted"} 
          description={latestTx.description} 
          signature={latestTx.signature} 
          onClose={() => setLatestTx(null)} 
        />
      )}
    </TxContext.Provider>
  )
}

export function useTransactions() {
  return useContext(TxContext)
}
