/**
 * Dome API Client
 * 
 * Provides access to prediction market data across Polymarket and Kalshi
 * API Base: https://api.domeapi.io/v1
 */

const DOME_API_KEY = process.env.DOME_API_KEY || '';
const DOME_BASE_URL = process.env.DOME_API_BASE_URL || 'https://api.domeapi.io/v1';

// ============================================
// Type Definitions (matching actual API response)
// ============================================

export interface MarketSide {
  id: string;
  label: string;
}

export interface PolymarketMarket {
  market_slug: string;
  title: string;
  condition_id: string;
  start_time: number;
  end_time: number;
  completed_time: number | null;
  close_time: number | null;
  game_start_time: string | null;
  tags: string[];
  volume_1_week: number;
  volume_1_month: number;
  volume_1_year: number;
  volume_total: number;
  resolution_source: string;
  image: string;
  side_a: MarketSide;
  side_b: MarketSide;
  winning_side: string | null;
  status: 'open' | 'closed';
}

export interface KalshiMarket {
  event_ticker: string;
  market_ticker: string;
  title: string;
  start_time: number;
  end_time: number;
  close_time: number | null;
  status: 'open' | 'closed';
  last_price: number;
  volume: number;
  volume_24h: number;
  result: string | null;
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

export interface MarketsResponse<T> {
  markets: T[];
  pagination: Pagination;
}

export interface MarketPriceResponse {
  price: number;
  at_time: number;
}

export interface CandlestickData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlesticksResponse {
  candles: CandlestickData[];
  interval: string;
  token_id: string;
}

export interface OrderbookOrder {
  size: string;
  price: string;
}

export interface PolymarketOrderbookSnapshot {
  asks: OrderbookOrder[];
  bids: OrderbookOrder[];
  hash: string;
  minOrderSize: string;
  negRisk: boolean;
  assetId: string;
  timestamp: number;
  tickSize: string;
  indexedAt: number;
  market: string;
}

export interface KalshiOrderbookSnapshot {
  orderbook: {
    yes: Array<[number, number]>;
    no: Array<[number, number]>;
    yes_dollars: Array<[string, number]>;
    no_dollars: Array<[string, number]>;
  };
  timestamp: number;
  ticker: string;
}

export interface MatchingMarketPlatform {
  platform: 'POLYMARKET' | 'KALSHI';
  market_slug?: string;
  token_ids?: string[];
  event_ticker?: string;
  market_tickers?: string[];
}

export interface MatchingMarketsResponse {
  markets: Record<string, MatchingMarketPlatform[]>;
  sport: string;
  date: string;
}

// ============================================
// Rate Limiting (configurable via env vars)
// ============================================
// Dev tier:  100 QPS, 500/10sec
// Pro tier:  500 QPS, 2500/10sec (example - check your dashboard)
// Set DOME_RATE_LIMIT_QPS and DOME_RATE_LIMIT_WINDOW in .env.local

// Sliding window rate limiter
const WINDOW_SIZE_MS = 10000; // 10 second window
const MAX_REQUESTS_PER_WINDOW = parseInt(process.env.DOME_RATE_LIMIT_WINDOW || '480'); // Default: Dev tier (500/10sec - buffer)
const MAX_REQUESTS_PER_SECOND = parseInt(process.env.DOME_RATE_LIMIT_QPS || '90'); // Default: Dev tier (100 QPS - buffer)

const requestTimestamps: number[] = [];
let lastSecondCount = 0;
let lastSecondStart = Date.now();

async function rateLimitedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const now = Date.now();
  
  // Clean up old timestamps outside the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - WINDOW_SIZE_MS) {
    requestTimestamps.shift();
  }
  
  // Reset per-second counter if we're in a new second
  if (now - lastSecondStart >= 1000) {
    lastSecondCount = 0;
    lastSecondStart = now;
  }
  
  // Check both limits
  const windowFull = requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW;
  const secondFull = lastSecondCount >= MAX_REQUESTS_PER_SECOND;
  
  if (windowFull || secondFull) {
    // Calculate wait time
    let waitTime = 0;
    if (secondFull) {
      waitTime = Math.max(waitTime, 1000 - (now - lastSecondStart) + 10);
    }
    if (windowFull && requestTimestamps.length > 0) {
      const oldestInWindow = requestTimestamps[0];
      waitTime = Math.max(waitTime, oldestInWindow + WINDOW_SIZE_MS - now + 10);
    }
    
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return rateLimitedFetch(url, options); // Retry after waiting
    }
  }
  
  // Record this request
  requestTimestamps.push(now);
  lastSecondCount++;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${DOME_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    
    // Handle rate limit errors gracefully
    if (response.status === 429) {
      console.warn('Rate limited by Dome API, waiting 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return rateLimitedFetch(url, options); // Retry
    }
    
    throw new Error(`Dome API error (${response.status}): ${errorText}`);
  }
  
  return response;
}

// ============================================
// Polymarket API
// ============================================

export const polymarket = {
  /**
   * Get markets with optional filtering
   */
  async getMarkets(params?: {
    market_slug?: string[];
    tags?: string[];
    status?: 'open' | 'closed';
    min_volume?: number;
    limit?: number;
    offset?: number;
  }): Promise<MarketsResponse<PolymarketMarket>> {
    const searchParams = new URLSearchParams();
    
    if (params?.market_slug) {
      params.market_slug.forEach(slug => searchParams.append('market_slug', slug));
    }
    if (params?.tags) {
      params.tags.forEach(tag => searchParams.append('tags', tag));
    }
    if (params?.status) searchParams.set('status', params.status);
    if (params?.min_volume) searchParams.set('min_volume', params.min_volume.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    
    const url = `${DOME_BASE_URL}/polymarket/markets?${searchParams}`;
    const response = await rateLimitedFetch(url);
    return response.json();
  },
  
  /**
   * Get current market price for a token
   */
  async getMarketPrice(tokenId: string, atTime?: number): Promise<MarketPriceResponse> {
    let url = `${DOME_BASE_URL}/polymarket/market-price/${tokenId}`;
    if (atTime) {
      url += `?at_time=${atTime}`;
    }
    const response = await rateLimitedFetch(url);
    return response.json();
  },
  
  /**
   * Get historical orderbook snapshots
   */
  async getOrderbooks(params: {
    token_id: string;
    start_time: number; // milliseconds
    end_time: number;   // milliseconds
    limit?: number;
  }): Promise<{ snapshots: PolymarketOrderbookSnapshot[]; pagination: { limit: number; count: number; has_more: boolean } }> {
    const searchParams = new URLSearchParams();
    searchParams.set('token_id', params.token_id);
    searchParams.set('start_time', params.start_time.toString());
    searchParams.set('end_time', params.end_time.toString());
    if (params.limit) searchParams.set('limit', params.limit.toString());
    
    const url = `${DOME_BASE_URL}/polymarket/orderbooks?${searchParams}`;
    const response = await rateLimitedFetch(url);
    return response.json();
  },

  /**
   * Get candlestick data for a token
   * Provides OHLCV data aggregated by time interval
   */
  async getCandlesticks(params: {
    token_id: string;
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    start_time: number; // milliseconds
    end_time: number;   // milliseconds
  }): Promise<CandlesticksResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('token_id', params.token_id);
    searchParams.set('interval', params.interval);
    searchParams.set('start_time', params.start_time.toString());
    searchParams.set('end_time', params.end_time.toString());
    
    const url = `${DOME_BASE_URL}/polymarket/candlesticks?${searchParams}`;
    const response = await rateLimitedFetch(url);
    return response.json();
  },
};

// ============================================
// Kalshi API
// ============================================

export const kalshi = {
  /**
   * Get Kalshi markets with optional filtering
   */
  async getMarkets(params?: {
    market_ticker?: string[];
    event_ticker?: string[];
    status?: 'open' | 'closed';
    min_volume?: number;
    limit?: number;
    offset?: number;
  }): Promise<MarketsResponse<KalshiMarket>> {
    const searchParams = new URLSearchParams();
    
    if (params?.market_ticker) {
      params.market_ticker.forEach(ticker => searchParams.append('market_ticker', ticker));
    }
    if (params?.event_ticker) {
      params.event_ticker.forEach(ticker => searchParams.append('event_ticker', ticker));
    }
    if (params?.status) searchParams.set('status', params.status);
    if (params?.min_volume) searchParams.set('min_volume', params.min_volume.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    
    const url = `${DOME_BASE_URL}/kalshi/markets?${searchParams}`;
    const response = await rateLimitedFetch(url);
    return response.json();
  },
  
  /**
   * Get Kalshi orderbook history
   */
  async getOrderbooks(params: {
    ticker: string;
    start_time: number;
    end_time: number;
    limit?: number;
  }): Promise<{ snapshots: KalshiOrderbookSnapshot[]; pagination: { limit: number; count: number; has_more: boolean } }> {
    const searchParams = new URLSearchParams();
    searchParams.set('ticker', params.ticker);
    searchParams.set('start_time', params.start_time.toString());
    searchParams.set('end_time', params.end_time.toString());
    if (params.limit) searchParams.set('limit', params.limit.toString());
    
    const url = `${DOME_BASE_URL}/kalshi/orderbooks?${searchParams}`;
    const response = await rateLimitedFetch(url);
    return response.json();
  },
};

// ============================================
// Matching Markets API (cross-platform)
// ============================================

export const matchingMarkets = {
  /**
   * Get matching markets by sport and date
   */
  async getBySport(sport: 'nfl' | 'nba' | 'mlb' | 'nhl' | 'cfb' | 'cbb', date: string): Promise<MatchingMarketsResponse> {
    const url = `${DOME_BASE_URL}/matching-markets/sports/${sport}?date=${date}`;
    const response = await rateLimitedFetch(url);
    return response.json();
  },
  
  /**
   * Get matching markets by market identifiers
   */
  async getByMarkets(params: {
    polymarket_market_slug?: string[];
    kalshi_event_ticker?: string[];
  }): Promise<{ markets: Record<string, MatchingMarketPlatform[]> }> {
    const searchParams = new URLSearchParams();
    
    if (params.polymarket_market_slug) {
      params.polymarket_market_slug.forEach(slug => searchParams.append('polymarket_market_slug', slug));
    }
    if (params.kalshi_event_ticker) {
      params.kalshi_event_ticker.forEach(ticker => searchParams.append('kalshi_event_ticker', ticker));
    }
    
    const url = `${DOME_BASE_URL}/matching-markets/sports?${searchParams}`;
    const response = await rateLimitedFetch(url);
    return response.json();
  },
};

// ============================================
// Health Check
// ============================================

export async function healthCheck(): Promise<boolean> {
  try {
    // Try fetching a single market to verify API connectivity
    const response = await polymarket.getMarkets({ limit: 1 });
    return response.markets.length >= 0;
  } catch {
    return false;
  }
}

export default {
  polymarket,
  kalshi,
  matchingMarkets,
  healthCheck,
};
