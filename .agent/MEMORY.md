# Project: Edge Trader v2.1

## Current State
✅ **Phase 1 complete** — Node.js/TypeScript project initialized and compiling cleanly.

## Tech Stack
- Node.js 20 + TypeScript 5 (strict mode)
- Fastify 4 (HTTP server + webhook receiver)
- pg (node-postgres Pool, max 10 connections)
- axios (Gamma API, D&B API, CLOB API calls)
- node-cron (3 scheduled workers)
- zod (env validation + webhook payload validation)
- PM2 (process manager, ecosystem.config.js)

## Project Structure
```
edge_trader/
├── src/
│   ├── config/env.ts               # Zod-validated env config
│   ├── db/pool.ts                  # Singleton pg Pool
│   ├── types/index.ts              # All domain interfaces
│   ├── modules/
│   │   ├── discovery/
│   │   │   ├── gammaClient.ts      # Gamma API calls + liquidity filter
│   │   │   └── discoveryLoop.ts    # Cron trigger (every N minutes)
│   │   ├── bridge/
│   │   │   └── debunkClient.ts     # D&B API submit + PENDING INSERT
│   │   ├── execution/
│   │   │   ├── clobClient.ts       # CLOB order-book VWAP simulator
│   │   │   └── virtualExecution.ts # BET signal handler → OPEN status
│   │   ├── trading/
│   │   │   └── tradingCycle.ts     # Cron every 20s: check OPEN → CLOSED_EDGE
│   │   ├── cleanup/
│   │   │   └── cleanupCron.ts      # Cron every 30min: PENDING timeout → ERROR
│   │   └── reporting/
│   │       └── sheetsReporter.ts   # Google Sheets stub (TODO)
│   ├── routes/
│   │   └── webhook.ts              # POST /webhook/signal (auth + dispatch)
│   └── index.ts                    # Bootstrap: Fastify + 3 cron workers
├── migrations/
│   └── 001_init.sql                # Idempotent schema (IF NOT EXISTS)
├── .env.example
├── package.json
├── tsconfig.json
└── ecosystem.config.js             # PM2 config
```

## Key Design Decisions
- `ON CONFLICT (task_id) DO NOTHING` guards duplicate D&B submissions
- Webhook returns HTTP 200 even on execution error (prevents D&B retries)
- `Promise.allSettled` in discovery and trading loops: one failure doesn't block others
- Graceful SIGINT/SIGTERM shutdown: closes Fastify + drains pg pool
- `TARGET_PROFIT_MULT` read from env (not hardcoded)

## Next Steps
1. ✅ PM2 deployed: `pm2 status edge-trader` → **online**
2. Monitor scanner results: `pm2 logs edge-trader --lines 50`
3. Verify Google Sheets "DailyStats" automated reporting at 00:00 UTC.

## Bugfixes Applied (2026-03-26)
- **Gamma API 422**: Removed deprecated `order=newest` param
- **Gamma API field rename**: `condition_id` → `conditionId` (camelCase)
- **CLOB API 400**: CLOB `/book` now requires `token_id` (numeric), NOT `condition_id`. 
  Scanner extracts first token from `clobTokenIds` JSON array.
- **Stop-loss underflow**: `stopLossPrice` clamped to `[0.01, 0.99]` range.
- **Spread vs Slippage Logic (v2.2)**: Corrected terminological error. 
  `MAX_SPREAD` increased to 0.10 (guard only for extreme gaps). 
  `SLIPPAGE_LIMIT` set to 0.05 (allowing "order book walk" to 5 cents depth from Best Ask).
- **Scanner Optimization (v2.3)**:
  - Discovery window adjusted to **10–40 minutes** to allow for liquidity build-up.
  - Minimal total volume filter added: **$500 USDC**.
  - Scan interval increased to **10 minutes**.
- **Reporting Update**: Daily digest now runs twice (00:00 & 12:00 UTC) and uses `GOOGLE_SHEET_NAME` env.

## PM2 Info
- Process: `edge-trader` (id: 0), cluster mode, autorestart ON
- Webhook: `http://localhost:3001/webhook/signal`
- Health: `http://localhost:3001/health`
- Logs: `pm2 logs edge-trader`
- Config saved: `/root/.pm2/dump.pm2`
