// src/modules/trading/tradingCycle.ts
// Trading cycle — checks all OPEN positions against CLOB prices.
// Runs every 15-30 seconds; closes positions that reached target or timed out.

import cron from 'node-cron';
import axios from 'axios';
import { pool } from '../../db/pool';
import { VirtualTrade } from '../../types';

const CLOB_API_BASE = 'https://clob.polymarket.com';

async function getCurrentMidPrice(tokenId: string): Promise<number> {
  const response = await axios.get<{ mid: number }>(`${CLOB_API_BASE}/midpoint`, {
    params: { token_id: tokenId },
    timeout: 8_000,
  });
  return response.data.mid;
}

async function checkOpenPositions(): Promise<void> {
  const { rows } = await pool.query<VirtualTrade>(
    `SELECT * FROM virtual_trades WHERE status = 'OPEN'`,
  );

  if (rows.length === 0) return;

  console.log(`[TradingCycle] Checking ${rows.length} open position(s)…`);

  await Promise.allSettled(
    rows.map(async (trade) => {
      try {
        const tokenId = trade.market_url.split('/').at(-1) ?? trade.market_url;
        const currentPrice = await getCurrentMidPrice(tokenId);

        if (trade.target_price !== null && currentPrice >= trade.target_price) {
          // Target reached — close with PnL
          const pnl =
            trade.entry_volume_usdc !== null
              ? (currentPrice - (trade.entry_price ?? 0)) /
                (trade.entry_price ?? 1) *
                trade.entry_volume_usdc
              : 0;

          await pool.query(
            `UPDATE virtual_trades
             SET status = 'CLOSED_EDGE', exit_price = $1, pnl_usdc = $2, exit_time = NOW()
             WHERE id = $3`,
            [currentPrice, pnl, trade.id],
          );

          console.log(
            `[TradingCycle] CLOSED_EDGE — task_id: ${trade.task_id} | exit: ${currentPrice} | PnL: ${pnl.toFixed(2)} USDC`,
          );
        }
        // Market timeout is handled separately by the cleanup cron (CLOSED_TIMEOUT)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await pool.query(
          `UPDATE virtual_trades SET status = 'ERROR', error_reason = $1 WHERE id = $2`,
          [reason, trade.id],
        );
        console.error(`[TradingCycle] ERROR for task_id ${trade.task_id}:`, reason);
      }
    }),
  );
}

export function startTradingCycle(): void {
  // Every 20 seconds
  cron.schedule('*/20 * * * * *', async () => {
    try {
      await checkOpenPositions();
    } catch (err) {
      console.error('[TradingCycle] Unexpected error:', err);
    }
  });
  console.log('[TradingCycle] Started (every 20s).');
}
