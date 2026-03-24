// src/types/index.ts
// Central type definitions for Edge Trader

export type TradeStatus =
  | 'PENDING'
  | 'OPEN'
  | 'CLOSED_EDGE'
  | 'CLOSED_TIMEOUT'
  | 'ERROR';

export type TradeSide = 'YES' | 'NO';

export type ConfidenceLevel = 'normal' | 'low';

/**
 * Payload received from D&B API via webhook POST /webhook/signal
 */
export interface TradeSignal {
  task_id: string;
  market_url: string;
  recommended_bet: 'BET' | 'SKIP';
  trade_direction: TradeSide;
  ai_prob_yes: number;     // debunk_verdict: probability 0-1
  edge: number;            // edge: decimal 0-1
  kelly_fraction: number;
  confidence: ConfidenceLevel;
  prior_n: number;
  confidence_mult: number; // BETWEEN 0.200 AND 1.000
}

/**
 * A row in the virtual_trades table
 */
export interface VirtualTrade {
  id: string;
  task_id: string;
  market_url: string;
  category: string | null;
  side: TradeSide | null;
  debunk_verdict: number | null;
  edge: number | null;
  kelly_fraction: number | null;
  confidence: ConfidenceLevel | null;
  prior_n: number | null;
  confidence_mult: number | null;
  entry_price: number | null;
  entry_volume_usdc: number | null;
  target_price: number | null;
  stop_loss_price: number | null;
  total_fee_paid: number | null;
  kelly_sim_volume_usdc: number | null;
  kelly_entry_price: number | null;
  kelly_sim_pnl_usdc: number | null;
  status: TradeStatus;
  error_reason: string | null;
  exit_price: number | null;
  pnl_usdc: number | null;
  entry_time: Date | null;
  exit_time: Date | null;
  created_at: Date;
}

/**
 * Gamma API open market shape (partial — only fields we use)
 */
export interface GammaMarket {
  id: string;
  url: string;
  category: string;
  liquidity: number; // USDC
  endDateIso: string;
  active: boolean;
}

/**
 * CLOB order book level
 */
export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

/**
 * Result of virtual order-book entry simulation
 */
export interface SimulatedEntry {
  entryPrice: number;
  volume: number; // USDC spent
}
