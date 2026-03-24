// src/modules/cleanup/cleanupCron.ts
// Cron-based cleanup: marks PENDING trades as ERROR if webhook hasn't arrived
// within 1 hour of creation. Runs every 30 minutes as per spec.

import cron from 'node-cron';
import { pool } from '../../db/pool';
import { reportTrade } from '../reporting/sheetsReporter';
import { VirtualTrade } from '../../types';

export function startCleanupCron(): void {
  cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await pool.query<VirtualTrade>(`
        UPDATE virtual_trades
        SET status       = 'ERROR',
            error_reason = 'Webhook timeout: D&B did not respond within 1 hour',
            exit_time    = NOW()
        WHERE status = 'PENDING'
          AND created_at < NOW() - INTERVAL '1 hour'
        RETURNING *;
      `);

      if ((result.rowCount ?? 0) > 0) {
        console.log(`[Cleanup] Marked ${result.rowCount} stale PENDING trade(s) as ERROR.`);
        for (const trade of result.rows) {
          await reportTrade(trade);
        }
      }
    } catch (err) {
      console.error('[Cleanup] Error during PENDING cleanup:', err);
    }
  });

  console.log('[Cleanup] Started (every 30 min).');
}
