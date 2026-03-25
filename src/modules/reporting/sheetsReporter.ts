import { VirtualTrade } from '../../types';
import { pool } from '../../db/pool';
import { appendTradeToSheet, appendValues } from './google_sheets';

/**
 * Appends a closed/error trade row to the configured Google Sheet.
 */
export async function reportTrade(trade: VirtualTrade): Promise<void> {
  // We report trades that are in a terminal state: CLOSED_EDGE, CLOSED_TIMEOUT, or ERROR
  await appendTradeToSheet(trade);
}

/**
 * Sends a daily PnL digest to the sheet.
 */
export async function reportDailyDigest(): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'CLOSED_EDGE' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as errors,
        COALESCE(SUM(pnl_usdc), 0) as net_pnl
      FROM virtual_trades
      WHERE exit_time >= NOW() - INTERVAL '1 day'
    `);

    const { total, closed, errors, net_pnl } = result.rows[0];

    const rowData = [
      new Date().toISOString().split('T')[0], // YYYY-MM-DD
      Number(net_pnl).toFixed(2),
      Number(closed || 0),
      Number(errors || 0),
      Number(total || 0)
    ];

    // Attempt to append to a DailyStats sheet. 
    // If it doesn't exist, it will fail but we catch the error to prevent crash.
    await appendValues('DailyStats!A:E', [rowData]);
    console.log(`[Reporting] Daily digest sent: ${net_pnl} USDC profit across ${total} total events.`);
  } catch (error) {
    console.error('[Reporting] Failed to send daily digest:', error instanceof Error ? error.message : String(error));
  }
}
