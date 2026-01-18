/**
 * Railway Worker Entry Point
 * 
 * This is a standalone sync worker that runs continuously on Railway.
 * It syncs market data every 5 minutes and logs to stdout.
 */

import { query } from './lib/db';
import dome, { PolymarketMarket, KalshiMarket } from './lib/dome-api';
import { detectSingleMarketArb, trackArbPersistence, closeStaleArbs, PriceSnapshot } from './lib/arb-detection';
import { loadFees } from './lib/fees';

// Configuration
const SYNC_INTERVAL_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES || '5') * 60 * 1000);
const BATCH_SIZE = 10;
const API_PAGE_SIZE = 100;
const MAX_PAGES = 2; // 200 markets per platform
const MIN_VOLUME_FOR_PRICE_FETCH = 5000;

console.log('🚂 Railway Worker Starting...');
console.log(`📍 Sync interval: ${SYNC_INTERVAL_MS / 1000 / 60} minutes`);
console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'NOT SET!'}`);
console.log(`🔑 API Key: ${process.env.DOME_API_KEY ? 'Set' : 'NOT SET!'}`);

interface SyncStats {
  marketsUpserted: number;
  snapshotsTaken: number;
  arbsDetected: number;
  errors: string[];
}

function normalizeProbability(price: number): number {
  const normalized = price >= 1 ? price / 100 : price;
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Process items in batches
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
 * Upsert a Polymarket market
 */
async function upsertPolymarketMarket(market: PolymarketMarket): Promise<number> {
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
      market.market_slug,
      market.condition_id,
      market.title,
      market.tags.length > 0 ? market.tags[0] : null,
      sport,
      market.status,
      market.end_time ? new Date(market.end_time * 1000) : null,
      market.winning_side,
      market.side_a?.id || null,
      market.side_b?.id || null,
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Upsert a Kalshi market
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
      market.market_ticker,
      market.event_ticker,
      market.title,
      null,
      null,
      market.status,
      market.end_time ? new Date(market.end_time * 1000) : null,
      market.result,
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Insert price snapshot
 */
async function insertSnapshot(
  marketId: number, 
  yesPrice: number, 
  noPrice: number,
  volume24h: number,
  volumeAllTime: number
): Promise<void> {
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
      yesPrice * 0.99,
      yesPrice * 1.01,
      noPrice * 0.99,
      noPrice * 1.01,
      10000, 10000, 10000, 10000,
      volume24h,
      volumeAllTime,
    ]
  );
}

/**
 * Get best available volume metric from a Polymarket market
 */
function getBestVolume(market: PolymarketMarket): number {
  if (market.volume_total > 0) return market.volume_total;
  if (market.volume_1_year > 0) return market.volume_1_year;
  if (market.volume_1_month > 0) return market.volume_1_month;
  if (market.volume_1_week > 0) return market.volume_1_week;
  return 0;
}

/**
 * Main sync function
 */
async function syncMarkets(): Promise<SyncStats> {
  const stats: SyncStats = {
    marketsUpserted: 0,
    snapshotsTaken: 0,
    arbsDetected: 0,
    errors: [],
  };
  
  const startTime = Date.now();
  console.log(`\n🔄 [${new Date().toISOString()}] Starting sync...`);
  
  // Record sync start in database
  let syncId: number | null = null;
  try {
    const syncResult = await query<{ id: number }>(
      `INSERT INTO sync_status (sync_type, status) VALUES ('railway_worker', 'running') RETURNING id`
    );
    syncId = syncResult.rows[0].id;
  } catch (err) {
    console.warn('   ⚠️ Could not record sync start:', err);
  }
  
  try {
    await loadFees();
    
    // 1. Fetch Polymarket markets
    let polyMarkets: PolymarketMarket[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await dome.polymarket.getMarkets({
        status: 'open',
        min_volume: 5000,
        limit: API_PAGE_SIZE,
        offset: page * API_PAGE_SIZE,
      });
      polyMarkets.push(...response.markets);
      if (response.markets.length < API_PAGE_SIZE || !response.pagination.has_more) break;
    }
    console.log(`   📊 Fetched ${polyMarkets.length} Polymarket markets`);
    
    // 2. Fetch Kalshi markets
    let kalshiMarkets: KalshiMarket[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await dome.kalshi.getMarkets({
        status: 'open',
        min_volume: 1000,
        limit: API_PAGE_SIZE,
        offset: page * API_PAGE_SIZE,
      });
      kalshiMarkets.push(...response.markets);
      if (response.markets.length < API_PAGE_SIZE || !response.pagination.has_more) break;
    }
    console.log(`   📊 Fetched ${kalshiMarkets.length} Kalshi markets`);
    
    // 3. Upsert Polymarket markets and fetch prices
    const polyMarketsWithIds: Array<{ market: PolymarketMarket; id: number }> = [];
    for (const market of polyMarkets) {
      try {
        const id = await upsertPolymarketMarket(market);
        polyMarketsWithIds.push({ market, id });
        stats.marketsUpserted++;
      } catch (err) {
        if (stats.errors.length < 5) stats.errors.push(`Upsert failed: ${err}`);
      }
    }
    
    // 4. Fetch prices for all Polymarket markets (already filtered by Dome's min_volume: 5000)
    // All markets already passed Dome's min_volume filter, so fetch prices for all
    const highVolumeMarkets = polyMarketsWithIds;
    
    let pricesFetched = 0;
    await processBatch(highVolumeMarkets, BATCH_SIZE, async ({ market, id }) => {
      try {
        const [sideAPrice, sideBPrice] = await Promise.all([
          dome.polymarket.getMarketPrice(market.side_a.id),
          dome.polymarket.getMarketPrice(market.side_b.id),
        ]);
        
        // Use volume_1_week/7 as 24h estimate, best available as all-time
        const vol24h = market.volume_1_week ? market.volume_1_week / 7 : 0;
        const volumeAllTime = getBestVolume(market);
        await insertSnapshot(id, sideAPrice.price, sideBPrice.price, vol24h, volumeAllTime);
        stats.snapshotsTaken++;
        pricesFetched++;
        
        // Detect arbs
        const snapshot: PriceSnapshot = {
          marketId: id,
          platform: 'polymarket',
          yesPrice: sideAPrice.price,
          noPrice: sideBPrice.price,
          yesBid: sideAPrice.price * 0.99,
          yesAsk: sideAPrice.price * 1.01,
          noBid: sideBPrice.price * 0.99,
          noAsk: sideBPrice.price * 1.01,
          yesBidSize: 10000, yesAskSize: 10000, noBidSize: 10000, noAskSize: 10000,
          volume24h: market.volume_1_week / 7,
        };
        
        const arb = detectSingleMarketArb(snapshot, market.title);
        if (arb) {
          await trackArbPersistence(arb);
          stats.arbsDetected++;
        }
      } catch (err) {
        if (stats.errors.length < 10) stats.errors.push(`Price fetch: ${err}`);
      }
    });
    
    // 5. Process Kalshi markets (they include prices)
    await processBatch(kalshiMarkets, BATCH_SIZE * 2, async (market) => {
      try {
        const id = await upsertKalshiMarket(market);
        stats.marketsUpserted++;
        
        // Kalshi has actual 24h volume and total volume
        const kalshiYes = normalizeProbability(market.last_price);
        const kalshiNo = 1 - kalshiYes;
        await insertSnapshot(id, kalshiYes, kalshiNo, market.volume_24h, market.volume);
        stats.snapshotsTaken++;
        
        const snapshot: PriceSnapshot = {
          marketId: id,
          platform: 'kalshi',
          yesPrice: kalshiYes,
          noPrice: kalshiNo,
          yesBid: kalshiYes * 0.99,
          yesAsk: kalshiYes * 1.01,
          noBid: kalshiNo * 0.99,
          noAsk: kalshiNo * 1.01,
          yesBidSize: 5000, yesAskSize: 5000, noBidSize: 5000, noAskSize: 5000,
          volume24h: market.volume_24h,
        };
        
        const arb = detectSingleMarketArb(snapshot, market.title);
        if (arb) {
          await trackArbPersistence(arb);
          stats.arbsDetected++;
        }
      } catch (err) {
        if (stats.errors.length < 10) stats.errors.push(`Kalshi: ${err}`);
      }
    });
    
    // 6. Close stale arbs
    await closeStaleArbs(10);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Sync complete in ${duration}s: ${stats.marketsUpserted} markets, ${stats.snapshotsTaken} snapshots, ${stats.arbsDetected} arbs`);
    if (stats.errors.length > 0) {
      console.log(`   ⚠️  ${stats.errors.length} errors`);
    }
    
    // Record sync completion
    if (syncId) {
      try {
        await query(
          `UPDATE sync_status SET 
            completed_at = NOW(), 
            status = 'completed',
            markets_synced = $1,
            arbs_detected = $2
           WHERE id = $3`,
          [stats.marketsUpserted, stats.arbsDetected, syncId]
        );
      } catch (err) {
        console.warn('   ⚠️ Could not record sync completion:', err);
      }
    }
    
  } catch (error) {
    console.error('❌ Sync failed:', error);
    stats.errors.push(String(error));
    
    // Record sync failure
    if (syncId) {
      try {
        await query(
          `UPDATE sync_status SET 
            completed_at = NOW(), 
            status = 'failed',
            error_message = $1
           WHERE id = $2`,
          [String(error), syncId]
        );
      } catch (err) {
        console.warn('   ⚠️ Could not record sync failure:', err);
      }
    }
  }
  
  return stats;
}

/**
 * Main loop
 */
async function main() {
  console.log('🚂 Worker ready, starting first sync...\n');
  
  // Initial sync
  await syncMarkets();
  
  // Schedule recurring syncs
  setInterval(async () => {
    await syncMarkets();
  }, SYNC_INTERVAL_MS);
  
  console.log(`\n⏰ Next sync in ${SYNC_INTERVAL_MS / 1000 / 60} minutes...`);
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Received SIGINT, shutting down...');
  process.exit(0);
});

// Start
main().catch((err) => {
  console.error('💥 Worker crashed:', err);
  process.exit(1);
});
