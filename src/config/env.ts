// src/config/env.ts
// Validates and exports all required environment variables at startup.
// Throws an informative error if any required variable is missing.

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  BOT_DATABASE_URL: z.string().url('BOT_DATABASE_URL must be a valid PostgreSQL connection string'),
  DEBUNK_API_URL: z.string().url('DEBUNK_API_URL must be a valid URL'),
  DEBUNK_API_KEY: z.string().min(1, 'DEBUNK_API_KEY is required'),
  BOT_WEBHOOK_URL: z.string().url('BOT_WEBHOOK_URL must be a valid URL'),
  BOT_PORT: z.string().default('3000').transform(Number),
  PROFIT_SLIPPAGE: z.string().default('0.05').transform(Number),
  STOP_LOSS_SLIPPAGE: z.string().default('0.15').transform(Number),
  DISCOVERY_INTERVAL_MINUTES: z.string().default('5').transform(Number),
  MIN_LIQUIDITY_USDC: z.string().default('1000').transform(Number),
  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  GOOGLE_SHEET_NAME: z.string().default('Sheet1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
