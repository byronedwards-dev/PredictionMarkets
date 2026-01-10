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

    const markets = marketStats.rows[0];
    const arbs = arbStats.rows[0];
    const sync = lastSync.rows[0];

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
        startedAt: sync.started_at,
        completedAt: sync.completed_at,
        status: sync.status,
        marketsSynced: sync.markets_synced,
        arbsDetected: sync.arbs_detected,
      } : null,
      fees: feeConfig.rows.map(f => ({
        platform: f.platform,
        takerFeePct: parseFloat(f.taker_fee_pct),
        lastVerified: f.last_verified_at,
      })),
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
