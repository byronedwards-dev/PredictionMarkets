import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    // Get market counts
    const marketStats = await query<{
      total: string;
      polymarket: string;
      kalshi: string;
      with_arb: string;
    }>(`
      SELECT 
        COUNT(*)::TEXT as total,
        COUNT(*) FILTER (WHERE platform = 'polymarket')::TEXT as polymarket,
        COUNT(*) FILTER (WHERE platform = 'kalshi')::TEXT as kalshi,
        COUNT(DISTINCT a.market_id)::TEXT as with_arb
      FROM markets m
      LEFT JOIN arb_opportunities a ON a.market_id = m.id AND a.resolved_at IS NULL
      WHERE m.status = 'open'
    `);

    // Get platform breakdown with single vs multi-outcome
    const platformBreakdown = await query<{
      platform: string;
      total_markets: string;
      total_events: string;
      single_outcome_events: string;
      multi_outcome_events: string;
      markets_in_multi: string;
    }>(`
      WITH event_counts AS (
        SELECT 
          platform,
          COALESCE(event_id, platform_id) as event_key,
          COUNT(*) as market_count
        FROM markets
        WHERE status = 'open'
        GROUP BY platform, COALESCE(event_id, platform_id)
      )
      SELECT 
        platform,
        SUM(market_count)::TEXT as total_markets,
        COUNT(*)::TEXT as total_events,
        COUNT(*) FILTER (WHERE market_count = 1)::TEXT as single_outcome_events,
        COUNT(*) FILTER (WHERE market_count > 1)::TEXT as multi_outcome_events,
        SUM(market_count) FILTER (WHERE market_count > 1)::TEXT as markets_in_multi
      FROM event_counts
      GROUP BY platform
    `);

    // Get category breakdown - normalize categories across platforms
    const categoryBreakdown = await query<{
      category: string;
      platform: string;
      count: string;
    }>(`
      SELECT 
        COALESCE(
          CASE 
            WHEN category IN ('Sports', 'Soccer', 'NFL Playoffs', 'CFB', 'Formula 1', 'Tennis') THEN 'Sports'
            WHEN category IN ('Politics', 'World Elections', 'Global Elections', 'US Election', 'Elections') THEN 'Politics'
            WHEN category IN ('Crypto', 'Bitcoin', 'Ethereum', 'Airdrops', 'Stablecoins') THEN 'Crypto'
            WHEN category IN ('Geopolitics', 'Foreign Policy', 'Trade War', 'Iran', 'Israel', 'Gaza', 'putin', 'Denmark', 'World') THEN 'Geopolitics'
            WHEN category IN ('Business', 'Finance', 'Macro Indicators', 'Fed Rates', 'Public Sales') THEN 'Finance'
            WHEN category IN ('Culture', 'Movies', 'Awards', 'Celebrities', 'Games', 'Pokemon', 'video games', 'Entertainment') THEN 'Entertainment'
            WHEN category IN ('Tech', 'Gemini 3') THEN 'Tech'
            WHEN category IN ('Health') THEN 'Health'
            WHEN category IN ('Jerome Powell', 'Fed Rates') THEN 'Finance'
            WHEN category IN ('Brazil') THEN 'Politics'
            WHEN sport IS NOT NULL THEN 'Sports'
            ELSE 'Other'
          END,
          'Other'
        ) as category,
        platform,
        COUNT(*)::TEXT as count
      FROM markets
      WHERE status = 'open'
      GROUP BY 
        COALESCE(
          CASE 
            WHEN category IN ('Sports', 'Soccer', 'NFL Playoffs', 'CFB', 'Formula 1', 'Tennis') THEN 'Sports'
            WHEN category IN ('Politics', 'World Elections', 'Global Elections', 'US Election', 'Elections') THEN 'Politics'
            WHEN category IN ('Crypto', 'Bitcoin', 'Ethereum', 'Airdrops', 'Stablecoins') THEN 'Crypto'
            WHEN category IN ('Geopolitics', 'Foreign Policy', 'Trade War', 'Iran', 'Israel', 'Gaza', 'putin', 'Denmark', 'World') THEN 'Geopolitics'
            WHEN category IN ('Business', 'Finance', 'Macro Indicators', 'Fed Rates', 'Public Sales') THEN 'Finance'
            WHEN category IN ('Culture', 'Movies', 'Awards', 'Celebrities', 'Games', 'Pokemon', 'video games', 'Entertainment') THEN 'Entertainment'
            WHEN category IN ('Tech', 'Gemini 3') THEN 'Tech'
            WHEN category IN ('Health') THEN 'Health'
            WHEN category IN ('Jerome Powell', 'Fed Rates') THEN 'Finance'
            WHEN category IN ('Brazil') THEN 'Politics'
            WHEN sport IS NOT NULL THEN 'Sports'
            ELSE 'Other'
          END,
          'Other'
        ),
        platform
      ORDER BY count DESC
    `);

    // Get arb stats
    const arbStats = await query<{
      active: string;
      executable: string;
      thin: string;
      theoretical: string;
      avg_spread: string;
      total_deployable: string;
    }>(`
      SELECT 
        COUNT(*)::TEXT as active,
        COUNT(*) FILTER (WHERE quality = 'executable')::TEXT as executable,
        COUNT(*) FILTER (WHERE quality = 'thin')::TEXT as thin,
        COUNT(*) FILTER (WHERE quality = 'theoretical')::TEXT as theoretical,
        AVG(net_spread_pct)::TEXT as avg_spread,
        SUM(max_deployable_usd)::TEXT as total_deployable
      FROM arb_opportunities
      WHERE resolved_at IS NULL
    `);

    // Get last sync
    const lastSync = await query<{
      started_at: Date;
      completed_at: Date;
      status: string;
      markets_synced: number;
      arbs_detected: number;
    }>(`
      SELECT * FROM sync_status 
      ORDER BY started_at DESC 
      LIMIT 1
    `);

    // Get fee config
    const feeConfig = await query<{
      platform: string;
      taker_fee_pct: string;
      last_verified_at: Date;
    }>(`SELECT platform, taker_fee_pct, last_verified_at FROM platform_config`);

    // Get total snapshots count
    const snapshotStats = await query<{
      total: string;
      today: string;
      backfill: string;
    }>(`
      SELECT 
        COUNT(*)::TEXT as total,
        COUNT(*) FILTER (WHERE snapshot_at >= CURRENT_DATE)::TEXT as today,
        COUNT(*) FILTER (WHERE is_backfill = true)::TEXT as backfill
      FROM price_snapshots
    `);

    // Get event counts (unique event groupings)
    const eventStats = await query<{
      total_events: string;
      active_events: string;
      closed_events: string;
    }>(`
      SELECT 
        COUNT(DISTINCT COALESCE(event_id, platform_id))::TEXT as total_events,
        COUNT(DISTINCT COALESCE(event_id, platform_id)) FILTER (WHERE status = 'open')::TEXT as active_events,
        COUNT(DISTINCT COALESCE(event_id, platform_id)) FILTER (WHERE status != 'open')::TEXT as closed_events
      FROM markets
    `);

    const markets = marketStats.rows[0];
    const arbs = arbStats.rows[0];
    const sync = lastSync.rows[0];
    const snapshots = snapshotStats.rows[0];
    const events = eventStats.rows[0];

    // Build platform breakdown
    const platformData: Record<string, {
      totalMarkets: number;
      totalEvents: number;
      singleOutcome: number;
      multiOutcome: number;
      marketsInMulti: number;
    }> = {};
    
    for (const row of platformBreakdown.rows) {
      platformData[row.platform] = {
        totalMarkets: parseInt(row.total_markets) || 0,
        totalEvents: parseInt(row.total_events) || 0,
        singleOutcome: parseInt(row.single_outcome_events) || 0,
        multiOutcome: parseInt(row.multi_outcome_events) || 0,
        marketsInMulti: parseInt(row.markets_in_multi) || 0,
      };
    }

    // Build category breakdown
    const categories: Record<string, { polymarket: number; kalshi: number; total: number }> = {};
    for (const row of categoryBreakdown.rows) {
      if (!categories[row.category]) {
        categories[row.category] = { polymarket: 0, kalshi: 0, total: 0 };
      }
      const count = parseInt(row.count) || 0;
      categories[row.category][row.platform as 'polymarket' | 'kalshi'] = count;
      categories[row.category].total += count;
    }

    return NextResponse.json({
      markets: {
        total: parseInt(markets.total) || 0,
        polymarket: parseInt(markets.polymarket) || 0,
        kalshi: parseInt(markets.kalshi) || 0,
        withArb: parseInt(markets.with_arb) || 0,
      },
      arbs: {
        active: parseInt(arbs.active) || 0,
        executable: parseInt(arbs.executable) || 0,
        thin: parseInt(arbs.thin) || 0,
        theoretical: parseInt(arbs.theoretical) || 0,
        avgSpread: parseFloat(arbs.avg_spread) || 0,
        totalDeployable: parseFloat(arbs.total_deployable) || 0,
      },
      lastSync: sync ? {
        startedAt: sync.started_at ? new Date(sync.started_at).toISOString() : null,
        completedAt: sync.completed_at ? new Date(sync.completed_at).toISOString() : null,
        status: sync.status,
        marketsSynced: sync.markets_synced,
        arbsDetected: sync.arbs_detected,
      } : null,
      fees: feeConfig.rows.map(f => ({
        platform: f.platform,
        takerFeePct: parseFloat(f.taker_fee_pct),
        lastVerified: f.last_verified_at,
      })),
      snapshots: {
        total: parseInt(snapshots.total) || 0,
        today: parseInt(snapshots.today) || 0,
        backfill: parseInt(snapshots.backfill) || 0,
      },
      events: {
        total: parseInt(events.total_events) || 0,
        active: parseInt(events.active_events) || 0,
        closed: parseInt(events.closed_events) || 0,
      },
      platformBreakdown: platformData,
      categories,
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
