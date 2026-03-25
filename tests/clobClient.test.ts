import axios from 'axios';
import { simulateOrderBookEntry } from '../src/modules/execution/clobClient';
import { OrderBook } from '../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('clobClient - simulateOrderBookEntry', () => {
  const tokenId = 'test-token';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should compute correct VWAP for a single level fill', async () => {
    const mockBook: OrderBook = {
      bids: [],
      asks: [{ price: 0.5, size: 1000 }]
    };
    mockedAxios.get.mockResolvedValue({ data: mockBook });

    // kellyFraction = 0.1 -> target = 0.1 * 1000 = 100 USDC
    const result = await simulateOrderBookEntry(tokenId, 'YES', 0.1);

    expect(result.entryPrice).toBe(0.5);
    expect(result.volume).toBe(100);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/book'),
      expect.objectContaining({ params: { token_id: tokenId } })
    );
  });

  it('should compute correct VWAP for multiple levels', async () => {
    const mockBook: OrderBook = {
      bids: [],
      asks: [
        { price: 0.5, size: 100 }, // Total cost = 50 USDC
        { price: 0.6, size: 200 }  // Total cost = 120 USDC
      ]
    };
    mockedAxios.get.mockResolvedValue({ data: mockBook });

    // kellyFraction = 0.1 -> target = 100 USDC
    // Level 1: spend 50, get 100 shares
    // Level 2: spend 50, get 50/0.6 = 83.333333 shares
    // totalShares = 183.333333
    // VWAP = 100 / 183.333333 = 0.54545454545
    const result = await simulateOrderBookEntry(tokenId, 'YES', 0.1);

    expect(result.volume).toBe(100);
    expect(result.entryPrice).toBeCloseTo(0.54545454545, 8);
  });

  it('should handle partial fills correctly when liquidity is low', async () => {
    const mockBook: OrderBook = {
      bids: [],
      asks: [{ price: 0.4, size: 50 }] // Total liquidity = 20 USDC
    };
    mockedAxios.get.mockResolvedValue({ data: mockBook });

    // target = 100 USDC
    const result = await simulateOrderBookEntry(tokenId, 'YES', 0.1);

    expect(result.volume).toBe(20);
    expect(result.entryPrice).toBe(0.4);
  });

  it('should throw error if order book is empty', async () => {
    mockedAxios.get.mockResolvedValue({ data: { bids: [], asks: [] } });

    await expect(simulateOrderBookEntry(tokenId, 'YES', 0.1)).rejects.toThrow(
      /Empty order book/i
    );
  });

  it('should throw error if API call fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('Network Error'));

    await expect(simulateOrderBookEntry(tokenId, 'YES', 0.1)).rejects.toThrow(
      /Network Error/i
    );
  });

  it('should sort asks correctly to ensure best execution', async () => {
    // Unsorted asks
    const mockBook: OrderBook = {
      bids: [],
      asks: [
        { price: 0.7, size: 100 },
        { price: 0.5, size: 100 }
      ]
    };
    mockedAxios.get.mockResolvedValue({ data: mockBook });

    // target = 40 USDC (0.04 * 1000)
    // If sorted correctly, fills 40 @ 0.5 = 80 shares
    const result = await simulateOrderBookEntry(tokenId, 'YES', 0.04);

    expect(result.entryPrice).toBe(0.5);
    expect(result.volume).toBe(40);
  });
});
