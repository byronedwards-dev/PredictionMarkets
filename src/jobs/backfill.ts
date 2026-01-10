/**
 * Historical Data Backfill System
 * 
 * Fetches historical orderbook snapshots from Dome API for backtesting
 * Usage: npx tsx src/jobs/backfill.ts [--days 90] [--platform polymarket|kalshi] [--market-id <id>]
 */

import { query } from '../lib/db';
import dome, { PolymarketOrderbookSnapshot, KalshiOrderbookSnapshot } from '../lib/dome-api';

// ============================================
// Configuration
// ============================================

const BATCH_SIZE = 50; // Markets to process in parallel
const SNAPSHOTS_PER_REQUEST = 100; // Max snapshots per API request
const SNAPSHOT_INTERVAL_HOURS = 1; // How often to sample (1 = hourly snapshots)
const DELAY_BETWEEN_BATCHES_MS = 500; // Rate limit cushion

interface BackfillOptions {
  days: number;
  platform?: 'polymarket' | 'kalshi';
  marketId?: number;
  dryRun?: boolean;
}

interface BackfillProgress {
  totalMarkets: number;
  processedMarkets: number;
  totalSnapshots: number;
  errors: string[];
  startTime: Date;
}

// ============================================
// Database: Backfill Tracking
// ============================================

async function ensureBackfillTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS backfill_runs (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      platform TEXT,
      days_back INTEGER NOT NULL,
      markets_processed INTEGER DEFAULT 0,
      snapshots_inserted INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error_message TEXT
    )
  `);
  
  await query(`
    CREATE TABLE IF NOT EXISTS backfill_market_progress (
      id SERIAL PRIMARY KEY,
      backfill_run_id INTEGER REFERENCES backfill_runs(id),
      market_id INTEGER REFERENCES markets(id),
      platform TEXT NOT NULL,
      oldest_snapshot_at TIMESTAMPTZ,
      newest_snapshot_at TIMESTAMPTZ,
      snapshots_fetched INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      UNIQUE(backfill_run_id, market_id)
    )
  `);
}

async function createBackfillRun(days: number, platform?: string): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO backfill_runs (days_back, platform) VALUES ($1, $2) RETURNING id`,
    [days, platform || 'all']
  );
  return result.rows[0].id;
}

async function updateBackfillRun(
  runId: number, 
  marketsProcessed: number, 
  snapshotsInserted: number, 
  status: string,
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE backfill_runs SET 
      completed_at = CASE WHEN $4 IN ('completed', 'failed') THEN NOW() ELSE NULL END,
      markets_processed = $2,
      snapshots_inserted = $3,
      status = $4,
      error_message = $5
    WHERE id = $1`,
    [runId, marketsProcessed, snapshotsInserted, status, errorMessage]
  );
}

// ============================================
// Polymarket Backfill
// ============================================

async function backfillPolymarketSnapshots(
  marketId: number,
  tokenId: string,
  startTime: number,
  endTime: number
): Promise<number> {
  let snapshotsInserted = 0;
  let currentStart = startTime;
  
  while (currentStart < endTime) {
    // Fetch a chunk of snapshots
    const chunkEnd = Math.min(currentStart + (24 * 60 * 60 * 1000), endTime); // 1 day chunks
    
    try {
      const response = await dome.polymarket.getOrderbooks({
        token_id: tokenId,
        start_time: currentStart,
        end_time: chunkEnd,
        limit: SNAPSHOTS_PER_REQUEST,
      });
      
      for (const snapshot of response.snapshots) {
        // Parse orderbook to get best bid/ask
        const bestBid = snapshot.bids.length > 0 
          ? parseFloat(snapshot.bids[0].price) 
          : 0;
        const bestAsk = snapshot.asks.length > 0 
          ? parseFloat(snapshot.asks[0].price) 
          : 1;
        const bidSize = snapshot.bids.length > 0 
          ? parseFloat(snapshot.bids[0].size) 
          : 0;
        
        // Insert snapshot (ignore duplicates)
        await query(
          `INSERT INTO price_snapshots (
            market_id, yes_price, no_price, yes_bid, yes_ask, 
            no_bid, no_ask, yes_bid_size, no_bid_size, snapshot_at, is_backfill
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0), true)
          ON CONFLICT DO NOTHING`,
          [
            marketId,
            bestBid,                    // yes_price (mid)
            1 - bestAsk,                // no_price
            bestBid,                    // yes_bid
            bestAsk,                    // yes_ask  
            1 - bestAsk,                // no_bid
            1 - bestBid,                // no_ask
            bidSize,                    // yes_bid_size
            0,                          // no_bid_size (would need separate token)
            snapshot.timestamp,
          ]
        );
        snapshotsInserted++;
      }
      
      // Move to next chunk
      if (response.pagination.has_more) {
        // If there's more in this chunk, continue from last timestamp
        const lastTimestamp = response.snapshots[response.snapshots.length - 1]?.timestamp || chunkEnd;
        currentStart = lastTimestamp + 1;
      } else {
        currentStart = chunkEnd;
      }
      
    } catch (error: any) {
      console.warn(`  ⚠️  Error fetching Polymarket orderbooks: ${error.message}`);
      currentStart = chunkEnd; // Skip to next chunk on error
    }
  }
  
  return snapshotsInserted;
}

// ============================================
// Kalshi Backfill
// ============================================

async function backfillKalshiSnapshots(
  marketId: number,
  ticker: string,
  startTime: number,
  endTime: number
): Promise<number> {
  let snapshotsInserted = 0;
  let currentStart = startTime;
  
  while (currentStart < endTime) {
    const chunkEnd = Math.min(currentStart + (24 * 60 * 60 * 1000), endTime);
    
    try {
      const response = await dome.kalshi.getOrderbooks({
        ticker,
        start_time: currentStart,
        end_time: chunkEnd,
        limit: SNAPSHOTS_PER_REQUEST,
      });
      
      for (const snapshot of response.snapshots) {
        // Parse Kalshi orderbook (cents)
        const yesBids = snapshot.orderbook.yes || [];
        const yesAsks = snapshot.orderbook.no || []; // In Kalshi, No is opposite of Yes
        
        const bestYesBid = yesBids.length > 0 ? yesBids[0][0] / 100 : 0;
        const bestYesAsk = yesAsks.length > 0 ? (100 - yesAsks[0][0]) / 100 : 1;
        const bidSize = yesBids.length > 0 ? yesBids[0][1] : 0;
        
        await query(
          `INSERT INTO price_snapshots (
            market_id, yes_price, no_price, yes_bid, yes_ask,
            no_bid, no_ask, yes_bid_size, no_bid_size, snapshot_at, is_backfill
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0), true)
          ON CONFLICT DO NOTHING`,
          [
            marketId,
            (bestYesBid + bestYesAsk) / 2,  // yes_price (mid)
            1 - (bestYesBid + bestYesAsk) / 2, // no_price
            bestYesBid,
            bestYesAsk,
            1 - bestYesAsk,
            1 - bestYesBid,
            bidSize,
            0,
            snapshot.timestamp,
          ]
        );
        snapshotsInserted++;
      }
      
      if (response.pagination.has_more) {
        const lastTimestamp = response.snapshots[response.snapshots.length - 1]?.timestamp || chunkEnd;
        currentStart = lastTimestamp + 1;
      } else {
        currentStart = chunkEnd;
      }
      
    } catch (error: any) {
      console.warn(`  ⚠️  Error fetching Kalshi orderbooks: ${error.message}`);
      currentStart = chunkEnd;
    }
  }
  
  return snapshotsInserted;
}

// ============================================
// Main Backfill Logic
// ============================================

async function runBackfill(options: BackfillOptions): Promise<BackfillProgress> {
  console.log('\n🔄 Starting Historical Data Backfill');
  console.log(`   Days: ${options.days}`);
  console.log(`   Platform: ${options.platform || 'all'}`);
  if (options.marketId) console.log(`   Market ID: ${options.marketId}`);
  console.log('');
  
  await ensureBackfillTable();
  
  const progress: BackfillProgress = {
    totalMarkets: 0,
    processedMarkets: 0,
    totalSnapshots: 0,
    errors: [],
    startTime: new Date(),
  };
  
  // Calculate time range
  const endTime = Date.now();
  const startTime = endTime - (options.days * 24 * 60 * 60 * 1000);
  
  // Create backfill run record
  const runId = await createBackfillRun(options.days, options.platform);
  console.log(`📋 Created backfill run #${runId}\n`);
  
  try {
    // Get markets to backfill
    let marketQuery = `
      SELECT id, platform, platform_id, title, token_id_a, token_id_b 
      FROM markets 
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (options.platform) {
      marketQuery += ` AND platform = $${paramIndex++}`;
      params.push(options.platform);
    }
    
    if (options.marketId) {
      marketQuery += ` AND id = $${paramIndex++}`;
      params.push(options.marketId);
    }
    
    // Only include Polymarket markets that have token IDs (needed for orderbook lookup)
    marketQuery += ` AND (platform != 'polymarket' OR token_id_a IS NOT NULL)`;
    
    marketQuery += ` ORDER BY id`;
    
    const marketsResult = await query<{
      id: number;
      platform: string;
      platform_id: string;
      title: string;
      token_id_a: string | null;
      token_id_b: string | null;
    }>(marketQuery, params);
    
    progress.totalMarkets = marketsResult.rows.length;
    console.log(`📊 Found ${progress.totalMarkets} markets to backfill\n`);
    
    if (progress.totalMarkets === 0) {
      console.log('⚠️  No markets found. Run sync first to populate markets.');
      await updateBackfillRun(runId, 0, 0, 'completed', 'No markets found');
      return progress;
    }
    
    // Process markets in batches
    for (let i = 0; i < marketsResult.rows.length; i += BATCH_SIZE) {
      const batch = marketsResult.rows.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (market) => {
        const shortTitle = market.title.length > 40 
          ? market.title.substring(0, 40) + '...' 
          : market.title;
        
        try {
          let snapshots = 0;
          
          if (market.platform === 'polymarket' && market.token_id_a) {
            // Use the actual token_id for Polymarket orderbook lookups
            snapshots = await backfillPolymarketSnapshots(
              market.id,
              market.token_id_a, // Use Yes token ID
              startTime,
              endTime
            );
          } else if (market.platform === 'kalshi') {
            snapshots = await backfillKalshiSnapshots(
              market.id,
              market.platform_id,
              startTime,
              endTime
            );
          }
          
          progress.totalSnapshots += snapshots;
          progress.processedMarkets++;
          
          if (snapshots > 0) {
            console.log(`  ✓ ${market.platform}:${market.id} - ${snapshots} snapshots - ${shortTitle}`);
          }
          
        } catch (error: any) {
          const errorMsg = `Market ${market.id}: ${error.message}`;
          progress.errors.push(errorMsg);
          console.error(`  ✗ ${market.platform}:${market.id} - ${error.message}`);
        }
      }));
      
      // Update progress
      await updateBackfillRun(runId, progress.processedMarkets, progress.totalSnapshots, 'running');
      
      // Small delay between batches to be nice to the API
      if (i + BATCH_SIZE < marketsResult.rows.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
      
      // Progress update
      const pct = Math.round((progress.processedMarkets / progress.totalMarkets) * 100);
      console.log(`\n📈 Progress: ${progress.processedMarkets}/${progress.totalMarkets} markets (${pct}%), ${progress.totalSnapshots} snapshots\n`);
    }
    
    // Complete
    await updateBackfillRun(runId, progress.processedMarkets, progress.totalSnapshots, 'completed');
    
    const duration = ((Date.now() - progress.startTime.getTime()) / 1000).toFixed(1);
    console.log('\n✅ Backfill Complete!');
    console.log(`   Duration: ${duration}s`);
    console.log(`   Markets: ${progress.processedMarkets}/${progress.totalMarkets}`);
    console.log(`   Snapshots: ${progress.totalSnapshots}`);
    if (progress.errors.length > 0) {
      console.log(`   Errors: ${progress.errors.length}`);
    }
    
  } catch (error: any) {
    await updateBackfillRun(runId, progress.processedMarkets, progress.totalSnapshots, 'failed', error.message);
    throw error;
  }
  
  return progress;
}

// ============================================
// CLI Interface
// ============================================

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {
    days: 30, // Default: 30 days
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--days':
      case '-d':
        options.days = parseInt(args[++i]) || 30;
        break;
      case '--platform':
      case '-p':
        options.platform = args[++i] as 'polymarket' | 'kalshi';
        break;
      case '--market-id':
      case '-m':
        options.marketId = parseInt(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Historical Data Backfill

Usage: npx tsx src/jobs/backfill.ts [options]

Options:
  --days, -d <number>       Number of days to backfill (default: 30)
  --platform, -p <name>     Platform filter: polymarket or kalshi
  --market-id, -m <id>      Backfill single market by database ID
  --dry-run                 Show what would be backfilled without fetching
  --help, -h                Show this help message

Examples:
  npx tsx src/jobs/backfill.ts --days 90
  npx tsx src/jobs/backfill.ts --platform polymarket --days 30
  npx tsx src/jobs/backfill.ts --market-id 42 --days 7
        `);
        process.exit(0);
    }
  }
  
  return options;
}

// Run if executed directly
const isMainModule = process.argv[1]?.includes('backfill');
if (isMainModule) {
  const options = parseArgs();
  
  runBackfill(options)
    .then(() => {
      console.log('\n👋 Backfill finished\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Backfill failed:', error);
      process.exit(1);
    });
}

export { runBackfill };
export type { BackfillOptions, BackfillProgress };
