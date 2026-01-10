import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface MarketDetailRow {
  id: number;
  platform: string;
  platform_id: string;
  event_id: string | null;
  title: string;
  category: string | null;
  sport: string | null;
  status: string;
  resolution_date: string | null;
  outcome: string | null;
  token_id_a: string | null;
  token_id_b: string | null;
  created_at: string;
  updated_at: string;
}

interface PriceSnapshotRow {
  snapshot_at: string;
  yes_price: string;
  no_price: string;
  yes_bid: string | null;
  yes_ask: string | null;
  no_bid: string | null;
  no_ask: string | null;
  volume_24h: string | null;
  volume_all_time: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const marketId = parseInt(params.id);
    if (isNaN(marketId)) {
      return NextResponse.json({ error: 'Invalid market ID' }, { status: 400 });
    }

    // Fetch market details
    const marketResult = await query<MarketDetailRow>(
      `SELECT * FROM markets WHERE id = $1`,
      [marketId]
    );

    if (marketResult.rows.length === 0) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    const market = marketResult.rows[0];

    // Get time range from query params (default: last 7 days)
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '7');
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    // Fetch price history
    const snapshotsResult = await query<PriceSnapshotRow>(
      `SELECT 
        snapshot_at,
        yes_price,
        no_price,
        yes_bid,
        yes_ask,
        no_bid,
        no_ask,
        volume_24h,
        volume_all_time
      FROM price_snapshots 
      WHERE market_id = $1 
        AND snapshot_at >= $2 
        AND snapshot_at <= $3
      ORDER BY snapshot_at ASC`,
      [marketId, startDate.toISOString(), endDate.toISOString()]
    );

    // Get latest snapshot for current prices
    const latestResult = await query<PriceSnapshotRow>(
      `SELECT 
        snapshot_at,
        yes_price,
        no_price,
        yes_bid,
        yes_ask,
        no_bid,
        no_ask,
        volume_24h,
        volume_all_time
      FROM price_snapshots 
      WHERE market_id = $1 
      ORDER BY snapshot_at DESC 
      LIMIT 1`,
      [marketId]
    );

    // Build external link
    let externalUrl: string | null = null;
    if (market.platform === 'polymarket') {
      externalUrl = `https://polymarket.com/event/${market.platform_id}`;
    } else if (market.platform === 'kalshi') {
      externalUrl = `https://kalshi.com/markets/${market.platform_id}`;
    }

    return NextResponse.json({
      market: {
        ...market,
        external_url: externalUrl,
      },
      current: latestResult.rows[0] || null,
      history: snapshotsResult.rows,
      timeRange: {
        days,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        snapshotCount: snapshotsResult.rows.length,
      },
    });
  } catch (error) {
    console.error('Market detail API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market details' },
      { status: 500 }
    );
  }
}
