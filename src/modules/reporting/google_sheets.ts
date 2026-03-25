import fs from 'fs';
import { google, sheets_v4 } from 'googleapis';
import { env } from '../../config/env';
import { VirtualTrade } from '../../types';

// Singleton for API client instances
let sheetsClient: sheets_v4.Sheets | null = null;
let isInitialized = false;

/**
 * Initializes and returns the Google Sheets API client.
 * Utilizes singleton pattern to avoid redundant authentications.
 */
async function getSheetsClient(): Promise<sheets_v4.Sheets | null> {
  if (isInitialized) {
    return sheetsClient;
  }

  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY || !env.GOOGLE_SHEET_ID) {
    console.warn('[GoogleSheets] Missing GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SHEET_ID in env. Reporting is disabled.');
    isInitialized = true; // Prevents spamming this warning
    return null;
  }

  try {
    let credentials;
    const key = env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
    
    if (key.startsWith('{')) {
      credentials = JSON.parse(key);
    } else {
      credentials = JSON.parse(fs.readFileSync(key, 'utf8'));
    }
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    isInitialized = true;
    return sheetsClient;
  } catch (error) {
    console.error(
      '[GoogleSheets] Failed to initialize GoogleAuth. Check JSON key or file path:',
      error instanceof Error ? error.message : String(error)
    );
    isInitialized = true; // Don't crash, just disable plugin
    return null;
  }
}

/**
 * Formats a Date object as 'YYYY-MM-DD HH:mm'.
 */
function formatDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/**
 * Executes a function with exponential backoff on failure (mainly for Google API limits).
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(`[GoogleSheets] Request failed, retrying in ${delay.toFixed(0)}ms... (Attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(res => setTimeout(res, delay));
      attempt++;
    }
  }
  throw new Error('Maximum retries exceeded');
}

/**
 * Appends a closed trade to to the configured Google Sheet.
 * Assumes the sheet is named based on GOOGLE_SHEET_NAME env var.
 *
 * Expected sheet columns:
 * 1: Date | 2: Task ID | 3: Market URL | 4: Category | 5: Side | 6: AI Prob | 
 * 7: Edge | 8: Entry Price | 9: Exit Price | 10: Max PnL (USDC) | 11: Kelly PnL (USDC) | 12: Status
 */
export async function appendTradeToSheet(trade: VirtualTrade): Promise<void> {
  try {
    const sheets = await getSheetsClient();
    if (!sheets || !env.GOOGLE_SHEET_ID) {
      return; // Disabled or initialization failed
    }

    const rowData = [
      formatDate(trade.exit_time || new Date()), // Date
      trade.task_id,                             // Task ID
      trade.market_url,                          // Market URL
      trade.category || '',                      // Category
      trade.side || '',                          // Side
      trade.debunk_verdict ?? '',                // AI Prob
      trade.edge ?? '',                          // Edge
      trade.entry_price ?? '',                   // Entry Price
      trade.exit_price ?? '',                    // Exit Price
      trade.pnl_usdc ?? '',                      // Max PnL (USDC)
      trade.kelly_sim_pnl_usdc ?? '',            // Kelly PnL (USDC)
      trade.status                               // Status
    ];

    const sheetName = env.GOOGLE_SHEET_NAME || 'Sheet1';
    await appendValues(`${sheetName}!A:L`, [rowData]);
    console.log(`[GoogleSheets] Trade ${trade.task_id.split('-')[0]} successfully appended to sheet "${sheetName}".`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[GoogleSheets] Failed to append trade to sheet:`, reason);
  }
}

/**
 * Generic function to append rows to a specified range in the Google Sheet.
 */
export async function appendValues(range: string, values: (string | number | boolean | null)[][]): Promise<void> {
  const sheets = await getSheetsClient();
  if (!sheets || !env.GOOGLE_SHEET_ID) return;

  await withRetry(async () => {
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });
  });
}
