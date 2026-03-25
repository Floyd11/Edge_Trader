import Fastify, { FastifyInstance } from 'fastify';
import { webhookRoutes } from '../src/routes/webhook';
import { pool } from '../src/db/pool';
import { env } from '../src/config/env';
import { handleBetSignal } from '../src/modules/execution/virtualExecution';

jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../src/modules/execution/virtualExecution', () => ({
  handleBetSignal: jest.fn(),
}));

describe('Webhook Routes - POST /webhook/signal', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(webhookRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validPayload = {
    task_id: 'test-task',
    market_url: 'https://polymarket.com/market/1',
    recommended_bet: 'BET',
    trade_direction: 'YES',
    ai_prob_yes: 0.8,
    edge: 0.2,
    kelly_fraction: 0.05,
    confidence: 'normal',
    prior_n: 50,
    confidence_mult: 1.0,
  };

  it('should return 401 if x-api-key is missing or invalid', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/webhook/signal',
      headers: { 'x-api-key': 'wrong-key' },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload)).toEqual({ error: 'Unauthorized' });
  });

  it('should return 400 if payload is invalid', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/webhook/signal',
      headers: { 'x-api-key': env.DEBUNK_API_KEY },
      payload: { ...validPayload, market_url: 'not-a-url' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe('Invalid payload');
  });

  it('should handle SKIP signal by updating DB to CLOSED_EDGE', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

    const response = await fastify.inject({
      method: 'POST',
      url: '/webhook/signal',
      headers: { 'x-api-key': env.DEBUNK_API_KEY },
      payload: { ...validPayload, recommended_bet: 'SKIP' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true, action: 'SKIPPED' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE[\s\S]*virtual_trades[\s\S]*SET[\s\S]*status[\s\S]*=[\s\S]*'CLOSED_EDGE'/i),
      ['test-task']
    );
  });

  it('should handle BET signal by calling handleBetSignal', async () => {
    (handleBetSignal as jest.Mock).mockResolvedValue(undefined);

    const response = await fastify.inject({
      method: 'POST',
      url: '/webhook/signal',
      headers: { 'x-api-key': env.DEBUNK_API_KEY },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true, action: 'EXECUTED' });
    expect(handleBetSignal).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'test-task' }));
  });

  it('should return ok:false if handleBetSignal fails but status 200', async () => {
    (handleBetSignal as jest.Mock).mockRejectedValue(new Error('Execution Error'));

    const response = await fastify.inject({
      method: 'POST',
      url: '/webhook/signal',
      headers: { 'x-api-key': env.DEBUNK_API_KEY },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: false, error: 'Execution Error' });
  });
});
