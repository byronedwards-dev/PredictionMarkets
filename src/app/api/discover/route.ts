import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { calculateSimilarity, findBestMatches, isElectionRelated } from '@/lib/fuzzy-match';

export const dynamic = 'force-dynamic';

// Minimum volume for a market to be considered as a match candidate
const MIN_VOLUME_FOR_MATCHING = 1000; // $1,000 minimum

// Price range filter - exclude extreme prices (essentially resolved markets)
const MIN_INTERESTING_PRICE = 0.10; // 10¢ - below this is "obvious no"
const MAX_INTERESTING_PRICE = 0.90; // 90¢ - above this is "obvious yes"

interface MarketRow {
  id: number;
  platform: string;
  platform_id: string;
  event_id: string | null;
  title: string;
  category: string | null;
  status: string;
  yes_price: string | null;
  volume_24h: string | null;
  volume_all_time: string | null;
}

interface LinkRow {
  id: number;
  poly_market_id: number;
  kalshi_market_id: number;
  poly_title: string;
  kalshi_title: string;
  match_score: string;
  status: string;
  confirmed_at: Date | null;
}

// GET: Fetch election markets and their matches/suggestions
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view') || 'suggestions'; // 'suggestions', 'confirmed', 'rejected'
    const minScore = parseFloat(searchParams.get('minScore') || '80');

    // Get all confirmed and rejected links (to exclude from suggestions)
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

    if (view === 'confirmed') {
      // Return confirmed links with current prices
      const confirmed = await query<LinkRow & { 
        poly_yes_price: string; 
        kalshi_yes_price: string;
        poly_volume: string;
        kalshi_volume: string;
      }>(`
        SELECT 
          uml.id, uml.poly_market_id, uml.kalshi_market_id,
          uml.poly_title, uml.kalshi_title, uml.match_score, uml.status, uml.confirmed_at,
          pps.yes_price as poly_yes_price,
          kps.yes_price as kalshi_yes_price,
          pps.volume_24h as poly_volume,
          kps.volume_24h as kalshi_volume
        FROM user_market_links uml
        LEFT JOIN LATERAL (
          SELECT yes_price, volume_24h FROM price_snapshots 
          WHERE market_id = uml.poly_market_id 
          ORDER BY snapshot_at DESC LIMIT 1
        ) pps ON true
        LEFT JOIN LATERAL (
          SELECT yes_price, volume_24h FROM price_snapshots 
          WHERE market_id = uml.kalshi_market_id 
          ORDER BY snapshot_at DESC LIMIT 1
        ) kps ON true
        WHERE uml.status = 'confirmed'
        ORDER BY uml.confirmed_at DESC
      `);

      return NextResponse.json({
        view: 'confirmed',
        links: confirmed.rows.map(row => ({
          id: row.id,
          polyMarketId: row.poly_market_id,
          kalshiMarketId: row.kalshi_market_id,
          polyTitle: row.poly_title,
          kalshiTitle: row.kalshi_title,
          matchScore: parseFloat(row.match_score),
          polyYesPrice: parseFloat(row.poly_yes_price || '0'),
          kalshiYesPrice: parseFloat(row.kalshi_yes_price || '0'),
          polyVolume: parseFloat(row.poly_volume || '0'),
          kalshiVolume: parseFloat(row.kalshi_volume || '0'),
          confirmedAt: row.confirmed_at,
        })),
        total: confirmed.rows.length,
      });
    }

    // Get Polymarket election markets
    const polyMarkets = await query<MarketRow>(`
      SELECT m.id, m.platform, m.platform_id, m.event_id, m.title, m.category, m.status,
             ps.yes_price, ps.volume_24h, ps.volume_all_time
      FROM markets m
      LEFT JOIN LATERAL (
        SELECT yes_price, volume_24h, volume_all_time FROM price_snapshots 
        WHERE market_id = m.id 
        ORDER BY snapshot_at DESC LIMIT 1
      ) ps ON true
      WHERE m.platform = 'polymarket' 
        AND m.status = 'open'
      ORDER BY ps.volume_all_time DESC NULLS LAST
      LIMIT 500
    `);

    // Get Kalshi election markets
    const kalshiMarkets = await query<MarketRow>(`
      SELECT m.id, m.platform, m.platform_id, m.event_id, m.title, m.category, m.status,
             ps.yes_price, ps.volume_24h, ps.volume_all_time
      FROM markets m
      LEFT JOIN LATERAL (
        SELECT yes_price, volume_24h, volume_all_time FROM price_snapshots 
        WHERE market_id = m.id 
        ORDER BY snapshot_at DESC LIMIT 1
      ) ps ON true
      WHERE m.platform = 'kalshi' 
        AND m.status = 'open'
      ORDER BY ps.volume_all_time DESC NULLS LAST
      LIMIT 500
    `);

    // Helper to check if price is in "interesting" range (not essentially resolved)
    // Note: Price filtering disabled for now due to Kalshi price normalization issues
    // Once sync is fixed, can re-enable: price >= MIN_INTERESTING_PRICE && price <= MAX_INTERESTING_PRICE
    const isInterestingPrice = (price: number) => {
      // Normalize price first (Kalshi data may still be corrupted as cents)
      const normalized = price >= 1 ? price / 100 : price;
      return normalized >= MIN_INTERESTING_PRICE && normalized <= MAX_INTERESTING_PRICE;
    };

    // Filter to election-related markets with minimum volume and interesting prices
    const polyElection = polyMarkets.rows.filter(m => {
      const price = parseFloat(m.yes_price || '0');
      return isElectionRelated(m.title) && isInterestingPrice(price);
    });
    
    const kalshiElection = kalshiMarkets.rows.filter(m => {
      const price = parseFloat(m.yes_price || '0');
      return isElectionRelated(m.title) && 
        parseFloat(m.volume_all_time || '0') >= MIN_VOLUME_FOR_MATCHING &&
        isInterestingPrice(price);
    });

    // Build suggestions for unmatched Polymarket markets
    const suggestions: Array<{
      polyMarket: {
        id: number;
        platformId: string;
        eventId?: string | null;
        title: string;
        yesPrice: number;
        volume: number;
      };
      kalshiCandidates: Array<{
        id: number;
        platformId: string;
        title: string;
        yesPrice: number;
        volume: number;
        score: number;
      }>;
    }> = [];

    for (const poly of polyElection) {
      // Skip if already confirmed
      if (confirmedPolyIds.has(poly.id)) continue;

      // Find best Kalshi matches
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
            yesPrice: parseFloat(poly.yes_price || '0'),
            volume: parseFloat(poly.volume_all_time || '0'),
          },
          kalshiCandidates: matches.map(m => {
            const kalshi = kalshiElection.find(k => k.id === m.id)!;
            return {
              id: kalshi.id,
              platformId: kalshi.platform_id,
              title: kalshi.title,
              yesPrice: parseFloat(kalshi.yes_price || '0'),
              volume: parseFloat(kalshi.volume_all_time || '0'),
              score: m.score,
            };
          }),
        });
      }
    }

    // Sort by best match score
    suggestions.sort((a, b) => {
      const aTop = a.kalshiCandidates[0]?.score || 0;
      const bTop = b.kalshiCandidates[0]?.score || 0;
      return bTop - aTop;
    });

    return NextResponse.json({
      view: 'suggestions',
      suggestions,
      stats: {
        polyElectionMarkets: polyElection.length,
        kalshiElectionMarkets: kalshiElection.length,
        suggestionsFound: suggestions.length,
        alreadyConfirmed: confirmedPolyIds.size,
        minScoreThreshold: minScore,
      },
    });

  } catch (error) {
    console.error('Discover API error:', error);
    return NextResponse.json(
      { error: 'Failed to discover markets' },
      { status: 500 }
    );
  }
}

// POST: Confirm or reject a market link
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
      // Upsert as confirmed
      const result = await query<{ id: number }>(
        `INSERT INTO user_market_links 
         (poly_market_id, kalshi_market_id, poly_title, kalshi_title, match_score, status, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', NOW())
         ON CONFLICT (poly_market_id, kalshi_market_id) 
         DO UPDATE SET 
           status = 'confirmed',
           confirmed_at = NOW(),
           rejected_at = NULL,
           updated_at = NOW()
         RETURNING id`,
        [polyMarketId, kalshiMarketId, polyTitle, kalshiTitle, matchScore || 0]
      );

      return NextResponse.json({
        success: true,
        action: 'confirmed',
        linkId: result.rows[0].id,
      });

    } else if (action === 'reject') {
      // Upsert as rejected
      const result = await query<{ id: number }>(
        `INSERT INTO user_market_links 
         (poly_market_id, kalshi_market_id, poly_title, kalshi_title, match_score, status, rejected_at)
         VALUES ($1, $2, $3, $4, $5, 'rejected', NOW())
         ON CONFLICT (poly_market_id, kalshi_market_id) 
         DO UPDATE SET 
           status = 'rejected',
           rejected_at = NOW(),
           confirmed_at = NULL,
           updated_at = NOW()
         RETURNING id`,
        [polyMarketId, kalshiMarketId, polyTitle, kalshiTitle, matchScore || 0]
      );

      return NextResponse.json({
        success: true,
        action: 'rejected',
        linkId: result.rows[0].id,
      });

    } else if (action === 'unlink') {
      // Remove confirmed status (set to rejected or delete)
      await query(
        `UPDATE user_market_links 
         SET status = 'rejected', rejected_at = NOW(), confirmed_at = NULL, updated_at = NOW()
         WHERE poly_market_id = $1 AND kalshi_market_id = $2`,
        [polyMarketId, kalshiMarketId]
      );

      return NextResponse.json({
        success: true,
        action: 'unlinked',
      });

    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use: confirm, reject, or unlink' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Discover POST error:', error);
    return NextResponse.json(
      { error: 'Failed to update market link' },
      { status: 500 }
    );
  }
}
