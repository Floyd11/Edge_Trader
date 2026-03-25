// src/modules/trading/exit_manager.ts
import cron from 'node-cron';
import axios from 'axios';
import { pool } from '../../db/pool';
import { VirtualTrade } from '../../types';
import { reportTrade } from '../reporting/sheetsReporter';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLevel(level: [string, string] | { price: string; size: string } | unknown): { price: number; size: number } {
  if (Array.isArray(level)) {
    return {
      price: parseFloat(String(level[0])),
      size: parseFloat(String(level[1])),
    };
  }
  const l = level as { price: string; size: string };
  return {
    price: parseFloat(String(l.price)),
    size: parseFloat(String(l.size)),
  };
}

async function checkExits() {
  try {
    const { rows } = await pool.query<VirtualTrade>(
      `SELECT * FROM virtual_trades WHERE status = 'OPEN'`
    );

    if (rows.length === 0) return;

    for (const trade of rows) {
      // Small delay between requests to avoid spamming the CLOB API
      await delay(100);

      try {
        // Extract token_id from the market URL (last segment)
        const tokenId = trade.market_url.split('/').at(-1) ?? trade.market_url;

        const response = await axios.get(
          `https://clob.polymarket.com/book?token_id=${tokenId}`,
          { timeout: 8000 }
        );

        const { bids } = response.data;

        // If no bids (no buyers), we can't exit
        if (!bids || bids.length === 0) {
          continue;
        }

        const bestBid = parseLevel(bids[0]).price;

        let exitPrice: number | null = null;
        let exitReason: 'Take-Profit' | 'Stop-Loss' | null = null;

        // 3. Trigger Logic
        if (trade.side === 'YES') {
          // Take-Profit for YES: when price rises to/above target
          if (trade.target_price !== null && bestBid >= trade.target_price) {
            exitPrice = trade.target_price;
            exitReason = 'Take-Profit';
          }
          // Stop-Loss for YES: when price drops to/below stop loss
          else if (trade.stop_loss_price !== null && bestBid <= trade.stop_loss_price) {
            exitPrice = bestBid;
            exitReason = 'Stop-Loss';
          }
        } else if (trade.side === 'NO') {
          // Take-Profit for NO: when YES price drops to/below target
          if (trade.target_price !== null && bestBid <= trade.target_price) {
            exitPrice = trade.target_price;
            exitReason = 'Take-Profit';
          }
          // Stop-Loss for NO: when YES price rises to/above stop loss
          else if (trade.stop_loss_price !== null && bestBid >= trade.stop_loss_price) {
            exitPrice = bestBid;
            exitReason = 'Stop-Loss';
          }
        }

        // If either TP or SL hit
        if (exitPrice !== null && exitReason !== null) {
          // 4. Mathematics PnL (including Shadow Accounting)
          let pnlUsdc = 0;
          let kellyPnlUsdc = 0;

          const entryPrice = trade.entry_price ?? 0;
          const entryVolume = trade.entry_volume_usdc ?? 0;
          const kellyEntryPrice = trade.kelly_entry_price ?? 0;
          const kellyVolume = trade.kelly_sim_volume_usdc ?? 0;

          if (entryPrice > 0) {
            if (trade.side === 'YES') {
              const sharesHeld = entryVolume / entryPrice;
              pnlUsdc = sharesHeld * exitPrice - entryVolume;

              if (kellyEntryPrice > 0) {
                const kellySharesHeld = kellyVolume / kellyEntryPrice;
                kellyPnlUsdc = kellySharesHeld * exitPrice - kellyVolume;
              }
            } else if (trade.side === 'NO') {
              // NO Share price is 1 - YES price
              const noEntryPrice = 1 - entryPrice;
              const noExitPrice = 1 - exitPrice;
              
              const sharesHeld = entryVolume / noEntryPrice;
              pnlUsdc = sharesHeld * noExitPrice - entryVolume;

              if (kellyEntryPrice > 0) {
                const kellyNOEntryPrice = 1 - kellyEntryPrice;
                const kellySharesHeld = kellyVolume / kellyNOEntryPrice;
                kellyPnlUsdc = kellySharesHeld * noExitPrice - kellyVolume;
              }
            }
          }

          // 5. Update DB
          await pool.query(
            `UPDATE virtual_trades 
             SET status = 'CLOSED_EDGE', 
                 exit_price = $1, 
                 pnl_usdc = $2, 
                 kelly_sim_pnl_usdc = $3, 
                 exit_time = NOW() 
             WHERE id = $4`,
            [exitPrice, pnlUsdc, kellyPnlUsdc, trade.id]
          );

          // console log according to spec
          const shortId = trade.id.split('-')[0];
          const sign = pnlUsdc >= 0 ? '+' : '';
          console.log(
            `[ExitManager] Сделка [${shortId}] закрыта по ${exitReason}. PnL: ${sign}${pnlUsdc.toFixed(2)} USDC`
          );

          // 6. Update the trade object and append to Google Sheets
          trade.status = 'CLOSED_EDGE';
          trade.exit_price = exitPrice;
          trade.pnl_usdc = pnlUsdc;
          trade.kelly_sim_pnl_usdc = kellyPnlUsdc;
          trade.exit_time = new Date();
          await reportTrade(trade);
        }
      } catch (tradeErr) {
        console.error(
          `[ExitManager] Error processing trade ${trade.id}:`,
          tradeErr instanceof Error ? tradeErr.message : String(tradeErr)
        );
      }
    }
  } catch (err) {
    console.error(
      `[ExitManager] Global Query error:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function startExitManager() {
  cron.schedule('*/2 * * * *', () => {
    checkExits();
  });
  console.log('[ExitManager] Scheduled every 2 minutes.');
}
