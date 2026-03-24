// src/modules/execution/clobClient.ts
// Module 3 — Virtual Execution (CLOB API integration)
// Simulates walking the order book to compute a realistic entry price.

import axios from 'axios';
import { OrderBook, SimulatedEntry, TradeSide } from '../../types';

const CLOB_API_BASE = 'https://clob.polymarket.com';

// Max USDC to spend per virtual trade (safety cap)
const MAX_TRADE_USDC = 1_000;

/**
 * Fetches the current CLOB order book for a given market token.
 */
async function getOrderBook(tokenId: string): Promise<OrderBook> {
  const response = await axios.get<OrderBook>(`${CLOB_API_BASE}/book`, {
    params: { token_id: tokenId },
    timeout: 10_000,
  });
  return response.data;
}

/**
 * Simulates entering a position by walking the order book.
 * Uses kelly_fraction to determine USDC size, capped at MAX_TRADE_USDC.
 *
 * @param tokenId   CLOB token ID for the market
 * @param side      'YES' (buy asks) or 'NO' (buy asks on opposite side)
 * @param kellyFraction  Sizing suggestion from D&B (0–1)
 */
export async function simulateOrderBookEntry(
  tokenId: string,
  _side: TradeSide, // TODO: use to differentiate YES/NO book side when CLOB API supports it
  kellyFraction: number,
): Promise<SimulatedEntry> {
  const book = await getOrderBook(tokenId);

  // For YES we walk asks; for NO we also walk asks (NO shares are bought as asks)
  const levels = book.asks.sort((a, b) => a.price - b.price);

  if (levels.length === 0) {
    throw new Error(`[Execution] Empty order book for token ${tokenId}`);
  }

  const targetUsdc = Math.min(kellyFraction * MAX_TRADE_USDC, MAX_TRADE_USDC);
  let remaining = targetUsdc;
  let totalCost = 0;
  let totalShares = 0;

  for (const level of levels) {
    if (remaining <= 0) break;

    const levelCost = level.price * level.size;
    const spend = Math.min(remaining, levelCost);
    const shares = spend / level.price;

    totalCost += spend;
    totalShares += shares;
    remaining -= spend;
  }

  if (totalShares === 0) {
    throw new Error(`[Execution] Could not fill any shares for token ${tokenId}`);
  }

  // Volume-weighted average price (VWAP) as entry price
  const entryPrice = totalCost / totalShares;

  return { entryPrice, volume: totalCost };
}
