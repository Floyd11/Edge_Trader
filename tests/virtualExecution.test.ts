import { handleBetSignal } from '../src/modules/execution/virtualExecution';
import { pool } from '../src/db/pool';
import { simulateOrderBookEntry } from '../src/modules/execution/clobClient';
import { TradeSignal } from '../src/types';

jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../src/modules/execution/clobClient', () => ({
  simulateOrderBookEntry: jest.fn(),
}));

describe('VirtualExecution - handleBetSignal', () => {
  const mockSignal: TradeSignal = {
    task_id: 'test-task-123',
    market_url: 'https://polymarket.com/event/test-market',
    recommended_bet: 'BET',
    trade_direction: 'YES',
    ai_prob_yes: 0.75,
    edge: 0.1,
    kelly_fraction: 0.05,
    confidence: 'normal',
    prior_n: 10,
    confidence_mult: 1.0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully open a trade when simulation succeeds', async () => {
    (simulateOrderBookEntry as jest.Mock).mockResolvedValue({
      entryPrice: 0.65,
      volume: 100,
    });
    (pool.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

    await handleBetSignal(mockSignal);

    expect(simulateOrderBookEntry).toHaveBeenCalledWith('test-market', 'YES', 0.05);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE\s+virtual_trades\s+SET\s+status\s*=\s*'OPEN'/i),
      expect.arrayContaining([
        'YES',
        0.65,
        100,
        0.70, // targetPrice = 0.75 (AI prob) - 0.05
        0.50, // stopLoss = 0.65 (entry) - 0.15
        0.75, // AI prob yes
        0.1,  // edge
        0.05, // kelly
        'normal',
        10,
        1.0,
        'test-task-123',
      ])
    );
  });

  it('should mark trade as ERROR when simulation fails', async () => {
    const errorMsg = 'CLOB API failure';
    (simulateOrderBookEntry as jest.Mock).mockRejectedValue(new Error(errorMsg));
    (pool.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

    await expect(handleBetSignal(mockSignal)).rejects.toThrow(errorMsg);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE\s+virtual_trades\s+SET\s+status\s*=\s*'ERROR'/i),
      [errorMsg, mockSignal.task_id]
    );
  });
});
