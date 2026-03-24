// src/modules/execution/clob_simulator.ts

export interface SimulationResult {
  status: 'SUCCESS' | 'SKIP_SPREAD' | 'SKIP_CATEGORY' | 'NO_LIQUIDITY';
  entryPrice?: number;
  entryVolumeUsdc?: number;
  sharesBought?: number;
  totalFeePaid?: number;
  kellyVolumeUsdc?: number;
  kellyEntryPrice?: number;
  targetPrice?: number;
  stopLossPrice?: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

const MAX_BANK_USDC = 5000;
const SLIPPAGE_LIMIT = 0.03;
const MAX_SPREAD = 0.05;

const EXCLUDED_CATEGORIES = new Set([
  'Crypto',
  'Sports',
  'Weather',
  'Mentions',
  'Other / General',
]);

const FEE_CONFIG: Record<string, { rate: number; exponent: number }> = {
  Finance: { rate: 0.04, exponent: 1 },
  Politics: { rate: 0.04, exponent: 1 },
  Economics: { rate: 0.03, exponent: 0.5 },
  Culture: { rate: 0.05, exponent: 1 },
  Tech: { rate: 0.04, exponent: 1 },
};

function getFeeConfig(category: string | null) {
  if (category && FEE_CONFIG[category]) {
    return FEE_CONFIG[category];
  }
  // Polymarket default fallback
  return { rate: 0.04, exponent: 1 };
}

function calculateLevelFee(
  shares: number,
  price: number,
  feeRate: number,
  exponent: number,
): number {
  return shares * feeRate * Math.pow(price * (1 - price), exponent);
}

function walkOrderBook(
  levels: OrderBookLevel[],
  bestAsk: number,
  budget: number,
  feeRate: number,
  feeExponent: number,
) {
  let remainingBudget = budget;
  let totalCost = 0; // Cost including fees in USDC
  let totalShares = 0; // Number of shares bought
  let totalFee = 0; // Paid Taker fee in USDC

  for (const level of levels) {
    if (remainingBudget <= 0) break;
    // Enforce slippage limit
    if (level.price > bestAsk + SLIPPAGE_LIMIT) break;

    const feePerShare = calculateLevelFee(1, level.price, feeRate, feeExponent);
    const totalCostPerShare = level.price + feePerShare;

    // We can buy at most the affordable shares OR the available liquidity on this level
    const maxAffordableShares = remainingBudget / totalCostPerShare;
    const sharesToBuy = Math.min(level.size, maxAffordableShares);

    const levelAssetCost = sharesToBuy * level.price;
    const levelFee = calculateLevelFee(sharesToBuy, level.price, feeRate, feeExponent);
    const levelTotalSpend = levelAssetCost + levelFee;

    totalShares += sharesToBuy;
    totalCost += levelTotalSpend;
    totalFee += levelFee;
    remainingBudget -= levelTotalSpend;
  }

  return {
    totalSpentUsdc: totalCost,
    sharesBought: totalShares,
    totalFeePaid: totalFee,
    vwap: totalShares > 0 ? (totalCost - totalFee) / totalShares : 0,
  };
}

export function simulateOrderBookEntry(
  category: string | null,
  orderBook: OrderBook,
  kellyFraction: number,
  aiProb: number,
): SimulationResult {
  // 1. Guard Category
  if (category && EXCLUDED_CATEGORIES.has(category)) {
    return { status: 'SKIP_CATEGORY' };
  }

  // 2. Guard Liquidity Validation
  if (orderBook.asks.length === 0 || orderBook.bids.length === 0) {
    return { status: 'NO_LIQUIDITY' };
  }

  const asks = [...orderBook.asks].sort((a, b) => a.price - b.price); // Assured ascending
  const bids = [...orderBook.bids].sort((a, b) => b.price - a.price); // Assured descending

  const bestAsk = asks[0].price;
  const bestBid = bids[0].price;

  // 3. Guard Spread
  if (bestAsk - bestBid > MAX_SPREAD) {
    return { status: 'SKIP_SPREAD' };
  }

  const { rate: feeRate, exponent: feeExponent } = getFeeConfig(category);

  // 4. Primary Orderbook VWAP Walk
  const primaryResult = walkOrderBook(
    asks,
    bestAsk,
    MAX_BANK_USDC,
    feeRate,
    feeExponent,
  );

  // NO_LIQUIDITY happens if all liquidity is outside our SLIPPAGE_LIMIT
  if (primaryResult.sharesBought === 0) {
    return { status: 'NO_LIQUIDITY' };
  }

  const vwap = primaryResult.vwap;

  // 5. Shadow Kelly Walk
  const kellyBudget = MAX_BANK_USDC * Math.max(0, kellyFraction);
  let kellyResult = { totalSpentUsdc: 0, vwap: 0 };

  if (kellyBudget > 0) {
    kellyResult = walkOrderBook(asks, bestAsk, kellyBudget, feeRate, feeExponent);
  }

  // 6. Triggers Calculations
  const targetPrice = Number((aiProb - 0.05).toFixed(4));
  const stopLossPrice = Number((vwap * 0.70).toFixed(4));

  return {
    status: 'SUCCESS',
    entryPrice: Number(vwap.toFixed(4)),
    entryVolumeUsdc: Number(primaryResult.totalSpentUsdc.toFixed(2)),
    sharesBought: Number(primaryResult.sharesBought.toFixed(4)),
    totalFeePaid: Number(primaryResult.totalFeePaid.toFixed(4)),
    kellyVolumeUsdc: Number(kellyResult.totalSpentUsdc.toFixed(2)),
    kellyEntryPrice: Number(kellyResult.vwap.toFixed(4)),
    targetPrice,
    stopLossPrice,
  };
}
