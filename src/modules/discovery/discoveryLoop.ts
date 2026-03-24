// src/modules/discovery/discoveryLoop.ts
// Module 1 — Discovery Loop (cron trigger)
// Scans Gamma API on a schedule and enqueues qualifying markets for D&B analysis.

import cron from 'node-cron';
import { fetchOpenMarkets } from './gammaClient';
import { submitMarketForAnalysis } from '../bridge/debunkClient';
import { env } from '../../config/env';

/**
 * Converts interval in minutes to a valid cron expression.
 * Falls back to every 5 minutes if interval < 1.
 */
function buildCronExpression(intervalMinutes: number): string {
  const safe = Math.max(1, Math.floor(intervalMinutes));
  return `*/${safe} * * * *`;
}

export function startDiscoveryLoop(): void {
  const expression = buildCronExpression(env.DISCOVERY_INTERVAL_MINUTES);
  console.log(`[Discovery] Starting loop — cron: "${expression}"`);

  cron.schedule(expression, async () => {
    console.log('[Discovery] Scanning Gamma API for open markets…');
    try {
      const markets = await fetchOpenMarkets();
      console.log(`[Discovery] Found ${markets.length} qualifying market(s).`);

      // Submit each market independently; don't let one failure block others
      await Promise.allSettled(
        markets.map((market) => submitMarketForAnalysis(market.url, market.category)),
      );
    } catch (err) {
      // Network or parse error — log but keep the cron running
      console.error('[Discovery] Error during market scan:', err);
    }
  });
}
