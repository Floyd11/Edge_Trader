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
const MAX_SPREAD = 0.05;
const MIN_SIZE_SHARES = 50;

// Internal type for Gamma Market response (simplified)
interface GammaMarket {
  id: string;
  condition_id: string;
  question: string;
  url: string;
  category: string;
  active: boolean;
  closed: boolean;
  // Some endpoints return 'yes' / 'no' answers, or standard binary flags.
  // We assume binary markets for the scope of this bot.
}

interface AnalyzeBotResponse {
  task_id: string;
}

/**
 * Parses a price or size from either an array format like `["0.5", "100"]` 
 * (Binance style) or standard object format `{ price: "0.5", size: "100" }` (Polymarket CLOB style).
 */
function parseLevel(level: any): { price: number; size: number } {
  if (Array.isArray(level)) {
    return {
      price: parseFloat(level[0]),
      size: parseFloat(level[1]),
    };
  }
  return {
    price: parseFloat(level.price),
    size: parseFloat(level.size),
  };
}

/**
 * 2. Pre-check function: isMarketLiquid
 * Fetches order book from CLOB and ensures spread and liquidity are healthy.
 */
export async function isMarketLiquid(conditionId: string): Promise<boolean> {
  try {
    const response = await axios.get(`https://clob.polymarket.com/book?condition_id=${conditionId}`, {
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

    const spread = bestAsk - bestBid;

    // Spread limit check
    if (spread > MAX_SPREAD) {
      console.log(`[Scout] condition_id ${conditionId}: Spread too wide (${spread.toFixed(3)})`);
      return false;
    }

    // Minimum size check (needs >= MIN_SIZE_SHARES on at least ONE side of the spread)
    if (bestBidSize < MIN_SIZE_SHARES && bestAskSize < MIN_SIZE_SHARES) {
      console.log(`[Scout] condition_id ${conditionId}: Low liquidity (Bid: ${bestBidSize}, Ask: ${bestAskSize})`);
      return false;
    }

    return true; // Healthy
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[Scout] Error checking liquidity for condition_id ${conditionId}:`, reason);
    return false;
  }
}

/**
 * 3. Main Scanner Loop
 */
export async function scanNewMarkets() {
  console.log('[Scout] Starting Gamma API market discovery scan...');

  try {
    // Phase 1: Fetch
    const response = await axios.get<GammaMarket[]>(
      'https://gamma-api.polymarket.com/markets', // Or /events depending on exact Gamma schema, /markets is universally flat
      {
        params: {
          active: true,
          closed: false,
          order: 'newest',
          limit: 50,
        },
        timeout: 10_000,
      }
    );

    const markets = response.data;

    // Phase 2 & 3: Filter & Check
    for (const market of markets) {
      // Check category
      if (market.category && EXCLUDED_CATEGORIES.has(market.category)) {
        continue;
      }

      // Check liquidity
      const isLiquid = await isMarketLiquid(market.condition_id);
      if (!isLiquid) {
        // Logging was already done inside isMarketLiquid or skipped intentionally
        continue;
      }

      console.log(`[Scout] Market ${market.condition_id} passed liquidity checks. Dispatching to D&B...`);

      // 4. Send to D&B API and DB
      try {
        const analyzeRes = await axios.post<AnalyzeBotResponse>(
          `${env.DEBUNK_API_URL}/api/v1/analyze-bot`,
          {
            url: market.url,
            webhook_url: env.BOT_WEBHOOK_URL,
          },
          {
            headers: { 'X-API-Key': env.DEBUNK_API_KEY },
            timeout: 15_000,
          }
        );

        const taskId = analyzeRes.data.task_id;

        await pool.query(
          `INSERT INTO virtual_trades (task_id, market_url, category, status) 
           VALUES ($1, $2, $3, 'PENDING') 
           ON CONFLICT (task_id) DO NOTHING`,
          [taskId, market.url, market.category || null]
        );

        console.log(`[Scout] Successfully dispatched market. task_id: ${taskId}`);
      } catch (postError) {
        console.error(`[Scout] Failed to dispatch market ${market.condition_id} to D&B API:`, postError instanceof Error ? postError.message : String(postError));
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
  cron.schedule(`*/${interval} * * * *`, () => {
    scanNewMarkets();
  });
  console.log(`[Scout] Scanner initialized, strict pre-check active (every ${interval}m).`);
}
