// src/modules/reporting/sheetsReporter.ts
// Module 6 — Google Sheets Reporting (stub)
// TODO: Implement service account auth + googleapis client + appendSheetRow()
// See knowledge_base.txt §6 for full field spec.

import { VirtualTrade } from '../../types';

/**
 * Appends a closed/error trade row to the configured Google Sheet.
 * Currently a no-op stub — implement after googleapis setup.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function reportTrade(_trade: VirtualTrade): Promise<void> {
  // TODO: implement via @google-cloud/googleapis npm package
  // Fields to log on CLOSED_EDGE / CLOSED_TIMEOUT:
  //   task_id, market_url, side, entry_price, exit_price, pnl_usdc, entry_time, exit_time
  // Fields to log on ERROR:
  //   task_id, market_url, error_reason, created_at
}

/**
 * Sends a daily PnL digest to the sheet.
 * Currently a no-op stub.
 */
export async function reportDailyDigest(): Promise<void> {
  // TODO: query DB for daily aggregates and push to sheet
}
