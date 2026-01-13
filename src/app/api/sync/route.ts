import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { detectCrossPlatformArb, trackArbPersistence, closeStaleArbs, PriceSnapshot } from '@/lib/arb-detection';
import { loadFees } from '@/lib/fees';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// GET: Check sync status
export async function GET() {
  try {
    // Get the most recent sync status
    const result = await query<{
      id: number;
      sync_type: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      markets_synced: number | null;
      arbs_detected: number | null;
      error_message: string | null;
    }>(`
      SELECT * FROM sync_status 
      ORDER BY started_at DESC 
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({
        status: 'never_run',
        message: 'No sync has been run yet',
      });
    }

    const sync = result.rows[0];
    const isRunning = sync.status === 'running';
    const runningSince = isRunning 
      ? Math.round((Date.now() - new Date(sync.started_at).getTime()) / 1000)
      : null;

    return NextResponse.json({
      id: sync.id,
      status: sync.status,
      startedAt: sync.started_at,
      completedAt: sync.completed_at,
      marketsSynced: sync.markets_synced,
      arbsDetected: sync.arbs_detected,
      errorMessage: sync.error_message,
      isRunning,
      runningSince, // seconds
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}

// Helper to get latest snapshot
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

// POST: Quick arb re-evaluation (fast) or request full sync
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const quickMode = body.quick !== false; // Default to quick mode

    // Quick mode: Just re-evaluate existing pairs using cached price data
    if (quickMode) {
      await loadFees();
      
      // Get all market pairs (both from Dome API and user-linked)
      const pairs = await query<{
        pair_id: number;
        poly_market_id: number;
        kalshi_market_id: number;
        poly_title: string;
        kalshi_title: string;
      }>(`
        SELECT 
          mp.id as pair_id,
          mp.poly_market_id,
          mp.kalshi_market_id,
          pm.title as poly_title,
          km.title as kalshi_title
        FROM market_pairs mp
        JOIN markets pm ON pm.id = mp.poly_market_id
        JOIN markets km ON km.id = mp.kalshi_market_id
        WHERE pm.status = 'open' AND km.status = 'open'
      `);

      let arbsFound = 0;
      for (const pair of pairs.rows) {
        const polySnapshot = await getLatestSnapshot(pair.poly_market_id);
        const kalshiSnapshot = await getLatestSnapshot(pair.kalshi_market_id);
        
        if (!polySnapshot || !kalshiSnapshot) continue;
        
        const crossArb = detectCrossPlatformArb(
          polySnapshot,
          kalshiSnapshot,
          pair.pair_id,
          pair.poly_title,
          pair.kalshi_title
        );
        
        if (crossArb) {
          await trackArbPersistence(crossArb);
          arbsFound++;
        }
      }

      // Close stale arbs
      const closed = await closeStaleArbs(10);

      // Update sync status
      await query(
        `INSERT INTO sync_status (sync_type, status, completed_at, markets_synced, arbs_detected)
         VALUES ('quick_arb_check', 'completed', NOW(), $1, $2)`,
        [pairs.rows.length, arbsFound]
      );

      return NextResponse.json({
        success: true,
        mode: 'quick',
        pairsChecked: pairs.rows.length,
        arbsFound,
        arbsClosed: closed,
      });
    }

    // Full sync mode - just record the request (needs worker)
    const runningCheck = await query<{ id: number; started_at: string }>(`
      SELECT id, started_at FROM sync_status 
      WHERE status = 'running' 
      AND started_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `);

    if (runningCheck.rows.length > 0) {
      return NextResponse.json({
        success: false,
        message: 'A sync is already running',
      }, { status: 409 });
    }

    await query(
      `INSERT INTO sync_status (sync_type, status) VALUES ('manual_trigger', 'requested')`
    );

    return NextResponse.json({
      success: true,
      mode: 'full',
      message: 'Full sync requested. Run `npm run jobs:sync` if not already running.',
    });

  } catch (error) {
    console.error('Sync trigger error:', error);
    return NextResponse.json(
      { error: 'Failed to trigger sync' },
      { status: 500 }
    );
  }
}
