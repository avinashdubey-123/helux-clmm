import { createContext, useContext, useState, ReactNode } from 'react'
import TxSmallCard from '../components/TxSmallCard/TxSmallCard'

export interface TransactionRecord {
  signature: string | null
  description: string
  timestamp: number
  title?: string
}

interface TxContextType {
  transactions: TransactionRecord[]
  addTransaction: (signature: string | null, description: string, title?: string, suppressToast?: boolean) => void
}

const TxContext = createContext<TxContextType>({
  transactions: [],
  addTransaction: () => {},
})

export function TxProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [latestTx, setLatestTx] = useState<TransactionRecord | null>(null)

  const addTransaction = (signature: string | null, description: string, title?: string, suppressToast?: boolean) => {
    const tx = { signature, description, timestamp: Date.now(), title }
    setTransactions((prev) => [tx, ...prev])
    if (!suppressToast) {
      setLatestTx(tx)
    }
  }



  return (
    <TxContext.Provider value={{ transactions, addTransaction }}>
      {children}
      {latestTx && (
        <TxSmallCard 
          status="success"
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
