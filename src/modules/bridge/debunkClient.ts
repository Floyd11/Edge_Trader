// src/modules/bridge/debunkClient.ts
// Module 2 — Analytical Bridge (D&B API outbound)
// Submits a market URL to D&B API and records the resulting task_id in the DB.

import axios from 'axios';
import { pool } from '../../db/pool';
import { env } from '../../config/env';

interface AnalyzeBotResponse {
  task_id: string;
}

/**
 * Sends a market URL to D&B API for analysis.
 * On success, inserts a PENDING row into virtual_trades.
 * task_id is generated server-side by D&B and returned in the response body.
 */
export async function submitMarketForAnalysis(
  marketUrl: string,
  category?: string,
): Promise<void> {
  const response = await axios.post<AnalyzeBotResponse>(
    `${env.DEBUNK_API_URL}/api/v1/analyze-bot`,
    {
      url: marketUrl,
      webhook_url: env.BOT_WEBHOOK_URL,
    },
    {
      headers: { 'X-API-Key': env.DEBUNK_API_KEY },
      timeout: 15_000,
    },
  );

  const taskId = response.data.task_id;

  await pool.query(
    `INSERT INTO virtual_trades (task_id, market_url, category, status)
     VALUES ($1, $2, $3, 'PENDING')
     ON CONFLICT (task_id) DO NOTHING`,
    [taskId, marketUrl, category ?? null],
  );

  console.log(`[Bridge] Submitted market → task_id: ${taskId}`);
}
