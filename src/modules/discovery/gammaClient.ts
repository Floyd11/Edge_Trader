// src/modules/discovery/gammaClient.ts
// Module 1 — Discovery Loop (Gamma API)
// Fetches open markets and filters by liquidity before forwarding to D&B API.

import axios from 'axios';
import { GammaMarket } from '../../types';
import { env } from '../../config/env';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

/**
 * Fetches currently active markets from the Gamma API.
 * Only returns markets that:
 *   - are active (not resolved/closed)
 *   - have liquidity >= MIN_LIQUIDITY_USDC
 */
export async function fetchOpenMarkets(): Promise<GammaMarket[]> {
  const response = await axios.get<GammaMarket[]>(`${GAMMA_API_BASE}/markets`, {
    params: {
      active: true,
      closed: false,
      limit: 100,
    },
    timeout: 10_000,
  });

  const markets = response.data;

  return markets.filter(
    (m) => m.active && m.liquidity >= env.MIN_LIQUIDITY_USDC,
  );
}
