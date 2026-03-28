// src/modules/discovery/scanner.ts
import axios from 'axios';
import cron from 'node-cron';
import { pool } from '../../db/pool';
import { env } from '../../config/env';

// 1. Constants & Filters
const EXCLUDED_CATEGORIES = new Set([
  'Crypto',
  'Sports',
  'Weather',
  'Mentions',
  'Other / General',
]);
const MAX_SPREAD = 0.10;
const MIN_SIZE_SHARES = 50;
const SCAN_WINDOW_MIN_MINUTES = 10;
const SCAN_WINDOW_MAX_MINUTES = 60;
const MIN_TOTAL_VOLUME_USDC = 50;

// Internal type for Gamma Market response (simplified)
// Note: Gamma API uses camelCase field names
interface GammaMarket {
  id: string;
  conditionId: string;    // camelCase — API changed from condition_id
  slug: string;
  question: string;
  createdAt?: string;     // ISO 8601 timestamp — used to filter only new markets
  url?: string;           // may be absent; we build URL from slug
  category?: string;
  active: boolean;
  closed: boolean;
  clobTokenIds?: string;  // JSON string array of token IDs
  volumeNum?: number;     // Total volume in USDC
}

interface AnalyzeBotResponse {
  task_id: string;
}

/**
 * Parses a price or size from either an array format like `["0.5", "100"]` 
 * (Binance style) or standard object format `{ price: "0.5", size: "100" }` (Polymarket CLOB style).
 */
function parseLevel(level: [string, string] | { price: string; size: string } | unknown): { price: number; size: number } {
  if (Array.isArray(level)) {
    return {
      price: parseFloat(String(level[0])),
      size: parseFloat(String(level[1])),
    };
  }
  const l = level as { price: string; size: string };
  return {
    price: parseFloat(String(l.price)),
    size: parseFloat(String(l.size)),
  };
}

/**
 * 2. Pre-check function: isMarketLiquid
 * Fetches order book from CLOB by token_id and ensures spread and liquidity are healthy.
 * NOTE: CLOB API accepts token_id (numeric string), NOT condition_id (0x-prefixed hash).
 */
export async function isMarketLiquid(tokenId: string): Promise<boolean> {
  try {
    const response = await axios.get(`https://clob.polymarket.com/book`, {
      params: { token_id: tokenId },
      timeout: 5000,
    });
    
    const { bids, asks } = response.data;

    if (!bids || !asks || bids.length === 0 || asks.length === 0) {
      return false; // Empty book
    }

    const bestBidData = parseLevel(bids[0]);
    const bestAskData = parseLevel(asks[0]);

    const bestBid = bestBidData.price;
    const bestAsk = bestAskData.price;
    const bestBidSize = bestBidData.size;
    const bestAskSize = bestAskData.size;

    // For YES bids: bids are sorted descending (highest first)
    // For YES asks: sorted ascending (lowest first). Spread = lowest ask - highest bid.
    const spread = Math.abs(bestAsk - bestBid);

    // Spread limit check
    if (spread > MAX_SPREAD) {
      console.log(`[Scout] token_id ${tokenId.slice(0, 12)}…: Spread too wide (${spread.toFixed(3)})`);
      return false;
    }

    // Minimum size check (needs >= MIN_SIZE_SHARES on at least ONE side of the spread)
    if (bestBidSize < MIN_SIZE_SHARES && bestAskSize < MIN_SIZE_SHARES) {
      console.log(`[Scout] token_id ${tokenId.slice(0, 12)}…: Low liquidity (Bid: ${bestBidSize}, Ask: ${bestAskSize})`);
      return false;
    }

    return true; // Healthy
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[Scout] Error checking liquidity for token_id ${tokenId.slice(0, 12)}…:`, reason);
    return false;
  }
}

/**
 * 3. Main Scanner Loop
 */
export async function scanNewMarkets() {
  console.log('[Scout] Starting Gamma API market discovery scan...');

  try {
    // Phase 1: Fetch — request only the newest markets, sorted by creation time descending.
    // 'order=createdAt&ascending=false' is supported by the Gamma API (unlike deprecated 'order=newest').
    const response = await axios.get<GammaMarket[]>(
      'https://gamma-api.polymarket.com/markets',
      {
        params: {
          active: true,
          closed: false,
          order: 'createdAt',
          ascending: false,
          limit: 50, // 50 is more than enough to cover SCAN_WINDOW_MINUTES of new markets
        },
        timeout: 10_000,
      }
    );

    const now = Date.now();
    const minCutoff = new Date(now - SCAN_WINDOW_MIN_MINUTES * 60 * 1000);
    const maxCutoff = new Date(now - SCAN_WINDOW_MAX_MINUTES * 60 * 1000);

    // Client-side filter: only process markets created between 10 and 40 minutes ago.
    const markets = response.data.filter((m) => {
      if (!m.createdAt) return false;
      const created = new Date(m.createdAt);
      return created <= minCutoff && created >= maxCutoff;
    });

    console.log(`[Scout] Fetched up to 50 newest markets. ${markets.length} passed the ${SCAN_WINDOW_MIN_MINUTES}-${SCAN_WINDOW_MAX_MINUTES}m age window.`);

    // Phase 2 & 3: Filter & Check
    for (const market of markets) {
      // Skip if no conditionId (malformed entry)
      if (!market.conditionId) continue;

      // Check category
      if (market.category && EXCLUDED_CATEGORIES.has(market.category)) {
        continue;
      }

      // Check total volume (total_volume > $200)
      const volume = market.volumeNum || 0;
      if (volume < MIN_TOTAL_VOLUME_USDC) {
        console.log(`[Scout] token_id ${market.conditionId.slice(0, 12)}…: Low total volume ($${volume.toFixed(0)})`);
        continue;
      }

      // Extract the first CLOB token ID (clobTokenIds is a JSON string like '["123...", "456..."]')
      // CLOB API requires token_id, not condition_id
      let firstTokenId: string | undefined;
      try {
        if (market.clobTokenIds) {
          const tokens: string[] = JSON.parse(market.clobTokenIds);
          firstTokenId = tokens[0];
        }
      } catch {
        // Malformed clobTokenIds — skip this market
      }

      if (!firstTokenId) {
        // No token available for CLOB check, skip
        continue;
      }

      // Check liquidity via the YES token
      const isLiquid = await isMarketLiquid(firstTokenId);
      if (!isLiquid) {
        // Logging was already done inside isMarketLiquid
        continue;
      }

      // Build market URL — use API-provided url or fall back to slug
      const marketUrl = market.url || `https://polymarket.com/event/${market.slug}`;

      // 4. Deduplication: skip markets already tracked in a non-terminal state.
      //    We only re-dispatch if the previous attempt fully ERRORed (D&B timeout etc.).
      //    PENDING = waiting for D&B callback, OPEN = trade active → both must be skipped.
      //    CLOSED_EDGE / CLOSED_TIMEOUT / ERROR = terminal → allowed to re-analyse.
      try {
        const existing = await pool.query<{ status: string }>(
          `SELECT status FROM virtual_trades
           WHERE market_url = $1
             AND status IN ('PENDING', 'OPEN')
           LIMIT 1`,
          [marketUrl],
        );

        if ((existing.rowCount ?? 0) > 0) {
          // Already being processed — nothing to do
          console.log(`[Scout] Market ${market.conditionId} already PENDING/OPEN, skipping.`);
          continue;
        }
      } catch (dbErr) {
        // If DB check fails, skip this market to be safe
        console.error(`[Scout] DB dedup check failed for ${market.conditionId}:`, dbErr instanceof Error ? dbErr.message : String(dbErr));
        continue;
      }

      console.log(`[Scout] Market ${market.conditionId} passed all checks. Dispatching to D&B...`);

      // 5. Send to D&B API and record in DB
      try {
        const analyzeRes = await axios.post<AnalyzeBotResponse>(
          `${env.DEBUNK_API_URL}/api/v1/analyze-bot`,
          {
            url: marketUrl,
            webhook_url: env.BOT_WEBHOOK_URL,
          },
          {
            headers: { 'X-API-Key': env.DEBUNK_API_KEY },
            timeout: 15_000,
          },
        );

        const taskId = analyzeRes.data.task_id;

        await pool.query(
          `INSERT INTO virtual_trades (task_id, market_url, category, status)
           VALUES ($1, $2, $3, 'PENDING')
           ON CONFLICT (task_id) DO NOTHING`,
          [taskId, marketUrl, market.category || null],
        );

        console.log(`[Scout] Dispatched → task_id: ${taskId}`);
      } catch (postError) {
        console.error(`[Scout] Failed to dispatch market ${market.conditionId} to D&B API:`, postError instanceof Error ? postError.message : String(postError));
      }
    }
  } catch (err) {
    console.error('[Scout] Failed to fetch data from Gamma API:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * 5. Startup Hook
 * Can be imported and called in src/index.ts
 */
export function startScanner() {
  const interval = env.DISCOVERY_INTERVAL_MINUTES || 5;
  // Run once on startup
  scanNewMarkets();
  cron.schedule(`*/${interval} * * * *`, () => {
    scanNewMarkets();
  });
  console.log(`[Scout] Scanner initialized, strict pre-check active (every ${interval}m).`);
}
