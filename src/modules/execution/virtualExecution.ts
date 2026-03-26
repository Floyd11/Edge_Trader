// src/modules/execution/virtualExecution.ts
// Module 3 — Virtual Execution handler
// Called by the webhook route when recommended_bet === 'BET'.

import { TradeSignal } from '../../types';
import { pool } from '../../db/pool';
import { env } from '../../config/env';
import { simulateOrderBookEntry } from './clobClient';

/**
 * Processes a BET signal:
 *  1. Simulates order-book entry to get entryPrice and volume
 *  2. Computes target_price from TARGET_PROFIT_MULT
 *  3. Updates the virtual_trades row to OPEN with all signal fields
 *
 * On any error, marks the row as ERROR with the error message.
 */
export async function handleBetSignal(signal: TradeSignal): Promise<void> {
  try {
    // Extract CLOB token ID from the market URL (last segment)
    // e.g. https://polymarket.com/event/some-event/token-id
    const tokenId = signal.market_url.split('/').at(-1) ?? signal.market_url;

    const { entryPrice, volume } = await simulateOrderBookEntry(
      tokenId,
      signal.trade_direction,
      signal.kelly_fraction,
    );

    const targetSlippage = env.PROFIT_SLIPPAGE;
    const slSlippage = env.STOP_LOSS_SLIPPAGE;

    let targetPrice: number;
    let stopLossPrice: number;

    if (signal.trade_direction === 'YES') {
      targetPrice = signal.ai_prob_yes - targetSlippage;
      // Clamp SL to minimum 0.01 — price cannot go below 0 on Polymarket
      stopLossPrice = Math.max(0.01, entryPrice - slSlippage);
    } else {
      // If we bet NO, our target is (AI YES Probability) + Slippage
      targetPrice = signal.ai_prob_yes + targetSlippage;
      // Clamp SL to maximum 0.99 — YES price cannot exceed 1
      stopLossPrice = Math.min(0.99, entryPrice + slSlippage);
    }

    await pool.query(
      `UPDATE virtual_trades
       SET status            = 'OPEN',
           side              = $1,
           entry_price       = $2,
           entry_volume_usdc = $3,
           target_price      = $4,
           stop_loss_price   = $5,
           entry_time        = NOW(),
           debunk_verdict    = $6,
           edge              = $7,
           kelly_fraction    = $8,
           confidence        = $9,
           prior_n           = $10,
           confidence_mult   = $11
       WHERE task_id = $12`,
      [
        signal.trade_direction,
        entryPrice,
        volume,
        targetPrice,
        stopLossPrice,
        signal.ai_prob_yes,
        signal.edge,
        signal.kelly_fraction,
        signal.confidence,
        signal.prior_n,
        signal.confidence_mult,
        signal.task_id,
      ],
    );

    console.log(
      `[Execution] Trade OPEN — task_id: ${signal.task_id} | side: ${signal.trade_direction} | ` +
      `entry: ${entryPrice.toFixed(4)} | TP: ${targetPrice.toFixed(4)} | SL: ${stopLossPrice.toFixed(4)} | volume: ${volume.toFixed(2)} USDC`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE virtual_trades SET status = 'ERROR', error_reason = $1 WHERE task_id = $2`,
      [reason, signal.task_id],
    );
    // Re-throw so the webhook handler can log the failure context
    throw err;
  }
}
