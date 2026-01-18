import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { findBestMatches, isElectionRelated } from '@/lib/fuzzy-match';
import { getTotalFee } from '@/lib/fees';
import { getTeamAlignment } from '@/lib/team-alignment';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Helper to normalize price (handle corrupted Kalshi data)
function normalizePrice(price: number): number {
  const normalized = price >= 1 ? price / 100 : price;
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(1, normalized));
}

const MIN_NET_SPREAD = 0.02;

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
    eventId?: string | null;
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
  // Flag for markets that are essentially resolved (extreme prices)
  hasExtremePrice?: boolean;
  extremePriceDetails?: {
    polyExtreme: boolean;
    kalshiExtreme: boolean;
  } | null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view') || 'confirmed'; // 'confirmed' or 'suggestions'
    const category = searchParams.get('category'); // 'sports', 'elections', 'all'
    const activeOnly = searchParams.get('activeOnly') !== 'false';
    const hideResolved = searchParams.get('hideResolved') !== 'false'; // Default: hide extreme price pairs
    const hidePastGames = searchParams.get('hidePastGames') !== 'false'; // Default: hide past game dates
    const minSpread = parseFloat(searchParams.get('minSpread') || '0');

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
        poly_event_id: string | null;
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
          pm.id as poly_id, pm.platform_id as poly_platform_id, pm.event_id as poly_event_id, pm.title as poly_title, pm.status as poly_status,
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
        WHERE 1=1
        ${activeOnly ? "AND pm.status = 'open' AND km.status = 'open'" : ''}
        ${hidePastGames ? "AND (mp.game_date IS NULL OR mp.game_date >= CURRENT_DATE)" : ''}
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
        poly_event_id: string | null;
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
          pm.id as poly_id, pm.platform_id as poly_platform_id, pm.event_id as poly_event_id, pm.title as poly_title, pm.status as poly_status,
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

    // Filter out resolved/extreme price pairs if requested
    let filteredPairs = allPairs;
    const resolvedCount = allPairs.filter(p => p.hasExtremePrice).length;
    
    if (hideResolved) {
      filteredPairs = filteredPairs.filter(p => !p.hasExtremePrice);
    }

    if (minSpread > 0) {
      filteredPairs = filteredPairs.filter(p => (p.spread.value || 0) >= minSpread);
    }

    // Sort: active arb opportunities first (by spread), then by price diff
    filteredPairs.sort((a, b) => {
      // Extreme price pairs go to the bottom
      if (a.hasExtremePrice && !b.hasExtremePrice) return 1;
      if (!a.hasExtremePrice && b.hasExtremePrice) return -1;
      
      // Then by spread (arb opportunities first)
      const aSpread = a.spread.value || 0;
      const bSpread = b.spread.value || 0;
      if (aSpread !== bSpread) return bSpread - aSpread;
      
      // Then by price difference
      const aDiff = a.spread.priceDiff || 0;
      const bDiff = b.spread.priceDiff || 0;
      return bDiff - aDiff;
    });

    // Get unique categories and sports
    const categories = Array.from(new Set(allPairs.map(p => p.category)));
    const sports = Array.from(new Set(allPairs.filter(p => p.sport).map(p => p.sport)));

    return NextResponse.json({
      view: 'confirmed',
      pairs: filteredPairs,
      total: filteredPairs.length,
      resolvedHidden: hideResolved ? resolvedCount : 0,
      categories,
      sports,
    });

  } catch (error) {
    console.error('Pairs API error:', error);
    return NextResponse.json({ error: 'Failed to fetch market pairs' }, { status: 500 });
  }
}

// Check if a market has extreme prices (essentially resolved)
function isExtremePrice(yesPrice: number): boolean {
  return yesPrice > 0.95 || yesPrice < 0.05;
}

// Transform Dome API pair
function transformPair(row: Record<string, unknown>, source: 'dome_api', category: string): UnifiedPair | null {
  const polyYes = normalizePrice(parseFloat(row.poly_yes_price as string || '0'));
  const polyNo = normalizePrice(parseFloat(row.poly_no_price as string || '0'));
  const kalshiYes = normalizePrice(parseFloat(row.kalshi_yes_price as string || '0'));
  // Compute Kalshi NO from YES (DB may have corrupted NO prices from old sync)
  const kalshiNo = kalshiYes > 0 ? 1 - kalshiYes : 0;

  const alignment = getTeamAlignment(row.poly_title as string, row.kalshi_title as string);
  const sidesInverted = alignment.sidesInverted;

  const effectiveKalshiYes = sidesInverted ? kalshiNo : kalshiYes;
  const effectiveKalshiNo = sidesInverted ? kalshiYes : kalshiNo;
  // Compute Kalshi bids from YES bid (DB may have corrupted NO bids)
  const kalshiYesBid = normalizePrice(parseFloat(row.kalshi_yes_bid as string || '0'));
  const kalshiNoBid = kalshiYesBid > 0 ? 1 - kalshiYesBid : 0;
  const effectiveKalshiYesBid = sidesInverted ? kalshiNoBid : kalshiYesBid;
  const effectiveKalshiNoBid = sidesInverted ? kalshiYesBid : kalshiNoBid;
  const polyYesBid = normalizePrice(parseFloat(row.poly_yes_bid as string || '0'));
  const polyNoBid = normalizePrice(parseFloat(row.poly_no_bid as string || '0'));

  // Check if either market has extreme prices (essentially resolved)
  const polyExtreme = isExtremePrice(polyYes);
  const kalshiExtreme = isExtremePrice(kalshiYes);
  const hasExtremePrice = polyExtreme || kalshiExtreme;

  // Only calculate spread if neither market is at extreme prices
  let bestSpread: number | null = null;
  let spreadDirection: string | null = null;
  
  if (!hasExtremePrice) {
    const totalFees = getTotalFee('polymarket') + getTotalFee('kalshi');
    const spreadBuyPolyYes = polyYesBid > 0 && effectiveKalshiNoBid > 0
      ? (1 - polyYesBid - effectiveKalshiNoBid) - totalFees
      : null;
    const spreadBuyKalshiYes = effectiveKalshiYesBid > 0 && polyNoBid > 0
      ? (1 - effectiveKalshiYesBid - polyNoBid) - totalFees
      : null;

    const calcSpread = Math.max(spreadBuyPolyYes || -999, spreadBuyKalshiYes || -999);
    if (calcSpread >= MIN_NET_SPREAD) {
      bestSpread = calcSpread;
      spreadDirection = spreadBuyPolyYes !== null && spreadBuyPolyYes >= (spreadBuyKalshiYes || -999)
        ? 'buy_poly_yes' : 'buy_kalshi_yes';
    }
  }

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
      eventId: (row.poly_event_id as string) || null,
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
      yesBid: kalshiYesBid,
      yesAsk: kalshiYesBid > 0 ? kalshiYesBid * 1.01 : 0,
      noBid: kalshiNoBid,
      noAsk: kalshiNoBid > 0 ? kalshiNoBid * 1.01 : 0,
      volume24h: parseFloat(row.kalshi_volume_24h as string || '0'),
      volumeAllTime: parseFloat(row.kalshi_volume_all_time as string || '0'),
      snapshotAt: row.kalshi_snapshot_at as string || null,
    },
    spread: {
      value: bestSpread,
      direction: spreadDirection,
      priceDiff: polyYes > 0 && effectiveKalshiYes > 0 ? Math.abs(polyYes - effectiveKalshiYes) : null,
    },
    alignment,
    // Flag for markets that are essentially resolved
    hasExtremePrice,
    extremePriceDetails: hasExtremePrice ? {
      polyExtreme,
      kalshiExtreme,
    } : null,
  };
}

// Transform user-confirmed link
function transformUserLink(row: Record<string, unknown>): UnifiedPair | null {
  const polyYes = normalizePrice(parseFloat(row.poly_yes_price as string || '0'));
  const polyNo = normalizePrice(parseFloat(row.poly_no_price as string || '0'));
  const kalshiYes = normalizePrice(parseFloat(row.kalshi_yes_price as string || '0'));
  // Compute Kalshi NO from YES (DB may have corrupted NO prices from old sync)
  const kalshiNo = kalshiYes > 0 ? 1 - kalshiYes : 0;

  // Check for extreme prices
  const polyExtreme = isExtremePrice(polyYes);
  const kalshiExtreme = isExtremePrice(kalshiYes);
  const hasExtremePrice = polyExtreme || kalshiExtreme;

  // For elections, sides are typically aligned (both YES = same outcome)
  const priceDiff = Math.abs(polyYes - kalshiYes);

  // Calculate cross-platform spread for elections too
  let bestSpread: number | null = null;
  let spreadDirection: string | null = null;
  
  // Compute Kalshi bids from YES bid (DB may have corrupted NO bids)
  const kalshiYesBid = normalizePrice(parseFloat(row.kalshi_yes_bid as string || '0'));
  const kalshiNoBid = kalshiYesBid > 0 ? 1 - kalshiYesBid : 0;
  
  if (!hasExtremePrice && polyYes > 0 && kalshiYes > 0) {
    const totalFees = getTotalFee('polymarket') + getTotalFee('kalshi');
    const polyYesBid = normalizePrice(parseFloat(row.poly_yes_bid as string || '0'));
    const polyNoBid = normalizePrice(parseFloat(row.poly_no_bid as string || '0'));
    const spreadBuyPolyYes = polyYesBid > 0 && kalshiNoBid > 0
      ? (1 - polyYesBid - kalshiNoBid) - totalFees
      : null;
    const spreadBuyKalshiYes = kalshiYesBid > 0 && polyNoBid > 0
      ? (1 - kalshiYesBid - polyNoBid) - totalFees
      : null;

    const calcSpread = Math.max(spreadBuyPolyYes || -999, spreadBuyKalshiYes || -999);
    if (calcSpread >= MIN_NET_SPREAD) {
      bestSpread = calcSpread;
      spreadDirection = spreadBuyPolyYes !== null && spreadBuyPolyYes >= (spreadBuyKalshiYes || -999)
        ? 'buy_poly_yes' : 'buy_kalshi_yes';
    }
  }

  return {
    id: `user_${row.link_id}`,
    source: 'user_confirmed',
    category: 'elections',
    matchConfidence: parseFloat(row.match_score as string || '0'),
    polymarket: {
      id: row.poly_id as number,
      platformId: row.poly_platform_id as string,
      eventId: (row.poly_event_id as string) || null,
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
      yesBid: kalshiYesBid,
      yesAsk: kalshiYesBid > 0 ? kalshiYesBid * 1.01 : 0,
      noBid: kalshiNoBid,
      noAsk: kalshiNoBid > 0 ? kalshiNoBid * 1.01 : 0,
      volume24h: parseFloat(row.kalshi_volume_24h as string || '0'),
      volumeAllTime: parseFloat(row.kalshi_volume_all_time as string || '0'),
      snapshotAt: row.kalshi_snapshot_at as string || null,
    },
    spread: {
      value: bestSpread,
      direction: spreadDirection,
      priceDiff,
    },
    alignment: {
      sidesInverted: false,
      polyTeam1: null,
      kalshiTeam1: null,
    },
    hasExtremePrice,
    extremePriceDetails: hasExtremePrice ? {
      polyExtreme,
      kalshiExtreme,
    } : null,
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
    event_id: string | null;
    title: string;
    yes_price: string | null;
    volume_all_time: string | null;
  }>(`
    SELECT m.id, m.platform_id, m.event_id, m.title, ps.yes_price, ps.volume_all_time
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
    polyMarket: { id: number; platformId: string; eventId?: string | null; title: string; yesPrice: number; volume: number };
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
          eventId: poly.event_id,
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
