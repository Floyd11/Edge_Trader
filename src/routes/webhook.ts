// src/routes/webhook.ts
// Module 2 — Webhook receiver route (POST /webhook/signal)
// Authenticates the request, dispatches BET signals to execution, skips SKIP signals.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { handleBetSignal } from '../modules/execution/virtualExecution';
import { TradeSignal } from '../types';

// Runtime validation schema for the incoming webhook payload
const tradeSignalSchema = z.object({
  task_id: z.string().min(1),
  market_url: z.string().url(),
  recommended_bet: z.enum(['BET', 'SKIP']),
  trade_direction: z.enum(['YES', 'NO']),
  ai_prob_yes: z.number().min(0).max(1),
  edge: z.number(),
  kelly_fraction: z.number().min(0).max(1),
  confidence: z.enum(['normal', 'low']),
  prior_n: z.number().int().positive(),
  confidence_mult: z.number().min(0.2).max(1.0),
});

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/webhook/signal',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // --- Authentication ---
      if (request.headers['x-api-key'] !== env.DEBUNK_API_KEY) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      // --- Payload validation ---
      const parsed = tradeSignalSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid payload',
          details: parsed.error.format(),
        });
      }

      const signal = parsed.data as TradeSignal;

      // --- SKIP signal: close the position without execution ---
      if (signal.recommended_bet !== 'BET') {
        await pool.query(
          `UPDATE virtual_trades
           SET status = 'CLOSED_EDGE', error_reason = 'SKIP signal from D&B'
           WHERE task_id = $1`,
          [signal.task_id],
        );
        return reply.send({ ok: true, action: 'SKIPPED' });
      }

      // --- BET signal: run virtual execution ---
      try {
        await handleBetSignal(signal);
        return reply.send({ ok: true, action: 'EXECUTED' });
      } catch (err) {
        // Execution already marked the DB row as ERROR; just log and return 200
        // (returning 5xx would cause D&B to retry unnecessarily)
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Webhook] Execution failed for task_id ${signal.task_id}:`, reason);
        return reply.send({ ok: false, error: reason });
      }
    },
  );
}
