import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractEventName } from '@/lib/data-transforms';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface MarketRow {
  id: number;
  platform: string;
  platform_id: string;
  event_id: string | null;
  title: string;
  category: string | null;
  sport: string | null;
  status: string;
  yes_price: string | null;
  no_price: string | null;
  yes_bid: string | null;
  yes_ask: string | null;
  no_bid: string | null;
  no_ask: string | null;
  yes_bid_size: string | null;
  no_bid_size: string | null;
  volume_24h: string | null;
  volume_all_time: string | null;
  snapshot_at: string | null;
  gross_spread: string | null;
  arb_id: number | null;
  arb_quality: string | null;
  net_spread_pct: string | null;
  max_deployable_usd: string | null;
}

interface EventGroup {
  event_key: string;
  event_name: string;
  platform: string;
  sport: string | null;
  total_volume_24h: number;
  total_volume_all_time: number;
  market_count: number;
  has_arb: boolean;
  best_arb_spread: number | null;
  markets: MarketRow[];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const platform = searchParams.get('platform');
    const category = searchParams.get('category');
    const sport = searchParams.get('sport');
    const status = searchParams.get('status') || 'open';
    const minVolume = searchParams.get('minVolume');
    const hasArb = searchParams.get('hasArb');
    const groupByEvent = searchParams.get('groupByEvent') !== 'false'; // Default to grouped
    const hideExpired = searchParams.get('hideExpired') !== 'false'; // Default: hide markets past resolution date
    const limit = parseInt(searchParams.get('limit') || '200');
    const offset = parseInt(searchParams.get('offset') || '0');

    let sql = `
      SELECT 
        m.*,
        ps.yes_price,
        ps.no_price,
        ps.yes_bid,
        ps.yes_ask,
        ps.no_bid,
        ps.no_ask,
        ps.yes_bid_size,
        ps.no_bid_size,
        ps.volume_24h,
        ps.volume_all_time,
        ps.snapshot_at,
        (1 - COALESCE(ps.yes_bid, 0) - COALESCE(ps.no_bid, 0)) as gross_spread,
        a.id as arb_id,
        a.quality as arb_quality,
        a.net_spread_pct,
        a.max_deployable_usd
      FROM markets m
      LEFT JOIN LATERAL (
        SELECT * FROM price_snapshots 
        WHERE market_id = m.id 
        ORDER BY snapshot_at DESC 
        LIMIT 1
      ) ps ON true
      LEFT JOIN arb_opportunities a ON a.market_id = m.id AND a.resolved_at IS NULL
      WHERE 1=1
    `;
    
    const params: unknown[] = [];
    let paramIndex = 1;

    if (platform) {
      sql += ` AND m.platform = $${paramIndex++}`;
      params.push(platform);
    }

    if (category) {
      // Map normalized category names to database values
      const categoryMapping: Record<string, string[]> = {
        'Sports': ['Sports', 'Soccer', 'NFL Playoffs', 'CFB', 'Formula 1', 'Tennis'],
        'Politics': ['Politics', 'World Elections', 'Global Elections', 'US Election', 'Elections', 'Brazil'],
        'Crypto': ['Crypto', 'Bitcoin', 'Ethereum', 'Airdrops', 'Stablecoins'],
        'Geopolitics': ['Geopolitics', 'Foreign Policy', 'Trade War', 'Iran', 'Israel', 'Gaza', 'putin', 'Denmark', 'World'],
        'Finance': ['Finance', 'Business', 'Macro Indicators', 'Fed Rates', 'Public Sales', 'Jerome Powell'],
        'Entertainment': ['Entertainment', 'Culture', 'Movies', 'Awards', 'Celebrities', 'Games', 'Pokemon', 'video games'],
        'Tech': ['Tech', 'Gemini 3'],
        'Health': ['Health'],
      };
      
      const categoryValues = categoryMapping[category];
      if (categoryValues) {
        sql += ` AND (m.category = ANY($${paramIndex++}) OR (m.category IS NULL AND m.sport IS NOT NULL AND $${paramIndex++} = 'Sports'))`;
        params.push(categoryValues);
        params.push(category);
      } else if (category === 'Other') {
        sql += ` AND m.category IS NULL AND m.sport IS NULL`;
      }
    }

    if (sport) {
      sql += ` AND m.sport = $${paramIndex++}`;
      params.push(sport);
    }

    if (status) {
      sql += ` AND m.status = $${paramIndex++}`;
      params.push(status);
    }

    if (minVolume) {
      sql += ` AND ps.volume_24h >= $${paramIndex++}`;
      params.push(parseFloat(minVolume));
    }

    if (hasArb === 'true') {
      sql += ` AND a.id IS NOT NULL`;
    }

    // Filter out effectively resolved markets (price at ~0% or ~100%)
    // Markets with YES price >= 98% or <= 2% are essentially decided
    const hideResolved = searchParams.get('hideResolved') !== 'false';
    if (hideResolved && status === 'open') {
      sql += ` AND (ps.yes_price IS NULL OR (ps.yes_price > 0.02 AND ps.yes_price < 0.98))`;
    }

    // Filter out markets past their resolution date
    if (hideExpired) {
      sql += ` AND (m.resolution_date IS NULL OR m.resolution_date > NOW())`;
    }

    // Order by volume for initial fetch
    sql += ` ORDER BY ps.volume_24h DESC NULLS LAST`;
    sql += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await query<MarketRow>(sql, params);

    // Get total count
    let countSql = `
      SELECT COUNT(*) as total
      FROM markets m
      LEFT JOIN LATERAL (
        SELECT * FROM price_snapshots 
        WHERE market_id = m.id 
        ORDER BY snapshot_at DESC 
        LIMIT 1
      ) ps ON true
      LEFT JOIN arb_opportunities a ON a.market_id = m.id AND a.resolved_at IS NULL
      WHERE 1=1
    `;
    
    const countParams: unknown[] = [];
    let countParamIndex = 1;

    if (platform) {
      countSql += ` AND m.platform = $${countParamIndex++}`;
      countParams.push(platform);
    }
    if (category) {
      const categoryMapping: Record<string, string[]> = {
        'Sports': ['Sports', 'Soccer', 'NFL Playoffs', 'CFB', 'Formula 1', 'Tennis'],
        'Politics': ['Politics', 'World Elections', 'Global Elections', 'US Election', 'Elections', 'Brazil'],
        'Crypto': ['Crypto', 'Bitcoin', 'Ethereum', 'Airdrops', 'Stablecoins'],
        'Geopolitics': ['Geopolitics', 'Foreign Policy', 'Trade War', 'Iran', 'Israel', 'Gaza', 'putin', 'Denmark', 'World'],
        'Finance': ['Finance', 'Business', 'Macro Indicators', 'Fed Rates', 'Public Sales', 'Jerome Powell'],
        'Entertainment': ['Entertainment', 'Culture', 'Movies', 'Awards', 'Celebrities', 'Games', 'Pokemon', 'video games'],
        'Tech': ['Tech', 'Gemini 3'],
        'Health': ['Health'],
      };
      
      const categoryValues = categoryMapping[category];
      if (categoryValues) {
        countSql += ` AND (m.category = ANY($${countParamIndex++}) OR (m.category IS NULL AND m.sport IS NOT NULL AND $${countParamIndex++} = 'Sports'))`;
        countParams.push(categoryValues);
        countParams.push(category);
      } else if (category === 'Other') {
        countSql += ` AND m.category IS NULL AND m.sport IS NULL`;
      }
    }
    if (sport) {
      countSql += ` AND m.sport = $${countParamIndex++}`;
      countParams.push(sport);
    }
    if (status) {
      countSql += ` AND m.status = $${countParamIndex++}`;
      countParams.push(status);
    }
    if (minVolume) {
      countSql += ` AND ps.volume_24h >= $${countParamIndex++}`;
      countParams.push(parseFloat(minVolume));
    }
    if (hasArb === 'true') {
      countSql += ` AND a.id IS NOT NULL`;
    }
    if (hideResolved && status === 'open') {
      countSql += ` AND (ps.yes_price IS NULL OR (ps.yes_price > 0.02 AND ps.yes_price < 0.98))`;
    }
    if (hideExpired) {
      countSql += ` AND (m.resolution_date IS NULL OR m.resolution_date > NOW())`;
    }

    const countResult = await query<{ total: string }>(countSql, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // If groupByEvent is enabled, organize markets into event groups
    if (groupByEvent) {
      const eventMap = new Map<string, EventGroup>();
      
      for (const market of result.rows) {
        const { key, name } = extractEventName(market.title, market.platform, market.event_id);
        
        if (!eventMap.has(key)) {
          eventMap.set(key, {
            event_key: key,
            event_name: name,
            platform: market.platform,
            sport: market.sport,
            total_volume_24h: 0,
            total_volume_all_time: 0,
            market_count: 0,
            has_arb: false,
            best_arb_spread: null,
            markets: [],
          });
        }
        
        const group = eventMap.get(key)!;
        group.markets.push(market);
        group.market_count++;
        group.total_volume_24h += parseFloat(market.volume_24h || '0');
        group.total_volume_all_time += parseFloat(market.volume_all_time || '0');
        
        if (market.arb_id) {
          group.has_arb = true;
          const spread = parseFloat(market.net_spread_pct || '0');
          if (group.best_arb_spread === null || spread > group.best_arb_spread) {
            group.best_arb_spread = spread;
          }
        }
      }
      
      // Convert to array and sort by weekly volume (more meaningful than all-time)
      const events = Array.from(eventMap.values())
        .sort((a, b) => b.total_volume_24h - a.total_volume_24h);
      
      // Sort markets within each event by volume
      for (const event of events) {
        // Order markets within an event by YES (highest first)
        event.markets.sort((a, b) =>
          parseFloat(b.yes_bid || b.yes_price || '0') - parseFloat(a.yes_bid || a.yes_price || '0')
        );
      }
      
      return NextResponse.json({
        events,
        total,
        eventCount: events.length,
        limit,
        offset,
      });
    }

    // Flat list (legacy)
    return NextResponse.json({
      markets: result.rows,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Markets API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch markets' },
      { status: 500 }
    );
  }
}
