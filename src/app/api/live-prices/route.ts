import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import dome from '@/lib/dome-api';

export const dynamic = 'force-dynamic';

interface MarketInfo {
  id: number;
  platform: string;
  platformId: string;
  title: string;
}

/**
 * Fetch live prices from Dome API for specific markets
 * POST body: { marketIds: number[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketIds } = body;

    if (!marketIds || !Array.isArray(marketIds) || marketIds.length === 0) {
      return NextResponse.json(
        { error: 'marketIds array required' },
        { status: 400 }
      );
    }

    // Limit to prevent abuse
    if (marketIds.length > 50) {
      return NextResponse.json(
        { error: 'Max 50 markets per request' },
        { status: 400 }
      );
    }

    // Get market info from DB
    const marketsResult = await query<MarketInfo>(`
      SELECT id, platform, platform_id as "platformId", title
      FROM markets
      WHERE id = ANY($1)
    `, [marketIds]);

    const markets = marketsResult.rows;
    const prices: Record<number, { yesPrice: number; noPrice: number; fetchedAt: string }> = {};
    const errors: string[] = [];

    // Fetch prices for each market
    for (const market of markets) {
      try {
        if (market.platform === 'polymarket') {
          // Use getMarketPrice for Polymarket (takes token ID directly)
          const priceData = await dome.polymarket.getMarketPrice(market.platformId);
          if (priceData && typeof priceData.price === 'number') {
            prices[market.id] = {
              yesPrice: priceData.price,
              noPrice: 1 - priceData.price,
              fetchedAt: new Date().toISOString(),
            };
          }
        } else if (market.platform === 'kalshi') {
          // Use getMarkets with market_ticker filter for Kalshi
          const response = await dome.kalshi.getMarkets({ market_ticker: [market.platformId], limit: 1 });
          const kalshiMarket = response.markets?.[0];
          if (kalshiMarket) {
            // Normalize Kalshi price (comes as cents: 1=1¢, 50=50¢, 100=100¢)
            const rawPrice = kalshiMarket.last_price || 0;
            const yesPrice = rawPrice >= 1 ? rawPrice / 100 : rawPrice;
            prices[market.id] = {
              yesPrice,
              noPrice: 1 - yesPrice,
              fetchedAt: new Date().toISOString(),
            };
          }
        }
      } catch (err) {
        errors.push(`Failed to fetch ${market.platform}:${market.platformId}: ${err}`);
      }
    }

    return NextResponse.json({
      prices,
      fetchedAt: new Date().toISOString(),
      marketsRequested: marketIds.length,
      marketsReturned: Object.keys(prices).length,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('Live prices API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch live prices' },
      { status: 500 }
    );
  }
}
