import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const quality = searchParams.get('quality');
    const minSpread = searchParams.get('minSpread');
    const minDeployable = searchParams.get('minDeployable');
    const active = searchParams.get('active') !== 'false';

    let sql = `
      SELECT 
        a.*,
        m.title as market_title,
        m.platform,
        m.sport,
        mp.poly_market_id,
        mp.kalshi_market_id,
        pm.title as poly_title,
        km.title as kalshi_title
      FROM arb_opportunities a
      LEFT JOIN markets m ON a.market_id = m.id
      LEFT JOIN market_pairs mp ON a.market_pair_id = mp.id
      LEFT JOIN markets pm ON mp.poly_market_id = pm.id
      LEFT JOIN markets km ON mp.kalshi_market_id = km.id
      WHERE 1=1
    `;
    
    const params: unknown[] = [];
    let paramIndex = 1;

    if (active) {
      sql += ` AND a.resolved_at IS NULL`;
      // Filter out cross-platform arbs where either market is past resolution date
      sql += ` AND (
        a.type != 'cross_platform' 
        OR (
          (pm.resolution_date IS NULL OR pm.resolution_date > NOW())
          AND (km.resolution_date IS NULL OR km.resolution_date > NOW())
        )
      )`;
    }

    if (type) {
      const types = type.split(',');
      sql += ` AND a.type = ANY($${paramIndex++})`;
      params.push(types);
    }

    if (quality) {
      const qualities = quality.split(',');
      sql += ` AND a.quality = ANY($${paramIndex++})`;
      params.push(qualities);
    }

    if (minSpread) {
      sql += ` AND a.net_spread_pct >= $${paramIndex++}`;
      params.push(parseFloat(minSpread));
    }

    if (minDeployable) {
      sql += ` AND a.max_deployable_usd >= $${paramIndex++}`;
      params.push(parseFloat(minDeployable));
    }

    sql += ` ORDER BY a.net_spread_pct DESC, a.max_deployable_usd DESC`;

    const result = await query(sql, params);

    // Build stats query with SAME filters as main query (except quality - we want breakdown)
    let statsSql = `
      SELECT 
        COUNT(*)::TEXT as total,
        COUNT(*) FILTER (WHERE quality = 'executable')::TEXT as executable,
        COUNT(*) FILTER (WHERE quality = 'thin')::TEXT as thin,
        COUNT(*) FILTER (WHERE quality = 'theoretical')::TEXT as theoretical,
        AVG(net_spread_pct)::TEXT as avg_spread,
        SUM(max_deployable_usd)::TEXT as total_deployable
      FROM arb_opportunities
      WHERE resolved_at IS NULL
    `;
    const statsParams: unknown[] = [];
    let statsParamIndex = 1;

    // Apply type filter to stats (important for cross_platform vs single_platform pages)
    if (type) {
      const types = type.split(',');
      statsSql += ` AND type = ANY($${statsParamIndex++})`;
      statsParams.push(types);
    }

    // Apply spread/deployable filters to stats
    if (minSpread) {
      statsSql += ` AND net_spread_pct >= $${statsParamIndex++}`;
      statsParams.push(parseFloat(minSpread));
    }

    if (minDeployable) {
      statsSql += ` AND max_deployable_usd >= $${statsParamIndex++}`;
      statsParams.push(parseFloat(minDeployable));
    }

    const statsResult = await query<{
      total: string;
      executable: string;
      thin: string;
      theoretical: string;
      avg_spread: string;
      total_deployable: string;
    }>(statsSql, statsParams);

    const stats = statsResult.rows[0];

    return NextResponse.json({
      arbs: result.rows,
      stats: {
        total: parseInt(stats.total) || 0,
        executable: parseInt(stats.executable) || 0,
        thin: parseInt(stats.thin) || 0,
        theoretical: parseInt(stats.theoretical) || 0,
        avgSpread: parseFloat(stats.avg_spread) || 0,
        totalDeployable: parseFloat(stats.total_deployable) || 0,
      },
    });
  } catch (error) {
    console.error('Arbs API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch arbitrage opportunities' },
      { status: 500 }
    );
  }
}
