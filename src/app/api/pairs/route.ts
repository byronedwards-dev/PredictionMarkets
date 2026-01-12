import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface PairRow {
  pair_id: number;
  sport: string | null;
  game_date: string | null;
  match_confidence: string | null;
  // Polymarket side
  poly_id: number;
  poly_platform_id: string;
  poly_title: string;
  poly_status: string;
  poly_yes_price: string | null;
  poly_no_price: string | null;
  poly_yes_bid: string | null;
  poly_yes_ask: string | null;
  poly_no_bid: string | null;
  poly_no_ask: string | null;
  poly_volume_24h: string | null;
  poly_volume_all_time: string | null;
  poly_snapshot_at: string | null;
  // Kalshi side
  kalshi_id: number;
  kalshi_platform_id: string;
  kalshi_title: string;
  kalshi_status: string;
  kalshi_yes_price: string | null;
  kalshi_no_price: string | null;
  kalshi_yes_bid: string | null;
  kalshi_yes_ask: string | null;
  kalshi_no_bid: string | null;
  kalshi_no_ask: string | null;
  kalshi_volume_24h: string | null;
  kalshi_volume_all_time: string | null;
  kalshi_snapshot_at: string | null;
}

// Helper to extract team names from titles for alignment detection
function extractTeams(title: string): { team1: string | null; team2: string | null } {
  // Pattern: "Team A vs. Team B" or "Team A vs Team B"
  const vsMatch = title.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s+Winner)?$/i);
  if (vsMatch) {
    return { team1: vsMatch[1].trim(), team2: vsMatch[2].trim() };
  }
  
  // Pattern: "Team A at Team B Winner?" (Kalshi style)
  const atMatch = title.match(/^(.+?)\s+at\s+(.+?)\s+Winner\??$/i);
  if (atMatch) {
    return { team1: atMatch[1].trim(), team2: atMatch[2].trim() };
  }
  
  return { team1: null, team2: null };
}

// Check if team names match (handles city vs mascot differences)
function teamsMatch(name1: string | null, name2: string | null): boolean {
  if (!name1 || !name2) return false;
  
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();
  
  // Direct match
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Common NFL city/team mappings
  const mappings: Record<string, string[]> = {
    '49ers': ['san francisco', 'sf', 'niners'],
    'eagles': ['philadelphia', 'philly'],
    'bills': ['buffalo'],
    'jaguars': ['jacksonville', 'jags'],
    'chiefs': ['kansas city', 'kc'],
    'ravens': ['baltimore'],
    'cowboys': ['dallas'],
    'packers': ['green bay', 'gb'],
    'lions': ['detroit'],
    'bears': ['chicago'],
    'vikings': ['minnesota'],
    'commanders': ['washington'],
    'giants': ['new york', 'ny giants'],
    'jets': ['new york', 'ny jets'],
    'dolphins': ['miami'],
    'patriots': ['new england'],
    'steelers': ['pittsburgh'],
    'bengals': ['cincinnati'],
    'browns': ['cleveland'],
    'texans': ['houston'],
    'colts': ['indianapolis', 'indy'],
    'titans': ['tennessee'],
    'broncos': ['denver'],
    'chargers': ['los angeles', 'la chargers'],
    'raiders': ['las vegas', 'lv'],
    'seahawks': ['seattle'],
    'cardinals': ['arizona'],
    'rams': ['los angeles', 'la rams'],
    'saints': ['new orleans'],
    'buccaneers': ['tampa bay', 'bucs'],
    'falcons': ['atlanta'],
    'panthers': ['carolina'],
  };
  
  for (const [mascot, cities] of Object.entries(mappings)) {
    const allNames = [mascot, ...cities];
    const n1Match = allNames.some(name => n1.includes(name));
    const n2Match = allNames.some(name => n2.includes(name));
    if (n1Match && n2Match) return true;
  }
  
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sport = searchParams.get('sport');
    const activeOnly = searchParams.get('activeOnly') !== 'false';
    const minSpread = searchParams.get('minSpread');

    let sql = `
      SELECT 
        mp.id as pair_id,
        mp.sport,
        mp.game_date,
        mp.match_confidence,
        -- Polymarket market
        pm.id as poly_id,
        pm.platform_id as poly_platform_id,
        pm.title as poly_title,
        pm.status as poly_status,
        pps.yes_price as poly_yes_price,
        pps.no_price as poly_no_price,
        pps.yes_bid as poly_yes_bid,
        pps.yes_ask as poly_yes_ask,
        pps.no_bid as poly_no_bid,
        pps.no_ask as poly_no_ask,
        pps.volume_24h as poly_volume_24h,
        pps.volume_all_time as poly_volume_all_time,
        pps.snapshot_at as poly_snapshot_at,
        -- Kalshi market
        km.id as kalshi_id,
        km.platform_id as kalshi_platform_id,
        km.title as kalshi_title,
        km.status as kalshi_status,
        kps.yes_price as kalshi_yes_price,
        kps.no_price as kalshi_no_price,
        kps.yes_bid as kalshi_yes_bid,
        kps.yes_ask as kalshi_yes_ask,
        kps.no_bid as kalshi_no_bid,
        kps.no_ask as kalshi_no_ask,
        kps.volume_24h as kalshi_volume_24h,
        kps.volume_all_time as kalshi_volume_all_time,
        kps.snapshot_at as kalshi_snapshot_at
      FROM market_pairs mp
      JOIN markets pm ON mp.poly_market_id = pm.id
      JOIN markets km ON mp.kalshi_market_id = km.id
      LEFT JOIN LATERAL (
        SELECT * FROM price_snapshots 
        WHERE market_id = pm.id 
        ORDER BY snapshot_at DESC 
        LIMIT 1
      ) pps ON true
      LEFT JOIN LATERAL (
        SELECT * FROM price_snapshots 
        WHERE market_id = km.id 
        ORDER BY snapshot_at DESC 
        LIMIT 1
      ) kps ON true
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    // Filter to active markets (both sides open and not resolved)
    if (activeOnly) {
      sql += ` AND pm.status = 'open' AND km.status = 'open'`;
      // Filter out effectively resolved markets (price very close to 0 or 1)
      // Allow NULL, 0, or prices in valid range - only exclude extremes (>98% or <2% but not 0)
      sql += ` AND (pps.yes_price IS NULL OR pps.yes_price = 0 OR (pps.yes_price > 0.02 AND pps.yes_price < 0.98))`;
      sql += ` AND (kps.yes_price IS NULL OR kps.yes_price = 0 OR (kps.yes_price > 0.02 AND kps.yes_price < 0.98))`;
    }

    if (sport) {
      sql += ` AND mp.sport = $${paramIndex++}`;
      params.push(sport);
    }

    // Order by game date (upcoming first) then by combined volume
    sql += ` ORDER BY mp.game_date ASC NULLS LAST, 
             (COALESCE(pps.volume_24h, 0) + COALESCE(kps.volume_24h, 0)) DESC`;
    sql += ` LIMIT 100`;

    const result = await query<PairRow>(sql, params);

    // Transform into a more useful format with spread calculations
    const pairs = result.rows.map(row => {
      const polyYes = parseFloat(row.poly_yes_price || '0');
      const polyNo = parseFloat(row.poly_no_price || '0');
      const kalshiYes = parseFloat(row.kalshi_yes_price || '0');
      const kalshiNo = parseFloat(row.kalshi_no_price || '0');

      // Detect side alignment
      const polyTeams = extractTeams(row.poly_title);
      const kalshiTeams = extractTeams(row.kalshi_title);
      
      // Check if team1 (YES side) matches between platforms
      const team1Aligned = teamsMatch(polyTeams.team1, kalshiTeams.team1);
      const team1InvertedMatch = teamsMatch(polyTeams.team1, kalshiTeams.team2);
      const sidesInverted = !team1Aligned && team1InvertedMatch;
      
      // If sides are inverted, swap Kalshi prices for comparison
      const effectiveKalshiYes = sidesInverted ? kalshiNo : kalshiYes;
      const effectiveKalshiNo = sidesInverted ? kalshiYes : kalshiNo;

      // Calculate cross-platform spread with aligned sides
      // Arb exists if you can buy YES cheap on one and NO cheap on other
      const spreadBuyPolyYes = polyYes > 0 && effectiveKalshiNo > 0 ? (1 - polyYes - effectiveKalshiNo) : null;
      const spreadBuyKalshiYes = effectiveKalshiYes > 0 && polyNo > 0 ? (1 - effectiveKalshiYes - polyNo) : null;
      
      const bestSpread = Math.max(spreadBuyPolyYes || -999, spreadBuyKalshiYes || -999);
      const spreadDirection = spreadBuyPolyYes !== null && spreadBuyPolyYes >= (spreadBuyKalshiYes || -999) 
        ? 'buy_poly_yes' : 'buy_kalshi_yes';

      return {
        id: row.pair_id,
        sport: row.sport,
        gameDate: row.game_date,
        matchConfidence: parseFloat(row.match_confidence || '0'),
        polymarket: {
          id: row.poly_id,
          platformId: row.poly_platform_id,
          title: row.poly_title,
          status: row.poly_status,
          yesPrice: polyYes,
          noPrice: polyNo,
          yesBid: parseFloat(row.poly_yes_bid || '0'),
          yesAsk: parseFloat(row.poly_yes_ask || '0'),
          noBid: parseFloat(row.poly_no_bid || '0'),
          noAsk: parseFloat(row.poly_no_ask || '0'),
          volume24h: parseFloat(row.poly_volume_24h || '0'),
          volumeAllTime: parseFloat(row.poly_volume_all_time || '0'),
          snapshotAt: row.poly_snapshot_at,
        },
        kalshi: {
          id: row.kalshi_id,
          platformId: row.kalshi_platform_id,
          title: row.kalshi_title,
          status: row.kalshi_status,
          yesPrice: kalshiYes,
          noPrice: kalshiNo,
          yesBid: parseFloat(row.kalshi_yes_bid || '0'),
          yesAsk: parseFloat(row.kalshi_yes_ask || '0'),
          noBid: parseFloat(row.kalshi_no_bid || '0'),
          noAsk: parseFloat(row.kalshi_no_ask || '0'),
          volume24h: parseFloat(row.kalshi_volume_24h || '0'),
          volumeAllTime: parseFloat(row.kalshi_volume_all_time || '0'),
          snapshotAt: row.kalshi_snapshot_at,
        },
        spread: {
          value: bestSpread > -999 ? bestSpread : null,
          direction: bestSpread > -999 ? spreadDirection : null,
          priceDiff: polyYes > 0 && effectiveKalshiYes > 0 ? Math.abs(polyYes - effectiveKalshiYes) : null,
        },
        alignment: {
          sidesInverted,
          polyTeam1: polyTeams.team1,
          kalshiTeam1: kalshiTeams.team1,
        },
      };
    });

    // Filter by minimum spread if requested
    const filteredPairs = minSpread 
      ? pairs.filter(p => p.spread.value !== null && p.spread.value >= parseFloat(minSpread))
      : pairs;

    // Sort by spread (highest first) if filtering by spread
    if (minSpread) {
      filteredPairs.sort((a, b) => (b.spread.value || 0) - (a.spread.value || 0));
    }

    return NextResponse.json({
      pairs: filteredPairs,
      total: filteredPairs.length,
      sports: Array.from(new Set(pairs.map(p => p.sport).filter(Boolean))),
    });
  } catch (error) {
    console.error('Pairs API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market pairs' },
      { status: 500 }
    );
  }
}
