/**
 * Market Sync Background Job
 * 
 * Polls Dome API every 5 minutes to sync market data and detect arbitrage
 * Run with: npm run jobs:sync
 */

import { query } from '../lib/db';
import dome, { PolymarketMarket, KalshiMarket, MatchingMarketPlatform, OrderbookOrder, PolymarketOrderbookSnapshot, KalshiOrderbookSnapshot } from '../lib/dome-api';
import { detectSingleMarketArb, detectCrossPlatformArb, trackArbPersistence, closeStaleArbs, PriceSnapshot } from '../lib/arb-detection';
import { loadFees } from '../lib/fees';
import { checkVolumeSpikes, VolumeAlert } from '../lib/volume-alerts';

const SYNC_INTERVAL_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES || '5') * 60 * 1000);
const BATCH_SIZE = 10; // Smaller batches to avoid rate limits
const API_PAGE_SIZE = 100; // Dome API max limit per request
const MAX_PAGES = 2; // 200 markets per platform (most active by volume)
const MIN_VOLUME_FOR_PRICE_FETCH = 5000; // Only fetch prices for markets with $5k+ volume
const ORDERBOOK_LOOKBACK_MS = 5 * 60 * 1000; // 5 minutes

function isValidPrice(p: number | null | undefined): p is number {
  return typeof p === 'number' && p > 0 && p < 1 && Number.isFinite(p);
}

function normalizePrice(value: number): number {
  return value > 1 ? value / 100 : value;
}

function pickTopBidAsk(snapshot: PolymarketOrderbookSnapshot) {
  const bids = snapshot.bids.map(b => ({ price: parseFloat(b.price), size: parseFloat(b.size) }));
  const asks = snapshot.asks.map(a => ({ price: parseFloat(a.price), size: parseFloat(a.size) }));
  const bestBid = bids.reduce((acc, b) => (b.price > (acc?.price ?? 0) ? b : acc), null as { price: number; size: number } | null);
  const bestAsk = asks.reduce((acc, a) => (acc === null || a.price < acc.price ? a : acc), null as { price: number; size: number } | null);
  return { bestBid, bestAsk };
}

async function getPolymarketTop(tokenId: string) {
  const end = Date.now();
  const start = end - ORDERBOOK_LOOKBACK_MS;
  const resp = await dome.polymarket.getOrderbooks({ token_id: tokenId, start_time: start, end_time: end, limit: 1 });
  const snap = resp.snapshots?.[0];
  if (!snap) return null;
  const { bestBid, bestAsk } = pickTopBidAsk(snap);
  if (
    (!bestBid && !bestAsk) ||
    (bestBid && !isValidPrice(bestBid.price)) ||
    (bestAsk && !isValidPrice(bestAsk.price))
  ) {
    return null;
  }
  return {
    bid: bestBid?.price ?? null,
    ask: bestAsk?.price ?? null,
    bidSize: bestBid?.size ?? null,
    askSize: bestAsk?.size ?? null,
    timestamp: snap.timestamp,
  };
}

async function getKalshiTop(ticker: string) {
  const end = Date.now();
  const start = end - ORDERBOOK_LOOKBACK_MS;
  const resp = await dome.kalshi.getOrderbooks({ ticker, start_time: start, end_time: end, limit: 1 });
  const snap: KalshiOrderbookSnapshot | undefined = resp.snapshots?.[0];
  if (!snap) return null;
  const yes = snap.orderbook?.yes || [];
  const no = snap.orderbook?.no || [];
  const bestYes = yes[0] ? { price: yes[0][0], size: yes[0][1] } : null;
  const bestNo = no[0] ? { price: no[0][0], size: no[0][1] } : null;
  const yesBid = bestYes ? normalizePrice(bestYes.price) : null;
  const noBid = bestNo ? normalizePrice(bestNo.price) : null;
  if (
    (!bestYes && !bestNo) ||
    (yesBid !== null && !isValidPrice(yesBid)) ||
    (noBid !== null && !isValidPrice(noBid))
  ) {
    return null;
  }
  return {
    yesBid,
    yesBidSize: bestYes?.size ?? null,
    noBid,
    noBidSize: bestNo?.size ?? null,
    timestamp: snap.timestamp,
  };
}


interface SyncStats {
  marketsUpserted: number;
  snapshotsTaken: number;
  arbsDetected: number;
  arbsClosed: number;
  volumeAlerts: number;
  errors: string[];
}

/**
 * Process items in batches with parallel execution
 */
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<(R | Error)[]> {
  const results: (R | Error)[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
      }
    }
  }
  
  return results;
}

/**
 * Upsert a Polymarket market into the database
 */
async function upsertPolymarketMarket(market: PolymarketMarket): Promise<number> {
  // Detect sport from tags
  let sport: string | null = null;
  const sportTags = ['nfl', 'nba', 'mlb', 'nhl', 'cfb', 'cbb'];
  if (market.tags) {
    for (const tag of market.tags) {
      if (sportTags.includes(tag.toLowerCase())) {
        sport = tag.toLowerCase();
        break;
      }
    }
  }
  
  const result = await query<{ id: number }>(
    `INSERT INTO markets (platform, platform_id, event_id, title, category, sport, status, resolution_date, outcome, token_id_a, token_id_b)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (platform, platform_id) 
     DO UPDATE SET 
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       resolution_date = EXCLUDED.resolution_date,
       outcome = EXCLUDED.outcome,
       token_id_a = EXCLUDED.token_id_a,
       token_id_b = EXCLUDED.token_id_b,
       updated_at = NOW()
     RETURNING id`,
    [
      'polymarket',
      market.market_slug, // Use market_slug as platform_id
      market.condition_id,
      market.title,
      market.tags.length > 0 ? market.tags[0] : null,
      sport,
      market.status,
      market.end_time ? new Date(market.end_time * 1000) : null,
      market.winning_side,
      market.side_a?.id || null, // Store Yes token ID
      market.side_b?.id || null, // Store No token ID
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Upsert a Kalshi market into the database
 */
async function upsertKalshiMarket(market: KalshiMarket): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO markets (platform, platform_id, event_id, title, category, sport, status, resolution_date, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (platform, platform_id) 
     DO UPDATE SET 
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       resolution_date = EXCLUDED.resolution_date,
       outcome = EXCLUDED.outcome,
       updated_at = NOW()
     RETURNING id`,
    [
      'kalshi',
      market.market_ticker, // Use market_ticker as platform_id
      market.event_ticker,
      market.title,
      null, // Kalshi doesn't have tags in same format
      null, // Sport detection would need to parse title
      market.status,
      market.end_time ? new Date(market.end_time * 1000) : null,
      market.result,
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Insert a price snapshot for a Polymarket market using actual prices
 */
async function insertPolymarketSnapshot(
  marketId: number, 
  sideAPrice: number, 
  sideBPrice: number,
  volume24h: number,
  volumeAllTime: number,
  opts?: {
    yesBid?: number | null;
    yesAsk?: number | null;
    noBid?: number | null;
    noAsk?: number | null;
    yesBidSize?: number | null;
    yesAskSize?: number | null;
    noBidSize?: number | null;
    noAskSize?: number | null;
  }
): Promise<void> {
  // In binary markets, side_a is typically "Yes" and side_b is "No"
  const yesBid = opts?.yesBid ?? sideAPrice * 0.99;
  const yesAsk = opts?.yesAsk ?? sideAPrice * 1.01;
  const noBid = opts?.noBid ?? sideBPrice * 0.99;
  const noAsk = opts?.noAsk ?? sideBPrice * 1.01;
  const yesBidSize = opts?.yesBidSize ?? 1000;
  const yesAskSize = opts?.yesAskSize ?? 1000;
  const noBidSize = opts?.noBidSize ?? 1000;
  const noAskSize = opts?.noAskSize ?? 1000;

  await query(
    `INSERT INTO price_snapshots (
      market_id, yes_price, no_price,
      yes_bid, yes_ask, no_bid, no_ask,
      yes_bid_size, yes_ask_size, no_bid_size, no_ask_size,
      volume_24h, volume_all_time
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      marketId,
      sideAPrice,
      sideBPrice,
      yesBid,
      yesAsk,
      noBid,
      noAsk,
      yesBidSize,
      yesAskSize,
      noBidSize,
      noAskSize,
      volume24h,
      volumeAllTime,
    ]
  );
}

/**
 * Insert a price snapshot for a Kalshi market
 */
async function insertKalshiSnapshot(
  marketId: number,
  lastPrice: number,
  volume24h: number,
  volumeAllTime: number,
  opts?: {
    yesBid?: number | null;
    yesAsk?: number | null;
    noBid?: number | null;
    noAsk?: number | null;
    yesBidSize?: number | null;
    yesAskSize?: number | null;
    noBidSize?: number | null;
    noAskSize?: number | null;
  }
): Promise<void> {
  // Safety: ensure price is normalized to 0-1 range
  const yesPrice = lastPrice > 1 ? lastPrice / 100 : lastPrice;
  const noPrice = 1 - yesPrice;

  const yesBid = opts?.yesBid ?? yesPrice * 0.99;
  const yesAsk = opts?.yesAsk ?? yesPrice * 1.01;
  const noBid = opts?.noBid ?? noPrice * 0.99;
  const noAsk = opts?.noAsk ?? noPrice * 1.01;
  const yesBidSize = opts?.yesBidSize ?? 1000;
  const yesAskSize = opts?.yesAskSize ?? 1000;
  const noBidSize = opts?.noBidSize ?? 1000;
  const noAskSize = opts?.noAskSize ?? 1000;
  
  await query(
    `INSERT INTO price_snapshots (
      market_id, yes_price, no_price,
      yes_bid, yes_ask, no_bid, no_ask,
      yes_bid_size, yes_ask_size, no_bid_size, no_ask_size,
      volume_24h, volume_all_time
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      marketId,
      yesPrice,
      noPrice,
      yesBid,
      yesAsk,
      noBid,
      noAsk,
      yesBidSize,
      yesAskSize,
      noBidSize,
      noAskSize,
      volume24h,
      volumeAllTime,
    ]
  );
}

/**
 * Upsert a market pair
 */
async function upsertMarketPair(
  polyMarketSlug: string,
  kalshiMarketTicker: string,
  sport: string,
  gameDate: string
): Promise<number | null> {
  // Get internal market IDs
  const polyMarket = await query<{ id: number }>(
    'SELECT id FROM markets WHERE platform = $1 AND platform_id = $2',
    ['polymarket', polyMarketSlug]
  );
  
  const kalshiMarket = await query<{ id: number }>(
    'SELECT id FROM markets WHERE platform = $1 AND platform_id = $2',
    ['kalshi', kalshiMarketTicker]
  );
  
  if (polyMarket.rows.length === 0 || kalshiMarket.rows.length === 0) {
    console.warn(`Market pair incomplete: poly=${polyMarketSlug}, kalshi=${kalshiMarketTicker}`);
    return null;
  }
  
  const result = await query<{ id: number }>(
    `INSERT INTO market_pairs (poly_market_id, kalshi_market_id, sport, game_date, match_confidence)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (poly_market_id, kalshi_market_id) DO UPDATE SET
       match_confidence = EXCLUDED.match_confidence
     RETURNING id`,
    [
      polyMarket.rows[0].id,
      kalshiMarket.rows[0].id,
      sport,
      gameDate,
      0.95, // High confidence from Dome matching
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Get latest snapshot for a market
 */
async function getLatestSnapshot(marketId: number): Promise<PriceSnapshot | null> {
  const result = await query<{
    market_id: number;
    yes_price: string;
    no_price: string;
    yes_bid: string;
    yes_ask: string;
    no_bid: string;
    no_ask: string;
    yes_bid_size: string;
    yes_ask_size: string;
    no_bid_size: string;
    no_ask_size: string;
    volume_24h: string;
    platform: string;
  }>(
    `SELECT ps.*, m.platform FROM price_snapshots ps
     JOIN markets m ON m.id = ps.market_id
     WHERE ps.market_id = $1
     ORDER BY ps.snapshot_at DESC LIMIT 1`,
    [marketId]
  );
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    marketId: row.market_id,
    platform: row.platform,
    yesPrice: parseFloat(row.yes_price),
    noPrice: parseFloat(row.no_price),
    yesBid: parseFloat(row.yes_bid),
    yesAsk: parseFloat(row.yes_ask),
    noBid: parseFloat(row.no_bid),
    noAsk: parseFloat(row.no_ask),
    yesBidSize: parseFloat(row.yes_bid_size),
    yesAskSize: parseFloat(row.yes_ask_size),
    noBidSize: parseFloat(row.no_bid_size),
    noAskSize: parseFloat(row.no_ask_size),
    volume24h: parseFloat(row.volume_24h),
  };
}

/**
 * Main sync function
 */
async function syncMarkets(): Promise<SyncStats> {
  const stats: SyncStats = {
    marketsUpserted: 0,
    snapshotsTaken: 0,
    arbsDetected: 0,
    arbsClosed: 0,
    volumeAlerts: 0,
    errors: [],
  };
  
  console.log(`\n🔄 Starting market sync at ${new Date().toISOString()}`);
  
  // Record sync start
  const syncResult = await query<{ id: number }>(
    `INSERT INTO sync_status (sync_type, status) VALUES ('full_sync', 'running') RETURNING id`
  );
  const syncId = syncResult.rows[0].id;
  
  try {
    // Load latest fees
    await loadFees();
    
    // 1. Fetch Polymarket markets with pagination
    console.log('📊 Fetching Polymarket markets...');
    let polyMarkets: PolymarketMarket[] = [];
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await dome.polymarket.getMarkets({
          status: 'open',
          min_volume: 5000, // Only markets with $5k+ total volume
          limit: API_PAGE_SIZE,
          offset: page * API_PAGE_SIZE,
        });
        polyMarkets.push(...response.markets);
        console.log(`   Page ${page + 1}: ${response.markets.length} markets (total: ${polyMarkets.length})`);
        
        // Stop if we got less than a full page
        if (response.markets.length < API_PAGE_SIZE || !response.pagination.has_more) {
          break;
        }
      }
      console.log(`   ✓ Found ${polyMarkets.length} Polymarket markets`);
    } catch (err) {
      const error = `Polymarket fetch failed: ${err instanceof Error ? err.message : err}`;
      stats.errors.push(error);
      console.error(`   ❌ ${error}`);
    }
    
    // 2. Fetch Kalshi markets with pagination
    console.log('📊 Fetching Kalshi markets...');
    let kalshiMarkets: KalshiMarket[] = [];
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await dome.kalshi.getMarkets({
          status: 'open',
          min_volume: 1000, // Only markets with $10+ volume (Kalshi uses cents)
          limit: API_PAGE_SIZE,
          offset: page * API_PAGE_SIZE,
        });
        kalshiMarkets.push(...response.markets);
        console.log(`   Page ${page + 1}: ${response.markets.length} markets (total: ${kalshiMarkets.length})`);
        
        if (response.markets.length < API_PAGE_SIZE || !response.pagination.has_more) {
          break;
        }
      }
      console.log(`   ✓ Found ${kalshiMarkets.length} Kalshi markets`);
    } catch (err) {
      const error = `Kalshi fetch failed: ${err instanceof Error ? err.message : err}`;
      stats.errors.push(error);
      console.error(`   ❌ ${error}`);
    }
    
    // 3. Upsert markets to DB first (fast, sequential)
    console.log('💾 Upserting Polymarket markets...');
    const marketIds: Map<string, number> = new Map();
    const polyMarketsWithIds: Array<{ market: PolymarketMarket; id: number }> = [];
    
    for (const market of polyMarkets) {
      try {
        const id = await upsertPolymarketMarket(market);
        marketIds.set(`polymarket:${market.market_slug}`, id);
        polyMarketsWithIds.push({ market, id });
        stats.marketsUpserted++;
      } catch (err) {
        if (stats.errors.length < 10) {
          stats.errors.push(`Failed to upsert Poly market ${market.market_slug}: ${err}`);
        }
      }
    }
    
    // 4. Filter to high-volume markets only for price fetching (reduces API calls significantly)
    const highVolumeMarkets = polyMarketsWithIds.filter(({ market }) => 
      market.volume_total >= MIN_VOLUME_FOR_PRICE_FETCH
    );
    console.log(`📈 Fetching prices for ${highVolumeMarkets.length}/${polyMarketsWithIds.length} high-volume Polymarket markets...`);
    
    let pricesFetched = 0;
    await processBatch(highVolumeMarkets, BATCH_SIZE, async ({ market, id }) => {
      try {
        // Fetch both sides in parallel
        const [sideAPrice, sideBPrice, sideAOb, sideBOb] = await Promise.all([
          dome.polymarket.getMarketPrice(market.side_a.id),
          dome.polymarket.getMarketPrice(market.side_b.id),
          getPolymarketTop(market.side_a.id).catch(() => null),
          getPolymarketTop(market.side_b.id).catch(() => null),
        ]);

        const yesOpts = sideAOb ? {
          yesBid: sideAOb.bid ?? undefined,
          yesAsk: sideAOb.ask ?? undefined,
          yesBidSize: sideAOb.bidSize ?? undefined,
          yesAskSize: sideAOb.askSize ?? undefined,
        } : {};

        const noOpts = sideBOb ? {
          noBid: sideBOb.bid ?? undefined,
          noAsk: sideBOb.ask ?? undefined,
          noBidSize: sideBOb.bidSize ?? undefined,
          noAskSize: sideBOb.askSize ?? undefined,
        } : {};
        
        // Polymarket: volume_1_week / 7 gives ~24h estimate, volume_total is all-time
        await insertPolymarketSnapshot(
          id, 
          sideAPrice.price, 
          sideBPrice.price,
          market.volume_1_week / 7, // ~24h volume estimate
          market.volume_total, // All-time volume
          { ...yesOpts, ...noOpts }
        );
        stats.snapshotsTaken++;
        pricesFetched++;
        
        // Log progress every 50 markets
        if (pricesFetched % 50 === 0) {
          console.log(`   📊 Progress: ${pricesFetched}/${highVolumeMarkets.length} prices fetched`);
        }
        
        // Detect single-market arb
        const snapshot: PriceSnapshot = {
          marketId: id,
          platform: 'polymarket',
          yesPrice: sideAPrice.price,
          noPrice: sideBPrice.price,
          yesBid: sideAPrice.price * 0.99,
          yesAsk: sideAPrice.price * 1.01,
          noBid: sideBPrice.price * 0.99,
          noAsk: sideBPrice.price * 1.01,
          yesBidSize: 10000,
          yesAskSize: 10000,
          noBidSize: 10000,
          noAskSize: 10000,
          volume24h: market.volume_1_week / 7,
        };
        
        const arb = detectSingleMarketArb(snapshot, market.title);
        if (arb) {
          await trackArbPersistence(arb);
          stats.arbsDetected++;
          console.log(`   🎯 Arb: ${market.title.substring(0, 50)}... (${arb.quality}, ${arb.netSpreadPct.toFixed(2)}%)`);
        }
      } catch (priceErr) {
        if (stats.errors.length < 10) {
          stats.errors.push(`Price fetch failed for ${market.market_slug}: ${priceErr instanceof Error ? priceErr.message : priceErr}`);
        }
      }
    });
    
    // 5. Process Kalshi markets (already have prices, so faster)
    console.log(`💾 Processing ${kalshiMarkets.length} Kalshi markets...`);
    
    await processBatch(kalshiMarkets, BATCH_SIZE * 2, async (market) => {
      try {
        // Kalshi prices come as 0-100 (cents). Normalize to 0-1.
        const normalizedLastPrice = market.last_price > 1 ? market.last_price / 100 : market.last_price;
        const ob = await getKalshiTop(market.market_ticker).catch(() => null);

        const id = await upsertKalshiMarket(market);
        marketIds.set(`kalshi:${market.market_ticker}`, id);
        stats.marketsUpserted++;
        
        // Kalshi already has last_price in the market data
        // volume is all-time, volume_24h is 24h volume
        await insertKalshiSnapshot(id, normalizedLastPrice, market.volume_24h, market.volume, ob ?? undefined);
        stats.snapshotsTaken++;
        
        // Detect single-market arb
        const snapshot: PriceSnapshot = {
          marketId: id,
          platform: 'kalshi',
          yesPrice: normalizedLastPrice,
          noPrice: 1 - normalizedLastPrice,
          yesBid: normalizedLastPrice * 0.99,
          yesAsk: normalizedLastPrice * 1.01,
          noBid: (1 - normalizedLastPrice) * 0.99,
          noAsk: (1 - normalizedLastPrice) * 1.01,
          yesBidSize: 5000,
          yesAskSize: 5000,
          noBidSize: 5000,
          noAskSize: 5000,
          volume24h: market.volume_24h,
        };
        
        const arb = detectSingleMarketArb(snapshot, market.title);
        if (arb) {
          await trackArbPersistence(arb);
          stats.arbsDetected++;
          console.log(`   🎯 Arb: ${market.title.substring(0, 50)}... (${arb.quality}, ${arb.netSpreadPct.toFixed(2)}%)`);
        }
      } catch (err) {
        if (stats.errors.length < 20) {
          stats.errors.push(`Failed to process Kalshi market ${market.market_ticker}: ${err}`);
        }
      }
    });
    
    console.log(`   Upserted ${stats.marketsUpserted} markets, took ${stats.snapshotsTaken} snapshots`);
    
    // 4. Fetch and process matched market pairs for cross-platform arbs
    console.log('🔗 Processing cross-platform pairs...');
    const today = new Date().toISOString().split('T')[0];
    // Also check tomorrow for games
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    
    // Collect all needed market tickers from matching API first
    const neededKalshiTickers: string[] = [];
    const neededPolymarketSlugs: string[] = [];
    const matchedPairs: Array<{sport: string; date: string; polySlug: string; kalshiTicker: string}> = [];
    
    for (const sport of ['nfl', 'nba', 'mlb', 'cfb'] as const) {
      for (const date of [today, tomorrow]) {
        try {
          const matchingResponse = await dome.matchingMarkets.getBySport(sport, date);
          const gameKeys = Object.keys(matchingResponse.markets);
          
          for (const gameKey of gameKeys) {
            const platforms = matchingResponse.markets[gameKey];
            const polyEntry = platforms.find(p => p.platform === 'POLYMARKET') as MatchingMarketPlatform | undefined;
            const kalshiEntry = platforms.find(p => p.platform === 'KALSHI') as MatchingMarketPlatform | undefined;
            
            if (!polyEntry?.market_slug || !kalshiEntry?.market_tickers?.length) continue;
            
            const kalshiTicker = kalshiEntry.market_tickers[0];
            neededKalshiTickers.push(kalshiTicker);
            neededPolymarketSlugs.push(polyEntry.market_slug);
            matchedPairs.push({ sport, date, polySlug: polyEntry.market_slug, kalshiTicker });
          }
        } catch (err) {
          if (!String(err).includes('Not Found')) {
            stats.errors.push(`Failed to fetch ${sport} pairs for ${date}: ${err}`);
          }
        }
      }
    }
    
    console.log(`   Found ${matchedPairs.length} potential pairs, fetching missing markets...`);
    
    // Fetch missing Kalshi markets specifically (they often don't make top 200 by volume)
    if (neededKalshiTickers.length > 0) {
      try {
        // Fetch in batches of 20 to avoid huge requests
        for (let i = 0; i < neededKalshiTickers.length; i += 20) {
          const batch = neededKalshiTickers.slice(i, i + 20);
          const response = await dome.kalshi.getMarkets({ market_ticker: batch });
          
          for (const market of response.markets) {
            try {
              const normalizedLastPrice = market.last_price > 1 ? market.last_price / 100 : market.last_price;
              const ob = await getKalshiTop(market.market_ticker).catch(() => null);
              const id = await upsertKalshiMarket(market);
              await insertKalshiSnapshot(id, normalizedLastPrice, market.volume_24h, market.volume, ob ?? undefined);
              stats.marketsUpserted++;
              stats.snapshotsTaken++;
            } catch (err) {
              // Market might already exist, that's fine
            }
          }
        }
        console.log(`   Fetched ${neededKalshiTickers.length} Kalshi game markets`);
      } catch (err) {
        stats.errors.push(`Failed to fetch Kalshi game markets: ${err}`);
      }
    }

    // Fetch missing Polymarket markets specifically (ensure paired markets exist)
    if (neededPolymarketSlugs.length > 0) {
      try {
        for (let i = 0; i < neededPolymarketSlugs.length; i += 20) {
          const batch = neededPolymarketSlugs.slice(i, i + 20);
          const response = await dome.polymarket.getMarkets({ market_slug: batch, status: 'open' });
          
          // Upsert and take snapshots
          for (const market of response.markets) {
            try {
              const id = await upsertPolymarketMarket(market);
              
              // Fetch both sides' prices
              const [sideAPrice, sideBPrice, sideAOb, sideBOb] = await Promise.all([
                dome.polymarket.getMarketPrice(market.side_a.id),
                dome.polymarket.getMarketPrice(market.side_b.id),
                getPolymarketTop(market.side_a.id).catch(() => null),
                getPolymarketTop(market.side_b.id).catch(() => null),
              ]);
              
              await insertPolymarketSnapshot(
                id,
                sideAPrice.price,
                sideBPrice.price,
                market.volume_1_week / 7,
                market.volume_total,
                {
                  ...(sideAOb ? {
                    yesBid: sideAOb.bid ?? undefined,
                    yesAsk: sideAOb.ask ?? undefined,
                    yesBidSize: sideAOb.bidSize ?? undefined,
                    yesAskSize: sideAOb.askSize ?? undefined,
                  } : {}),
                  ...(sideBOb ? {
                    noBid: sideBOb.bid ?? undefined,
                    noAsk: sideBOb.ask ?? undefined,
                    noBidSize: sideBOb.bidSize ?? undefined,
                    noAskSize: sideBOb.askSize ?? undefined,
                  } : {}),
                }
              );
              
              stats.marketsUpserted++;
              stats.snapshotsTaken++;
            } catch (err) {
              // Market might already exist, that's fine
            }
          }
        }
        console.log(`   Fetched ${neededPolymarketSlugs.length} Polymarket game markets`);
      } catch (err) {
        stats.errors.push(`Failed to fetch Polymarket game markets: ${err}`);
      }
    }
    
    // Now process the pairs
    let pairsCreated = 0;
    for (const { sport, date, polySlug, kalshiTicker } of matchedPairs) {
      try {
        const pairId = await upsertMarketPair(polySlug, kalshiTicker, sport, date);
        if (!pairId) continue;
        
        pairsCreated++;
        
        // Get snapshots for both markets and detect cross-platform arb
        const polyMarketResult = await query<{ id: number; title: string }>(
          'SELECT id, title FROM markets WHERE platform = $1 AND platform_id = $2',
          ['polymarket', polySlug]
        );
        const kalshiMarketResult = await query<{ id: number; title: string }>(
          'SELECT id, title FROM markets WHERE platform = $1 AND platform_id = $2',
          ['kalshi', kalshiTicker]
        );
        
        if (polyMarketResult.rows.length === 0 || kalshiMarketResult.rows.length === 0) continue;
        
        const polySnapshot = await getLatestSnapshot(polyMarketResult.rows[0].id);
        const kalshiSnapshot = await getLatestSnapshot(kalshiMarketResult.rows[0].id);
        
        if (!polySnapshot || !kalshiSnapshot) continue;
        
        // Detect cross-platform arb
        const crossArb = detectCrossPlatformArb(
          polySnapshot,
          kalshiSnapshot,
          pairId,
          polyMarketResult.rows[0].title,
          kalshiMarketResult.rows[0].title
        );
        
        if (crossArb) {
          await trackArbPersistence(crossArb);
          stats.arbsDetected++;
          console.log(`   🎯 Cross-platform: ${polyMarketResult.rows[0].title.substring(0, 40)}... (${crossArb.quality}, ${crossArb.netSpreadPct.toFixed(2)}%)`);
        }
      } catch (err) {
        if (stats.errors.length < 10) {
          stats.errors.push(`Failed to process pair ${polySlug}/${kalshiTicker}: ${err}`);
        }
      }
    }
    
    console.log(`   Created ${pairsCreated} market pairs`);
    
    // 5. Check for volume spikes (Polymarket only - uses candlestick API)
    console.log('📊 Checking for volume spikes...');
    try {
      // Only check high-volume markets with token IDs
      const marketsToCheck = highVolumeMarkets
        .filter(({ market }) => market.side_a?.id)
        .slice(0, 50) // Limit to top 50 to respect rate limits
        .map(({ market, id }) => ({
          id,
          tokenId: market.side_a.id,
          title: market.title,
        }));
      
      const volumeAlerts = await checkVolumeSpikes(marketsToCheck);
      stats.volumeAlerts = volumeAlerts.length;
      
      if (volumeAlerts.length > 0) {
        console.log(`   🔔 ${volumeAlerts.length} volume spike(s) detected:`);
        volumeAlerts.slice(0, 5).forEach(alert => {
          console.log(`      ${alert.title.substring(0, 40)}... (${alert.multiplier.toFixed(1)}x avg)`);
        });
      } else {
        console.log('   No significant volume spikes detected');
      }
    } catch (err) {
      stats.errors.push(`Volume spike check failed: ${err}`);
      console.warn('   ⚠️ Volume spike check failed:', err);
    }
    
    // 6. Close stale arbs
    stats.arbsClosed = await closeStaleArbs(10);
    if (stats.arbsClosed > 0) {
      console.log(`   Closed ${stats.arbsClosed} stale arbs`);
    }
    
    // Update sync status
    await query(
      `UPDATE sync_status SET 
        completed_at = NOW(), 
        status = 'completed',
        markets_synced = $1,
        arbs_detected = $2
       WHERE id = $3`,
      [stats.marketsUpserted, stats.arbsDetected, syncId]
    );
    
    console.log(`\n✅ Sync completed: ${stats.marketsUpserted} markets, ${stats.snapshotsTaken} snapshots, ${stats.arbsDetected} arbs, ${stats.volumeAlerts} volume alerts`);
    if (stats.errors.length > 0) {
      console.log(`⚠️  ${stats.errors.length} errors occurred`);
      stats.errors.slice(0, 3).forEach(e => console.log(`   - ${e}`));
    }
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.errors.push(errorMsg);
    
    await query(
      `UPDATE sync_status SET 
        completed_at = NOW(), 
        status = 'failed',
        error_message = $1
       WHERE id = $2`,
      [errorMsg, syncId]
    );
    
    console.error('❌ Sync failed:', error);
  }
  
  return stats;
}

/**
 * Run sync job continuously
 */
async function runSyncJob(): Promise<void> {
  console.log('🚀 Starting Prediction Market Scanner sync job');
  console.log(`📍 Sync interval: ${SYNC_INTERVAL_MS / 1000 / 60} minutes`);
  
  // Initial sync
  await syncMarkets();
  
  // Schedule recurring syncs
  setInterval(async () => {
    await syncMarkets();
  }, SYNC_INTERVAL_MS);
  
  // Keep process alive
  console.log('\n⏰ Waiting for next sync...');
}

// Run if executed directly
if (require.main === module) {
  runSyncJob().catch(console.error);
}

export { syncMarkets, runSyncJob };
