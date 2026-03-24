import { VirtualTrade } from '../../types';
import { appendTradeToSheet } from './google_sheets';

/**
 * Appends a closed/error trade row to the configured Google Sheet.
 */
export async function reportTrade(trade: VirtualTrade): Promise<void> {
  // We report trades that are in a terminal state: CLOSED_EDGE, CLOSED_TIMEOUT, or ERROR
  await appendTradeToSheet(trade);
}

/**
 * Sends a daily PnL digest to the sheet.
 * Currently a no-op stub.
 */
export async function reportDailyDigest(): Promise<void> {
  // TODO: query DB for daily aggregates and push to sheet
}
