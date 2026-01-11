import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '24');
    const minMultiplier = parseFloat(searchParams.get('minMultiplier') || '1.5');

    // Get recent volume alerts
    const alerts = await query<{
      id: number;
      market_id: number;
      title: string;
      platform: string;
      volume_usd: string;
      rolling_avg_7d: string;
      multiplier: string;
      z_score: string;
      alert_at: Date;
    }>(
      `SELECT va.id, va.market_id, m.title, m.platform, 
              va.volume_usd, va.rolling_avg_7d, va.multiplier, va.z_score, va.alert_at
       FROM volume_alerts va
       JOIN markets m ON m.id = va.market_id
       WHERE va.alert_at > NOW() - INTERVAL '${hours} hours'
         AND va.multiplier >= $1
       ORDER BY va.multiplier DESC, va.alert_at DESC
       LIMIT 100`,
      [minMultiplier]
    );

    // Get summary stats
    const stats = await query<{
      total_alerts: string;
      avg_multiplier: string;
      max_multiplier: string;
      unique_markets: string;
    }>(
      `SELECT 
         COUNT(*)::TEXT as total_alerts,
         AVG(multiplier)::TEXT as avg_multiplier,
         MAX(multiplier)::TEXT as max_multiplier,
         COUNT(DISTINCT market_id)::TEXT as unique_markets
       FROM volume_alerts
       WHERE alert_at > NOW() - INTERVAL '${hours} hours'`
    );

    const summary = stats.rows[0];

    return NextResponse.json({
      alerts: alerts.rows.map(row => ({
        id: row.id,
        marketId: row.market_id,
        title: row.title,
        platform: row.platform,
        volumeUsd: parseFloat(row.volume_usd),
        rollingAvg: parseFloat(row.rolling_avg_7d),
        multiplier: parseFloat(row.multiplier),
        zScore: parseFloat(row.z_score || '0'),
        alertedAt: row.alert_at,
      })),
      summary: {
        totalAlerts: parseInt(summary.total_alerts) || 0,
        avgMultiplier: parseFloat(summary.avg_multiplier) || 0,
        maxMultiplier: parseFloat(summary.max_multiplier) || 0,
        uniqueMarkets: parseInt(summary.unique_markets) || 0,
      },
      filters: {
        hours,
        minMultiplier,
      },
    });
  } catch (error) {
    console.error('Volume alerts API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch volume alerts' },
      { status: 500 }
    );
  }
}
