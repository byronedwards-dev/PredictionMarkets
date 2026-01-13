import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { findBestMatches, isElectionRelated } from '@/lib/fuzzy-match';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Helper to normalize price (handle corrupted Kalshi data)
function normalizePrice(price: number): number {
  return price >= 1 ? price / 100 : price;
}

// Helper to extract team names from titles for alignment detection
function extractTeams(title: string): { team1: string | null; team2: string | null } {
  const vsMatch = title.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s+Winner)?$/i);
  if (vsMatch) {
    return { team1: vsMatch[1].trim(), team2: vsMatch[2].trim() };
  }
  
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
  
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
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

interface UnifiedPair {
  id: string; // prefixed with source
  source: 'dome_api' | 'user_confirmed';
  category: 'sports' | 'elections' | 'other';
  sport?: string | null;
  gameDate?: string | null;
  matchConfidence: number;
  polymarket: {
    id: number;
    platformId: string;
    title: string;
    status: string;
    yesPrice: number;
    noPrice: number;
    yesBid: number;
    yesAsk: number;
    noBid: number;
    noAsk: number;
    volume24h: number;
    volumeAllTime: number;
    snapshotAt: string | null;
  };
  kalshi: {
    id: number;
    platformId: string;
    title: string;
    status: string;
    yesPrice: number;
    noPrice: number;
    yesBid: number;
    yesAsk: number;
    noBid: number;
    noAsk: number;
    volume24h: number;
    volumeAllTime: number;
    snapshotAt: string | null;
  };
  spread: {
    value: number | null;
    direction: string | null;
    priceDiff: number | null;
  };
  alignment: {
    sidesInverted: boolean;
    polyTeam1: string | null;
    kalshiTeam1: string | null;
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view') || 'confirmed'; // 'confirmed' or 'suggestions'
    const category = searchParams.get('category'); // 'sports', 'elections', 'all'
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    if (view === 'suggestions') {
      // Return unconfirmed suggestions (from discover logic)
      return await getSuggestions(request);
    }

    // CONFIRMED PAIRS - combine both sources
    const allPairs: UnifiedPair[] = [];

    // 1. Fetch from market_pairs (Dome API - sports)
    if (!category || category === 'all' || category === 'sports') {
      const domePairs = await query<{
        pair_id: number;
        sport: string | null;
        game_date: string | null;
        match_confidence: string | null;
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
      }>(`
        SELECT 
          mp.id as pair_id, mp.sport, mp.game_date, mp.match_confidence,
          pm.id as poly_id, pm.platform_id as poly_platform_id, pm.title as poly_title, pm.status as poly_status,
          pps.yes_price as poly_yes_price, pps.no_price as poly_no_price,
          pps.yes_bid as poly_yes_bid, pps.yes_ask as poly_yes_ask,
          pps.no_bid as poly_no_bid, pps.no_ask as poly_no_ask,
          pps.volume_24h as poly_volume_24h, pps.volume_all_time as poly_volume_all_time,
          pps.snapshot_at as poly_snapshot_at,
          km.id as kalshi_id, km.platform_id as kalshi_platform_id, km.title as kalshi_title, km.status as kalshi_status,
          kps.yes_price as kalshi_yes_price, kps.no_price as kalshi_no_price,
          kps.yes_bid as kalshi_yes_bid, kps.yes_ask as kalshi_yes_ask,
          kps.no_bid as kalshi_no_bid, kps.no_ask as kalshi_no_ask,
          kps.volume_24h as kalshi_volume_24h, kps.volume_all_time as kalshi_volume_all_time,
          kps.snapshot_at as kalshi_snapshot_at
        FROM market_pairs mp
        JOIN markets pm ON mp.poly_market_id = pm.id
        JOIN markets km ON mp.kalshi_market_id = km.id
        LEFT JOIN LATERAL (SELECT * FROM price_snapshots WHERE market_id = pm.id ORDER BY snapshot_at DESC LIMIT 1) pps ON true
        LEFT JOIN LATERAL (SELECT * FROM price_snapshots WHERE market_id = km.id ORDER BY snapshot_at DESC LIMIT 1) kps ON true
        ${activeOnly ? "WHERE pm.status = 'open' AND km.status = 'open'" : ''}
        ORDER BY mp.game_date ASC NULLS LAST
        LIMIT 100
      `);

      for (const row of domePairs.rows) {
        const pair = transformPair(row, 'dome_api', row.sport || 'sports');
        if (pair) allPairs.push(pair);
      }
    }

    // 2. Fetch from user_market_links (user confirmed - elections)
    if (!category || category === 'all' || category === 'elections') {
      const userLinks = await query<{
        link_id: number;
        match_score: string | null;
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
      }>(`
        SELECT 
          uml.id as link_id, uml.match_score,
          pm.id as poly_id, pm.platform_id as poly_platform_id, pm.title as poly_title, pm.status as poly_status,
          pps.yes_price as poly_yes_price, pps.no_price as poly_no_price,
          pps.yes_bid as poly_yes_bid, pps.yes_ask as poly_yes_ask,
          pps.no_bid as poly_no_bid, pps.no_ask as poly_no_ask,
          pps.volume_24h as poly_volume_24h, pps.volume_all_time as poly_volume_all_time,
          pps.snapshot_at as poly_snapshot_at,
          km.id as kalshi_id, km.platform_id as kalshi_platform_id, km.title as kalshi_title, km.status as kalshi_status,
          kps.yes_price as kalshi_yes_price, kps.no_price as kalshi_no_price,
          kps.yes_bid as kalshi_yes_bid, kps.yes_ask as kalshi_yes_ask,
          kps.no_bid as kalshi_no_bid, kps.no_ask as kalshi_no_ask,
          kps.volume_24h as kalshi_volume_24h, kps.volume_all_time as kalshi_volume_all_time,
          kps.snapshot_at as kalshi_snapshot_at
        FROM user_market_links uml
        JOIN markets pm ON uml.poly_market_id = pm.id
        JOIN markets km ON uml.kalshi_market_id = km.id
        LEFT JOIN LATERAL (SELECT * FROM price_snapshots WHERE market_id = pm.id ORDER BY snapshot_at DESC LIMIT 1) pps ON true
        LEFT JOIN LATERAL (SELECT * FROM price_snapshots WHERE market_id = km.id ORDER BY snapshot_at DESC LIMIT 1) kps ON true
        WHERE uml.status = 'confirmed'
        ${activeOnly ? "AND pm.status = 'open' AND km.status = 'open'" : ''}
        ORDER BY uml.confirmed_at DESC
        LIMIT 100
      `);

      for (const row of userLinks.rows) {
        const pair = transformUserLink(row);
        if (pair) allPairs.push(pair);
      }
    }

    // Sort by price difference (most interesting first)
    allPairs.sort((a, b) => {
      const aDiff = a.spread.priceDiff || 0;
      const bDiff = b.spread.priceDiff || 0;
      return bDiff - aDiff;
    });

    // Get unique categories and sports
    const categories = Array.from(new Set(allPairs.map(p => p.category)));
    const sports = Array.from(new Set(allPairs.filter(p => p.sport).map(p => p.sport)));

    return NextResponse.json({
      view: 'confirmed',
      pairs: allPairs,
      total: allPairs.length,
      categories,
      sports,
    });

  } catch (error) {
    console.error('Pairs API error:', error);
    return NextResponse.json({ error: 'Failed to fetch market pairs' }, { status: 500 });
  }
}

// Transform Dome API pair
function transformPair(row: Record<string, unknown>, source: 'dome_api', category: string): UnifiedPair | null {
  const polyYes = normalizePrice(parseFloat(row.poly_yes_price as string || '0'));
  const polyNo = normalizePrice(parseFloat(row.poly_no_price as string || '0'));
  const kalshiYes = normalizePrice(parseFloat(row.kalshi_yes_price as string || '0'));
  const kalshiNo = normalizePrice(parseFloat(row.kalshi_no_price as string || '0'));

  const polyTeams = extractTeams(row.poly_title as string);
  const kalshiTeams = extractTeams(row.kalshi_title as string);
  
  const team1Aligned = teamsMatch(polyTeams.team1, kalshiTeams.team1);
  const team1InvertedMatch = teamsMatch(polyTeams.team1, kalshiTeams.team2);
  const sidesInverted = !team1Aligned && team1InvertedMatch;
  
  const effectiveKalshiYes = sidesInverted ? kalshiNo : kalshiYes;
  const effectiveKalshiNo = sidesInverted ? kalshiYes : kalshiNo;

  const spreadBuyPolyYes = polyYes > 0 && effectiveKalshiNo > 0 ? (1 - polyYes - effectiveKalshiNo) : null;
  const spreadBuyKalshiYes = effectiveKalshiYes > 0 && polyNo > 0 ? (1 - effectiveKalshiYes - polyNo) : null;
  
  const bestSpread = Math.max(spreadBuyPolyYes || -999, spreadBuyKalshiYes || -999);
  const spreadDirection = spreadBuyPolyYes !== null && spreadBuyPolyYes >= (spreadBuyKalshiYes || -999) 
    ? 'buy_poly_yes' : 'buy_kalshi_yes';

  return {
    id: `dome_${row.pair_id}`,
    source,
    category: 'sports',
    sport: row.sport as string || null,
    gameDate: row.game_date as string || null,
    matchConfidence: parseFloat(row.match_confidence as string || '0'),
    polymarket: {
      id: row.poly_id as number,
      platformId: row.poly_platform_id as string,
      title: row.poly_title as string,
      status: row.poly_status as string,
      yesPrice: polyYes,
      noPrice: polyNo,
      yesBid: normalizePrice(parseFloat(row.poly_yes_bid as string || '0')),
      yesAsk: normalizePrice(parseFloat(row.poly_yes_ask as string || '0')),
      noBid: normalizePrice(parseFloat(row.poly_no_bid as string || '0')),
      noAsk: normalizePrice(parseFloat(row.poly_no_ask as string || '0')),
      volume24h: parseFloat(row.poly_volume_24h as string || '0'),
      volumeAllTime: parseFloat(row.poly_volume_all_time as string || '0'),
      snapshotAt: row.poly_snapshot_at as string || null,
    },
    kalshi: {
      id: row.kalshi_id as number,
      platformId: row.kalshi_platform_id as string,
      title: row.kalshi_title as string,
      status: row.kalshi_status as string,
      yesPrice: kalshiYes,
      noPrice: kalshiNo,
      yesBid: normalizePrice(parseFloat(row.kalshi_yes_bid as string || '0')),
      yesAsk: normalizePrice(parseFloat(row.kalshi_yes_ask as string || '0')),
      noBid: normalizePrice(parseFloat(row.kalshi_no_bid as string || '0')),
      noAsk: normalizePrice(parseFloat(row.kalshi_no_ask as string || '0')),
      volume24h: parseFloat(row.kalshi_volume_24h as string || '0'),
      volumeAllTime: parseFloat(row.kalshi_volume_all_time as string || '0'),
      snapshotAt: row.kalshi_snapshot_at as string || null,
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
}

// Transform user-confirmed link
function transformUserLink(row: Record<string, unknown>): UnifiedPair | null {
  const polyYes = normalizePrice(parseFloat(row.poly_yes_price as string || '0'));
  const polyNo = normalizePrice(parseFloat(row.poly_no_price as string || '0'));
  const kalshiYes = normalizePrice(parseFloat(row.kalshi_yes_price as string || '0'));
  const kalshiNo = normalizePrice(parseFloat(row.kalshi_no_price as string || '0'));

  // For elections, sides are typically aligned (both YES = same outcome)
  const priceDiff = Math.abs(polyYes - kalshiYes);

  return {
    id: `user_${row.link_id}`,
    source: 'user_confirmed',
    category: 'elections',
    matchConfidence: parseFloat(row.match_score as string || '0'),
    polymarket: {
      id: row.poly_id as number,
      platformId: row.poly_platform_id as string,
      title: row.poly_title as string,
      status: row.poly_status as string,
      yesPrice: polyYes,
      noPrice: polyNo,
      yesBid: normalizePrice(parseFloat(row.poly_yes_bid as string || '0')),
      yesAsk: normalizePrice(parseFloat(row.poly_yes_ask as string || '0')),
      noBid: normalizePrice(parseFloat(row.poly_no_bid as string || '0')),
      noAsk: normalizePrice(parseFloat(row.poly_no_ask as string || '0')),
      volume24h: parseFloat(row.poly_volume_24h as string || '0'),
      volumeAllTime: parseFloat(row.poly_volume_all_time as string || '0'),
      snapshotAt: row.poly_snapshot_at as string || null,
    },
    kalshi: {
      id: row.kalshi_id as number,
      platformId: row.kalshi_platform_id as string,
      title: row.kalshi_title as string,
      status: row.kalshi_status as string,
      yesPrice: kalshiYes,
      noPrice: kalshiNo,
      yesBid: normalizePrice(parseFloat(row.kalshi_yes_bid as string || '0')),
      yesAsk: normalizePrice(parseFloat(row.kalshi_yes_ask as string || '0')),
      noBid: normalizePrice(parseFloat(row.kalshi_no_bid as string || '0')),
      noAsk: normalizePrice(parseFloat(row.kalshi_no_ask as string || '0')),
      volume24h: parseFloat(row.kalshi_volume_24h as string || '0'),
      volumeAllTime: parseFloat(row.kalshi_volume_all_time as string || '0'),
      snapshotAt: row.kalshi_snapshot_at as string || null,
    },
    spread: {
      value: null, // Elections don't have the same spread calculation
      direction: null,
      priceDiff,
    },
    alignment: {
      sidesInverted: false,
      polyTeam1: null,
      kalshiTeam1: null,
    },
  };
}

// Suggestions endpoint (moved from discover)
async function getSuggestions(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const minScore = parseFloat(searchParams.get('minScore') || '80');

  // Get existing links to exclude
  const existingLinks = await query<{
    poly_market_id: number;
    kalshi_market_id: number;
    status: string;
  }>(`
    SELECT poly_market_id, kalshi_market_id, status 
    FROM user_market_links 
    WHERE status IN ('confirmed', 'rejected')
  `);

  const confirmedPolyIds = new Set(
    existingLinks.rows.filter(l => l.status === 'confirmed').map(l => l.poly_market_id)
  );
  const rejectedPairs = new Set(
    existingLinks.rows.filter(l => l.status === 'rejected')
      .map(l => `${l.poly_market_id}-${l.kalshi_market_id}`)
  );

  // Get election markets from both platforms
  const polyMarkets = await query<{
    id: number;
    platform_id: string;
    title: string;
    yes_price: string | null;
    volume_all_time: string | null;
  }>(`
    SELECT m.id, m.platform_id, m.title, ps.yes_price, ps.volume_all_time
    FROM markets m
    LEFT JOIN LATERAL (
      SELECT yes_price, volume_all_time FROM price_snapshots 
      WHERE market_id = m.id ORDER BY snapshot_at DESC LIMIT 1
    ) ps ON true
    WHERE m.platform = 'polymarket' AND m.status = 'open'
    ORDER BY ps.volume_all_time DESC NULLS LAST
    LIMIT 500
  `);

  const kalshiMarkets = await query<{
    id: number;
    platform_id: string;
    title: string;
    yes_price: string | null;
    volume_all_time: string | null;
  }>(`
    SELECT m.id, m.platform_id, m.title, ps.yes_price, ps.volume_all_time
    FROM markets m
    LEFT JOIN LATERAL (
      SELECT yes_price, volume_all_time FROM price_snapshots 
      WHERE market_id = m.id ORDER BY snapshot_at DESC LIMIT 1
    ) ps ON true
    WHERE m.platform = 'kalshi' AND m.status = 'open'
    ORDER BY ps.volume_all_time DESC NULLS LAST
    LIMIT 500
  `);

  // Filter to election-related markets
  const polyElection = polyMarkets.rows.filter(m => isElectionRelated(m.title));
  const kalshiElection = kalshiMarkets.rows.filter(m => 
    isElectionRelated(m.title) && parseFloat(m.volume_all_time || '0') >= 1000
  );

  // Build suggestions
  const suggestions: Array<{
    polyMarket: { id: number; platformId: string; title: string; yesPrice: number; volume: number };
    kalshiCandidates: Array<{ id: number; platformId: string; title: string; yesPrice: number; volume: number; score: number }>;
  }> = [];

  for (const poly of polyElection) {
    if (confirmedPolyIds.has(poly.id)) continue;

    const candidates = kalshiElection
      .filter(k => !rejectedPairs.has(`${poly.id}-${k.id}`))
      .map(k => ({ id: k.id, title: k.title }));

    const matches = findBestMatches(poly.title, candidates, minScore, 3);

    if (matches.length > 0) {
      suggestions.push({
        polyMarket: {
          id: poly.id,
          platformId: poly.platform_id,
          title: poly.title,
          yesPrice: normalizePrice(parseFloat(poly.yes_price || '0')),
          volume: parseFloat(poly.volume_all_time || '0'),
        },
        kalshiCandidates: matches.map(m => {
          const kalshi = kalshiElection.find(k => k.id === m.id)!;
          return {
            id: kalshi.id,
            platformId: kalshi.platform_id,
            title: kalshi.title,
            yesPrice: normalizePrice(parseFloat(kalshi.yes_price || '0')),
            volume: parseFloat(kalshi.volume_all_time || '0'),
            score: m.score,
          };
        }),
      });
    }
  }

  suggestions.sort((a, b) => (b.kalshiCandidates[0]?.score || 0) - (a.kalshiCandidates[0]?.score || 0));

  return NextResponse.json({
    view: 'suggestions',
    suggestions,
    stats: {
      polyElectionMarkets: polyElection.length,
      kalshiElectionMarkets: kalshiElection.length,
      suggestionsFound: suggestions.length,
      alreadyConfirmed: confirmedPolyIds.size,
    },
  });
}

// POST: Confirm or reject a market link (same as before)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, polyMarketId, kalshiMarketId, polyTitle, kalshiTitle, matchScore } = body;

    if (!action || !polyMarketId || !kalshiMarketId) {
      return NextResponse.json(
        { error: 'Missing required fields: action, polyMarketId, kalshiMarketId' },
        { status: 400 }
      );
    }

    if (action === 'confirm') {
      const result = await query<{ id: number }>(
        `INSERT INTO user_market_links 
         (poly_market_id, kalshi_market_id, poly_title, kalshi_title, match_score, status, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', NOW())
         ON CONFLICT (poly_market_id, kalshi_market_id) 
         DO UPDATE SET status = 'confirmed', confirmed_at = NOW(), rejected_at = NULL, updated_at = NOW()
         RETURNING id`,
        [polyMarketId, kalshiMarketId, polyTitle, kalshiTitle, matchScore || 0]
      );
      return NextResponse.json({ success: true, action: 'confirmed', linkId: result.rows[0].id });

    } else if (action === 'reject') {
      const result = await query<{ id: number }>(
        `INSERT INTO user_market_links 
         (poly_market_id, kalshi_market_id, poly_title, kalshi_title, match_score, status, rejected_at)
         VALUES ($1, $2, $3, $4, $5, 'rejected', NOW())
         ON CONFLICT (poly_market_id, kalshi_market_id) 
         DO UPDATE SET status = 'rejected', rejected_at = NOW(), confirmed_at = NULL, updated_at = NOW()
         RETURNING id`,
        [polyMarketId, kalshiMarketId, polyTitle, kalshiTitle, matchScore || 0]
      );
      return NextResponse.json({ success: true, action: 'rejected', linkId: result.rows[0].id });

    } else if (action === 'unlink') {
      await query(
        `UPDATE user_market_links 
         SET status = 'rejected', rejected_at = NOW(), confirmed_at = NULL, updated_at = NOW()
         WHERE poly_market_id = $1 AND kalshi_market_id = $2`,
        [polyMarketId, kalshiMarketId]
      );
      return NextResponse.json({ success: true, action: 'unlinked' });

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

  } catch (error) {
    console.error('Pairs POST error:', error);
    return NextResponse.json({ error: 'Failed to update market link' }, { status: 500 });
  }
}
