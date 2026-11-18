import { Connection, PublicKey } from "@solana/web3.js";
import { fetchOnchainMetadata } from "./onchain";
import { fetchOffchainImage } from "./offchain";
import { OnchainTokenMetadata, TokenMetadata, TokenMetadataRecord } from "./types";

/**
 * Module-level token metadata store.
 *
 * - Requests from every component are coalesced into one batched lookup.
 * - Results (including "no metadata") are cached in memory and in localStorage.
 * - Consumers subscribe via `useSyncExternalStore` (see `useTokenMetadata`).
 * - Failures never throw into the UI: a mint without a result keeps its default display.
 *   Lookups that failed (RPC down) are retried later instead of being treated as final.
 */

const STORAGE_KEY = "tokenMetadataCache:v1";
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;
const BATCH_WINDOW_MS = 50;
const PERSIST_DEBOUNCE_MS = 250;
const QUICK_RETRY_DELAY_MS = 1500;
const RETRY_COOLDOWN_MS = 10_000;
const MAX_AUTO_RETRY_ROUNDS = 3;
const MAX_IMAGE_TRIES = 3;

interface PersistedEntry {
  data: TokenMetadata | null;
  ts: number;
  /** Off-chain metadata link, kept so a missing logo can be retried after a reload. */
  uri?: string;
  /** How many times fetching the logo has failed. */
  imgTries?: number;
}

let snapshot: TokenMetadataRecord = {};
const inFlight = new Set<string>();
const queued = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let latestConnection: Connection | null = null;

/** Mints whose on-chain lookup failed (shown with defaults for now, retried later). */
const failedAt = new Map<string, number>();
let retryRounds = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Logo state per mint: its metadata link and how many fetches have failed. */
const imageState = new Map<string, { uri: string; tries: number }>();
const imageAttempted = new Set<string>();

// ── persistence ────────────────────────────────────────────────────────────

const pendingWrites: Record<string, PersistedEntry> = {};
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function isFresh(entry: PersistedEntry | undefined, now: number): entry is PersistedEntry {
  if (!entry || typeof entry.ts !== "number") return false;
  return now - entry.ts < (entry.data ? FOUND_TTL_MS : NOT_FOUND_TTL_MS);
}

function readPersisted(): Record<string, PersistedEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Writes all queued entries in one go and drops expired ones. */
function writePersisted() {
  persistTimer = null;
  try {
    const now = Date.now();
    const stored = readPersisted();
    const kept: Record<string, PersistedEntry> = {};
    for (const [mint, entry] of Object.entries(stored)) {
      if (isFresh(entry, now)) kept[mint] = entry;
    }
    Object.assign(kept, pendingWrites);
    for (const mint of Object.keys(pendingWrites)) delete pendingWrites[mint];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage full / unavailable - the in-memory cache still works.
  }
}

function queuePersist(mint: string, entry: Omit<PersistedEntry, "ts">) {
  pendingWrites[mint] = { ...entry, ts: Date.now() };
  if (!persistTimer) persistTimer = setTimeout(writePersisted, PERSIST_DEBOUNCE_MS);
}

if (typeof window !== "undefined") {
  // Don't lose results that are still waiting for the debounce when the page closes.
  window.addEventListener("pagehide", () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      writePersisted();
    }
  });
}

function hydrateFromStorage() {
  const now = Date.now();
  const fresh: Record<string, TokenMetadata | null> = {};
  for (const [mint, entry] of Object.entries(readPersisted())) {
    if (!isFresh(entry, now)) continue;
    fresh[mint] = entry.data;
    const tries = entry.imgTries ?? 0;
    if (entry.uri && !entry.data?.image && tries < MAX_IMAGE_TRIES) {
      // Cached without a logo (reloaded mid-fetch, or the fetch failed): retry later.
      imageState.set(mint, { uri: entry.uri, tries });
    }
  }
  snapshot = fresh;
}

hydrateFromStorage();

// ── publishing ─────────────────────────────────────────────────────────────

function publish(updates: Record<string, TokenMetadata | null>) {
  snapshot = { ...snapshot, ...updates };
  listeners.forEach(listener => listener());
}

function toTokenMetadata(onchain: OnchainTokenMetadata): TokenMetadata | null {
  const meta: TokenMetadata = {};
  if (onchain.name) meta.name = onchain.name;
  if (onchain.symbol) meta.symbol = onchain.symbol;
  return Object.keys(meta).length ? meta : null;
}

/** Fetches a mint's logo (once per session) so each logo appears as soon as it loads. */
function resolveImage(mint: string) {
  const state = imageState.get(mint);
  if (!state || imageAttempted.has(mint)) return;
  imageAttempted.add(mint);
  fetchOffchainImage(state.uri)
    .then(image => {
      if (image) {
        const data: TokenMetadata = { ...snapshot[mint], image };
        publish({ [mint]: data });
        queuePersist(mint, { data, uri: state.uri, imgTries: state.tries });
      } else {
        queuePersist(mint, { data: snapshot[mint] ?? null, uri: state.uri, imgTries: state.tries + 1 });
      }
    })
    .catch(() => {});
}

// ── lookup ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetryable(mint: string): boolean {
  const failed = failedAt.get(mint);
  return failed !== undefined && Date.now() - failed >= RETRY_COOLDOWN_MS;
}

/** After a failed lookup, try again later (a few rounds) without needing a page reload. */
function scheduleAutoRetry() {
  if (retryTimer || retryRounds >= MAX_AUTO_RETRY_ROUNDS) return;
  retryRounds++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (latestConnection) requestTokenMetadata(latestConnection, [...failedAt.keys()]);
  }, RETRY_COOLDOWN_MS + 50);
}

async function flush() {
  flushTimer = null;
  const connection = latestConnection;
  const mints = [...queued];
  queued.clear();
  if (!connection || mints.length === 0) return;
  mints.forEach(m => inFlight.add(m));

  try {
    const keys = mints.map(m => new PublicKey(m));
    let onchain: Map<string, OnchainTokenMetadata> | null = null;
    // One quick retry absorbs a transient RPC blip before we give up on this batch.
    for (let attempt = 0; attempt < 2 && !onchain; attempt++) {
      try {
        onchain = await fetchOnchainMetadata(connection, keys);
      } catch {
        if (attempt === 0) await sleep(QUICK_RETRY_DELAY_MS);
      }
    }

    if (!onchain) {
      // Still failing: show defaults for now, but keep these mints retryable.
      const now = Date.now();
      mints.forEach(m => failedAt.set(m, now));
      publish(Object.fromEntries(mints.map(m => [m, null])));
      scheduleAutoRetry();
      return;
    }

    retryRounds = 0;
    const updates: Record<string, TokenMetadata | null> = {};
    for (const mint of mints) {
      const meta = onchain.get(mint);
      updates[mint] = meta ? toTokenMetadata(meta) : null;
      failedAt.delete(mint);
      if (meta?.uri) imageState.set(mint, { uri: meta.uri, tries: 0 });
    }
    publish(updates);
    for (const mint of mints) {
      // The logo, if any, is queued for saving once it resolves (see `resolveImage`).
      queuePersist(mint, { data: updates[mint], uri: imageState.get(mint)?.uri, imgTries: 0 });
      resolveImage(mint);
    }
  } finally {
    mints.forEach(m => inFlight.delete(m));
  }
}

function isValidMint(mint: string): boolean {
  try {
    new PublicKey(mint);
    return true;
  } catch {
    return false;
  }
}

/** Queues mints for lookup. Already resolved, queued or in-flight mints are skipped. */
export function requestTokenMetadata(
  connection: Connection,
  mints: Iterable<string | null | undefined>,
) {
  latestConnection = connection;
  const invalid: Record<string, null> = {};
  for (const mint of mints) {
    if (!mint) continue;
    if (mint in snapshot && !isRetryable(mint)) {
      // Already resolved. If it was cached without a logo, try fetching the logo again.
      resolveImage(mint);
      continue;
    }
    if (inFlight.has(mint) || queued.has(mint)) continue;
    if (!isValidMint(mint)) {
      // Nothing to look up - mark resolved so UIs don't wait on it forever.
      invalid[mint] = null;
      continue;
    }
    queued.add(mint);
  }
  if (Object.keys(invalid).length > 0) publish(invalid);
  if (queued.size > 0 && !flushTimer) {
    flushTimer = setTimeout(flush, BATCH_WINDOW_MS);
  }
}

/**
 * Resolves once the mint's lookup has genuinely finished (metadata found or confirmed
 * absent). A failed lookup keeps waiting for the automatic retry. Never rejects; gives
 * up after `timeoutMs` so callers can't hang.
 */
export function waitForTokenMetadata(
  connection: Connection,
  mint: string,
  timeoutMs = 15000,
): Promise<void> {
  requestTokenMetadata(connection, [mint]);
  const isSettled = () => mint in snapshot && !failedAt.has(mint);
  return new Promise(resolve => {
    if (isSettled()) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = subscribeTokenMetadata(() => {
      if (isSettled()) finish();
    });
  });
}

export function subscribeTokenMetadata(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTokenMetadataSnapshot(): TokenMetadataRecord {
  return snapshot;
}

/**
 * Non-reactive read for event handlers / async callbacks.
 * In render, use the `useTokenMetadata` hook instead so components update.
 */
export function getCachedTokenMetadata(mint: string | null | undefined): TokenMetadata | null | undefined {
  return mint ? snapshot[mint] : undefined;
}
