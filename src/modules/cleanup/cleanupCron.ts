// src/modules/cleanup/cleanupCron.ts
// Cron-based cleanup: marks PENDING trades as ERROR if webhook hasn't arrived
// within 1 hour of creation. Runs every 30 minutes as per spec.

import cron from 'node-cron';
import { pool } from '../../db/pool';

export function startCleanupCron(): void {
  cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await pool.query(`
        UPDATE virtual_trades
        SET status       = 'ERROR',
            error_reason = 'Webhook timeout: D&B did not respond within 1 hour'
        WHERE status = 'PENDING'
          AND created_at < NOW() - INTERVAL '1 hour'
        RETURNING id;
      `);

      if ((result.rowCount ?? 0) > 0) {
        console.log(`[Cleanup] Marked ${result.rowCount} stale PENDING trade(s) as ERROR.`);
      }
    } catch (err) {
      console.error('[Cleanup] Error during PENDING cleanup:', err);
    }
  });

  console.log('[Cleanup] Started (every 30 min).');
}
