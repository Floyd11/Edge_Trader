// src/index.ts
// Application entry point — boots Fastify, registers routes, and starts all cron workers.

import Fastify from 'fastify';
import { env } from './config/env';
import { pool } from './db/pool';
import { webhookRoutes } from './routes/webhook';
import { startScanner } from './modules/discovery/scanner';
import { startExitManager } from './modules/trading/exit_manager';
import { startCleanupCron } from './modules/cleanup/cleanupCron';
import { startReportingCron } from './modules/reporting/reportingCron';

async function bootstrap(): Promise<void> {
  // ── 1. Verify DB connectivity before accepting traffic ──────────────────────
  try {
    await pool.query('SELECT 1');
    console.log('[DB] PostgreSQL connection verified.');
  } catch (err) {
    console.error('[DB] Failed to connect to PostgreSQL:', err);
    process.exit(1);
  }

  // ── 2. Fastify server ───────────────────────────────────────────────────────
  const fastify = Fastify({ logger: true });

  // Health-check endpoint for uptime monitoring
  fastify.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Register webhook routes
  await fastify.register(webhookRoutes);

  // ── 3. Start background workers ─────────────────────────────────────────────
  startScanner();
  startExitManager();
  startCleanupCron();
  startReportingCron();

  // ── 4. Listen ───────────────────────────────────────────────────────────────
  await fastify.listen({ port: env.BOT_PORT, host: '0.0.0.0' });
  console.log(`[Server] Edge Trader listening on port ${env.BOT_PORT}`);

  // ── 5. Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Server] ${signal} received — shutting down gracefully…`);
    await fastify.close();
    await pool.end();
    console.log('[Server] Clean shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error:', err);
  process.exit(1);
});
