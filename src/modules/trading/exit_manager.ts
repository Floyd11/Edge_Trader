// src/modules/trading/exit_manager.ts
import cron from 'node-cron';
import axios from 'axios';
import { pool } from '../../db/pool';
import { VirtualTrade } from '../../types';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLevel(level: any): { price: number; size: number } {
  if (Array.isArray(level)) {
    return {
      price: parseFloat(level[0]),
      size: parseFloat(level[1]),
    };
  }
  return {
    price: parseFloat(level.price),
    size: parseFloat(level.size),
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
        // Take-Profit: Limit Maker exit
        if (trade.target_price !== null && bestBid >= trade.target_price) {
          exitPrice = trade.target_price;
          exitReason = 'Take-Profit';
        }
        // Stop-Loss: Market Taker exit
        else if (trade.stop_loss_price !== null && bestBid <= trade.stop_loss_price) {
          exitPrice = bestBid;
          exitReason = 'Stop-Loss';
        }

        // If either TP or SL hit
        if (exitPrice !== null && exitReason !== null) {
          // 4. Mathematics PnL (including Shadow Accounting)
          let pnlUsdc = 0;
          let kellyPnlUsdc = 0;

          const entryPrice = trade.entry_price ?? 0;
          const entryVolume = trade.entry_volume_usdc ?? 0;

          // Main PnL
          if (entryPrice > 0) {
            const sharesHeld = entryVolume / entryPrice;
            pnlUsdc = sharesHeld * exitPrice - entryVolume;
          }

          // Shadow Kelly PnL
          const kellyEntryPrice = trade.kelly_entry_price ?? 0;
          const kellyVolume = trade.kelly_sim_volume_usdc ?? 0;

          if (kellyEntryPrice > 0) {
            const kellySharesHeld = kellyVolume / kellyEntryPrice;
            kellyPnlUsdc = kellySharesHeld * exitPrice - kellyVolume;
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
