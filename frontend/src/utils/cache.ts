import { PoolRowData } from "../contexts/PoolsContext";


const __poolDataCache: Map<string, PoolRowData> = 
  (globalThis as any).__poolDataCache || 
  ((globalThis as any).__poolDataCache = new Map());

export function getCachedPoolData(poolPda: string): PoolRowData | undefined {
  return __poolDataCache.get(poolPda);
}

export function setCachedPoolData(poolPda: string, data: PoolRowData) {
  __poolDataCache.set(poolPda, data);
}

export function clearPoolDataCache() {
  __poolDataCache.clear();
}

export function triggerPoolsRefetch(walletAddress: string) {
  const current = Number(sessionStorage.getItem(`pools_refetch_${walletAddress}`) || 0)
  sessionStorage.setItem(`pools_refetch_${walletAddress}`, String(current + 1))
}

export function checkAndClearPoolsRefetch(walletAddress: string) {
  const currentCount = Number(sessionStorage.getItem(`pools_refetch_${walletAddress}`) || 0);
  const lastProcessed = Number(sessionStorage.getItem(`pools_last_processed_${walletAddress}`) || 0);
  
  if (currentCount > lastProcessed) {
    clearPoolDataCache();
    sessionStorage.setItem(`pools_last_processed_${walletAddress}`, String(currentCount));
    return true; // Indicates cache was cleared
  }
  return false;
}

export interface ActivityItem {
  id: string
  actionType: 'Deposit' | 'Withdraw' | 'Swap'
  poolAddress?: string
  timestamp: number
  signature?: string
  status: 'success' | 'failed'
}

const STORAGE_KEY = 'clmm_session_activity';

export function logTransaction(item: ActivityItem) {
  try {
    const existingStr = sessionStorage.getItem(STORAGE_KEY);
    const existing: ActivityItem[] = existingStr ? JSON.parse(existingStr) : [];
    existing.unshift(item); // Add to the top
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 50))); // Keep last 50
  } catch (e) {
    console.error("Failed to log transaction", e);
  }
}

export function getRecentTransactions(): ActivityItem[] {
  try {
    const existingStr = sessionStorage.getItem(STORAGE_KEY);
    return existingStr ? JSON.parse(existingStr) : [];
  } catch {
    return [];
  }
}
