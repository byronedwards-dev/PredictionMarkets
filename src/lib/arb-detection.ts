/**
 * Arbitrage Detection Engine
 * 
 * Detects single-market and cross-platform arbitrage opportunities
 * with fee-adjusted calculations and liquidity awareness
 */

import { query, transaction } from './db';
import { getTotalFee, getCombinedFees } from './fees';

export type ArbQuality = 'executable' | 'thin' | 'theoretical';

export interface PriceSnapshot {
  marketId: number;
  platform: string;
  platformId?: string;  // External ID for building URLs
  yesPrice: number;
  noPrice: number;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  yesBidSize: number;
  yesAskSize: number;
  noBidSize: number;
  noAskSize: number;
  volume24h: number;
}

export interface SingleMarketArb {
  marketId: number;
  platform: string;
  marketTitle: string;
  type: 'underround';
  quality: ArbQuality;
  
  // Prices used
  yesBid: number;
  noBid: number;
  
  // Spread calculations
  grossSpreadPct: number;
  totalFeesPct: number;
  netSpreadPct: number;
  
  // Liquidity
  maxDeployableUsd: number;
  capitalWeightedProfit: number;
}

export interface CrossPlatformArb {
  pairId: number;
  polyMarketId: number;
  kalshiMarketId: number;
  polyTitle: string;
  kalshiTitle: string;
  
  arbDirection: 'poly_yes_kalshi_no' | 'poly_no_kalshi_yes';
  
  // Spread calculations
  grossSpreadPct: number;
  polyFeePct: number;
  kalshiFeePct: number;
  totalFeesPct: number;
  netSpreadPct: number;
  
  // Liquidity
  maxDeployableUsd: number;
  capitalWeightedProfit: number;
  
  quality: ArbQuality;
  strategy: string;
  
  // Snapshot prices for UI display
  polySnapshot: {
    yesBid: number;
    noBid: number;
    yesAsk: number;
    noAsk: number;
  };
  kalshiSnapshot: {
    yesBid: number;
    noBid: number;
    yesAsk: number;
    noAsk: number;
  };
  // Platform IDs for building URLs
  polyPlatformId?: string;
  kalshiPlatformId?: string;
}

export interface MultiOutcomeArb {
  eventName: string;
  platform: string;
  type: 'multi_outcome';
  quality: ArbQuality;
  
  // Outcomes
  outcomeCount: number;
  outcomes: Array<{
    marketId: number;
    title: string;
    yesAsk: number;  // Price to buy YES
    askSize: number;
  }>;
  
  // Spread calculations (cost to buy all outcomes)
  totalCost: number;       // Sum of all YES asks
  grossSpreadPct: number;  // (1 - totalCost) as percentage
  totalFeesPct: number;    // Fee on total investment
  netSpreadPct: number;    // Gross - fees
  
  // Liquidity (min across all outcomes)
  maxDeployableUsd: number;
  capitalWeightedProfit: number;
  
  strategy: string;
}

// Quality classification thresholds (configurable)
const THRESHOLDS = {
  MIN_GROSS_SPREAD: 0.005, // 0.5% minimum gross
  MIN_NET_SPREAD: 0.02, // 2% minimum net for any quality
  EXECUTABLE_MIN_DEPLOY: 1000, // $1,000+
  THIN_MIN_DEPLOY: 100, // $100-$999
};

function isValidPrice(p: number | null | undefined): p is number {
  return typeof p === 'number' && p > 0 && p < 1 && Number.isFinite(p);
}

/**
 * Classify arb quality based on net spread and deployable capital
 */
function classifyQuality(netSpread: number, maxDeployable: number): ArbQuality | null {
  if (netSpread < THRESHOLDS.MIN_NET_SPREAD) {
    return null; // Below threshold
  }
  
  if (maxDeployable >= THRESHOLDS.EXECUTABLE_MIN_DEPLOY) {
    return 'executable';
  } else if (maxDeployable >= THRESHOLDS.THIN_MIN_DEPLOY) {
    return 'thin';
  } else {
    return 'theoretical';
  }
}

/**
 * Detect single-market underround arbitrage
 * 
 * An underround exists when YES_bid + NO_bid < 1.00
 * This means you can buy both sides for less than the guaranteed payout
 */
export function detectSingleMarketArb(
  snapshot: PriceSnapshot,
  marketTitle: string
): SingleMarketArb | null {
  // Guard invalid prices
  if (!isValidPrice(snapshot.yesBid) || !isValidPrice(snapshot.noBid)) {
    return null;
  }
  
  // Use BID prices (what you can actually buy at)
  const sum = snapshot.yesBid + snapshot.noBid;
  const grossSpread = 1 - sum;
  
  // Skip if no gross arb exists
  if (grossSpread < THRESHOLDS.MIN_GROSS_SPREAD) {
    return null;
  }
  
  // Apply fees
  const fee = getTotalFee(snapshot.platform);
  // For underround: you pay fee on YES purchase + fee on NO purchase
  const totalFees = fee * 2;
  const netSpread = grossSpread - totalFees;
  
  // Liquidity calculation
  const maxDeployable = Math.min(snapshot.yesBidSize, snapshot.noBidSize);
  const capitalWeightedProfit = netSpread * maxDeployable;
  
  // Quality classification
  const quality = classifyQuality(netSpread, maxDeployable);
  if (!quality) {
    return null;
  }
  
  return {
    marketId: snapshot.marketId,
    platform: snapshot.platform,
    marketTitle,
    type: 'underround',
    quality,
    yesBid: snapshot.yesBid,
    noBid: snapshot.noBid,
    grossSpreadPct: grossSpread * 100,
    totalFeesPct: totalFees * 100,
    netSpreadPct: netSpread * 100,
    maxDeployableUsd: maxDeployable,
    capitalWeightedProfit,
  };
}

/**
 * Detect cross-platform arbitrage
 * 
 * Finds opportunities where buying YES on one platform and NO on another
 * yields a guaranteed profit
 */
export function detectCrossPlatformArb(
  polySnapshot: PriceSnapshot,
  kalshiSnapshot: PriceSnapshot,
  pairId: number,
  polyTitle: string,
  kalshiTitle: string
): CrossPlatformArb | null {
  // Guard invalid prices
  if (
    !isValidPrice(polySnapshot.yesBid) ||
    !isValidPrice(polySnapshot.noBid) ||
    !isValidPrice(kalshiSnapshot.yesBid) ||
    !isValidPrice(kalshiSnapshot.noBid)
  ) {
    return null;
  }

  // Get current fees
  const polyFee = getTotalFee('polymarket');
  const kalshiFee = getTotalFee('kalshi');
  const totalFees = polyFee + kalshiFee;
  
  // Strategy 1: Buy YES on Poly, Buy NO on Kalshi
  const grossSpread1 = 1 - polySnapshot.yesBid - kalshiSnapshot.noBid;
  const netSpread1 = grossSpread1 - totalFees;
  const maxDeploy1 = Math.min(polySnapshot.yesBidSize, kalshiSnapshot.noBidSize);
  
  // Strategy 2: Buy NO on Poly, Buy YES on Kalshi
  const grossSpread2 = 1 - polySnapshot.noBid - kalshiSnapshot.yesBid;
  const netSpread2 = grossSpread2 - totalFees;
  const maxDeploy2 = Math.min(polySnapshot.noBidSize, kalshiSnapshot.yesBidSize);
  
  // Find best strategy
  let best: {
    spread: number;
    grossSpread: number;
    deploy: number;
    dir: 'poly_yes_kalshi_no' | 'poly_no_kalshi_yes';
  } | null = null;
  
  if (netSpread1 >= THRESHOLDS.MIN_NET_SPREAD) {
    best = { spread: netSpread1, grossSpread: grossSpread1, deploy: maxDeploy1, dir: 'poly_yes_kalshi_no' };
  }
  if (netSpread2 >= THRESHOLDS.MIN_NET_SPREAD && (!best || netSpread2 > best.spread)) {
    best = { spread: netSpread2, grossSpread: grossSpread2, deploy: maxDeploy2, dir: 'poly_no_kalshi_yes' };
  }
  
  if (!best) {
    return null;
  }
  
  // Quality classification
  const quality = classifyQuality(best.spread, best.deploy);
  if (!quality) {
    return null;
  }
  
  const strategy = best.dir === 'poly_yes_kalshi_no'
    ? `Buy YES @ ${polySnapshot.yesBid.toFixed(2)} on Poly, Buy NO @ ${kalshiSnapshot.noBid.toFixed(2)} on Kalshi`
    : `Buy NO @ ${polySnapshot.noBid.toFixed(2)} on Poly, Buy YES @ ${kalshiSnapshot.yesBid.toFixed(2)} on Kalshi`;
  
  return {
    pairId,
    polyMarketId: polySnapshot.marketId,
    kalshiMarketId: kalshiSnapshot.marketId,
    polyTitle,
    kalshiTitle,
    arbDirection: best.dir,
    grossSpreadPct: best.grossSpread * 100,
    polyFeePct: polyFee * 100,
    kalshiFeePct: kalshiFee * 100,
    totalFeesPct: totalFees * 100,
    netSpreadPct: best.spread * 100,
    maxDeployableUsd: best.deploy,
    capitalWeightedProfit: best.spread * best.deploy,
    quality,
    strategy,
    // Include snapshot prices for UI display
    polySnapshot: {
      yesBid: polySnapshot.yesBid,
      noBid: polySnapshot.noBid,
      yesAsk: polySnapshot.yesAsk,
      noAsk: polySnapshot.noAsk,
    },
    kalshiSnapshot: {
      yesBid: kalshiSnapshot.yesBid,
      noBid: kalshiSnapshot.noBid,
      yesAsk: kalshiSnapshot.yesAsk,
      noAsk: kalshiSnapshot.noAsk,
    },
    // Platform IDs for building URLs
    polyPlatformId: polySnapshot.platformId,
    kalshiPlatformId: kalshiSnapshot.platformId,
  };
}

/**
 * Detect multi-outcome arbitrage opportunities
 * 
 * An arb exists when the sum of YES asks for all outcomes < 1.00
 * This means you can buy all outcomes for less than the guaranteed $1 payout
 * 
 * For Kalshi: Uses event_id (event_ticker) to group related markets - reliable!
 * For Polymarket: Falls back to title pattern matching since they don't have explicit event grouping
 */
export async function detectMultiOutcomeArbs(
  platform: 'polymarket' | 'kalshi'
): Promise<MultiOutcomeArb[]> {
  const arbs: MultiOutcomeArb[] = [];
  const fee = getTotalFee(platform);
  
  if (platform === 'kalshi') {
    // KALSHI: Use event_id (event_ticker) for reliable grouping
    // Find events with 3+ open markets (multi-outcome events)
    const eventsResult = await query<{
      event_id: string;
      market_count: string;
      sample_title: string;
    }>(`
      SELECT 
        m.event_id,
        COUNT(*)::TEXT as market_count,
        MIN(m.title) as sample_title
      FROM markets m
      WHERE m.platform = 'kalshi'
        AND m.status = 'open'
        AND m.event_id IS NOT NULL
      GROUP BY m.event_id
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);
    
    for (const event of eventsResult.rows) {
      // Get all markets for this event with latest prices
      const marketsResult = await query<{
        market_id: number;
        title: string;
        yes_ask: string;
        yes_ask_size: string;
      }>(`
        SELECT m.id as market_id, m.title, ps.yes_ask, ps.yes_ask_size
        FROM markets m
        JOIN LATERAL (
          SELECT yes_ask, yes_ask_size 
          FROM price_snapshots 
          WHERE market_id = m.id 
          ORDER BY snapshot_at DESC 
          LIMIT 1
        ) ps ON true
        WHERE m.platform = 'kalshi'
          AND m.event_id = $1
          AND m.status = 'open'
          AND ps.yes_ask > 0
          AND ps.yes_ask < 1
        ORDER BY ps.yes_ask DESC
      `, [event.event_id]);
      
      if (marketsResult.rows.length < 3) continue;
      
      const arb = evaluateMultiOutcomeArb(
        marketsResult.rows,
        event.event_id, // Use event_ticker as the name
        platform,
        fee
      );
      
      if (arb) arbs.push(arb);
    }
  } else {
    // POLYMARKET: Fall back to title pattern matching
    // Since Polymarket uses condition_id per market (1:1 ratio), we have to guess groupings
    const eventPatterns = [
      { pattern: '%Super Bowl%', name: 'Super Bowl Winner' },
      { pattern: '%NBA Finals%', name: 'NBA Finals Winner' },
      { pattern: '%Champions League%winner%', name: 'Champions League Winner' },
      { pattern: '%Premier League%winner%', name: 'Premier League Winner' },
      { pattern: '%Democratic presidential nomination%', name: 'Dem 2028 Nominee' },
      { pattern: '%Republican presidential nomination%', name: 'GOP 2028 Nominee' },
      { pattern: '%Fed Chair%', name: 'Fed Chair Nominee' },
      { pattern: '%Treasury Secretary%', name: 'Treasury Secretary' },
      { pattern: '%World Series%', name: 'World Series Winner' },
      { pattern: '%Stanley Cup%', name: 'Stanley Cup Winner' },
    ];
    
    for (const { pattern, name } of eventPatterns) {
      const result = await query<{
        market_id: number;
        title: string;
        yes_ask: string;
        yes_ask_size: string;
      }>(`
        SELECT m.id as market_id, m.title, ps.yes_ask, ps.yes_ask_size
        FROM markets m
        JOIN LATERAL (
          SELECT yes_ask, yes_ask_size 
          FROM price_snapshots 
          WHERE market_id = m.id 
          ORDER BY snapshot_at DESC 
          LIMIT 1
        ) ps ON true
        WHERE m.platform = 'polymarket'
          AND m.status = 'open'
          AND m.title ILIKE $1
          AND ps.yes_ask > 0
          AND ps.yes_ask < 1
        ORDER BY ps.yes_ask DESC
      `, [pattern]);
      
      if (result.rows.length < 3) continue;
      
      const arb = evaluateMultiOutcomeArb(result.rows, name, platform, fee);
      if (arb) arbs.push(arb);
    }
  }
  
  return arbs;
}

/**
 * Helper to evaluate a multi-outcome arb opportunity
 */
function evaluateMultiOutcomeArb(
  rows: Array<{ market_id: number; title: string; yes_ask: string; yes_ask_size: string }>,
  eventName: string,
  platform: string,
  fee: number
): MultiOutcomeArb | null {
  const outcomes = rows.map(r => ({
    marketId: r.market_id,
    title: r.title,
    yesAsk: parseFloat(r.yes_ask),
    askSize: parseFloat(r.yes_ask_size),
  }));
  
  // Calculate totals
  const totalCost = outcomes.reduce((sum, o) => sum + o.yesAsk, 0);
  const grossSpread = 1 - totalCost;
  
  // Fee is percentage of total investment
  const totalFees = fee * totalCost;
  const netSpread = grossSpread - totalFees;
  
  // Skip if not profitable
  if (netSpread < THRESHOLDS.MIN_NET_SPREAD) return null;
  
  // Liquidity is the minimum across all outcomes
  const maxDeployable = Math.min(...outcomes.map(o => o.askSize));
  
  const quality = classifyQuality(netSpread, maxDeployable);
  if (!quality) return null;
  
  const strategy = `Buy all ${outcomes.length} outcomes for ${(totalCost * 100).toFixed(1)}¢, collect $1. Net: ${(netSpread * 100).toFixed(1)}¢`;
  
  return {
    eventName,
    platform,
    type: 'multi_outcome',
    quality,
    outcomeCount: outcomes.length,
    outcomes,
    totalCost,
    grossSpreadPct: grossSpread * 100,
    totalFeesPct: totalFees * 100,
    netSpreadPct: netSpread * 100,
    maxDeployableUsd: maxDeployable,
    capitalWeightedProfit: netSpread * maxDeployable,
    strategy,
  };
}

/**
 * Track arb persistence - update or create arb opportunity record
 */
export async function trackArbPersistence(
  arb: SingleMarketArb | CrossPlatformArb | MultiOutcomeArb
): Promise<number> {
  const isSingleMarket = 'type' in arb && arb.type === 'underround';
  const isMultiOutcome = 'type' in arb && arb.type === 'multi_outcome';
  const type = isSingleMarket ? 'underround' : isMultiOutcome ? 'multi_outcome' : 'cross_platform';
  
  // For multi-outcome, use event name as identifier (stored in details)
  // For single market, use market_id
  // For cross-platform, use market_pair_id
  let identifier: string | number;
  let identifierColumn: string;
  
  if (isMultiOutcome) {
    identifier = (arb as MultiOutcomeArb).eventName;
    identifierColumn = 'event_name';
  } else if (isSingleMarket) {
    identifier = (arb as SingleMarketArb).marketId;
    identifierColumn = 'market_id';
  } else {
    identifier = (arb as CrossPlatformArb).pairId;
    identifierColumn = 'market_pair_id';
  }
  
  // Check if this arb already exists
  // For multi-outcome, we check by type and event name in details
  const existingQuery = isMultiOutcome
    ? `SELECT id, snapshot_count FROM arb_opportunities 
       WHERE type = $1 AND details->>'eventName' = $2 AND resolved_at IS NULL`
    : `SELECT id, snapshot_count FROM arb_opportunities 
       WHERE ${identifierColumn} = $1 AND type = $2 AND resolved_at IS NULL`;
  
  const existingParams = isMultiOutcome 
    ? [type, identifier]
    : [identifier, type];
  
  const existing = await query<{ id: number; snapshot_count: number }>(existingQuery, existingParams);
  
  const details = JSON.stringify(arb);
  
  if (existing.rows.length > 0) {
    // Update existing
    await query(
      `UPDATE arb_opportunities 
       SET last_seen_at = NOW(),
           snapshot_count = snapshot_count + 1,
           duration_seconds = EXTRACT(EPOCH FROM (NOW() - detected_at))::INTEGER,
           net_spread_pct = $1,
           max_deployable_usd = $2,
           quality = $3,
           gross_spread_pct = $4,
           total_fees_pct = $5,
           capital_weighted_spread = $6,
           details = $7
       WHERE id = $8`,
      [
        arb.netSpreadPct,
        arb.maxDeployableUsd,
        arb.quality,
        arb.grossSpreadPct,
        arb.totalFeesPct,
        arb.capitalWeightedProfit,
        details,
        existing.rows[0].id,
      ]
    );
    return existing.rows[0].id;
  } else {
    // Insert new - for multi-outcome, we don't have a market_id or pair_id
    if (isMultiOutcome) {
      const result = await query<{ id: number }>(
        `INSERT INTO arb_opportunities (
          type, quality,
          gross_spread_pct, total_fees_pct, net_spread_pct,
          max_deployable_usd, capital_weighted_spread, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          type,
          arb.quality,
          arb.grossSpreadPct,
          arb.totalFeesPct,
          arb.netSpreadPct,
          arb.maxDeployableUsd,
          arb.capitalWeightedProfit,
          details,
        ]
      );
      return result.rows[0].id;
    } else {
      const result = await query<{ id: number }>(
        `INSERT INTO arb_opportunities (
          type, quality, 
          ${isSingleMarket ? 'market_id' : 'market_pair_id'},
          gross_spread_pct, total_fees_pct, net_spread_pct,
          max_deployable_usd, capital_weighted_spread, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          type,
          arb.quality,
          identifier,
          arb.grossSpreadPct,
          arb.totalFeesPct,
          arb.netSpreadPct,
          arb.maxDeployableUsd,
          arb.capitalWeightedProfit,
          details,
        ]
      );
      return result.rows[0].id;
    }
  }
}

/**
 * Close stale arbs that haven't been seen recently
 */
export async function closeStaleArbs(staleMinutes: number = 10): Promise<number> {
  const result = await query(
    `UPDATE arb_opportunities 
     SET resolved_at = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - detected_at))::INTEGER
     WHERE resolved_at IS NULL 
       AND last_seen_at < NOW() - INTERVAL '${staleMinutes} minutes'`
  );
  
  return result.rowCount || 0;
}

/**
 * Get active arbitrage opportunities
 */
export async function getActiveArbs(filters?: {
  type?: 'underround' | 'cross_platform' | 'multi_outcome';
  quality?: ArbQuality[];
  minNetSpread?: number;
  minDeployable?: number;
}): Promise<{
  id: number;
  type: string;
  quality: ArbQuality;
  marketId: number | null;
  marketPairId: number | null;
  grossSpreadPct: number;
  totalFeesPct: number;
  netSpreadPct: number;
  maxDeployableUsd: number;
  capitalWeightedSpread: number;
  detectedAt: Date;
  lastSeenAt: Date;
  snapshotCount: number;
  durationSeconds: number;
  details: Record<string, unknown>;
}[]> {
  let sql = `
    SELECT * FROM arb_opportunities 
    WHERE resolved_at IS NULL
  `;
  const params: unknown[] = [];
  let paramIndex = 1;
  
  if (filters?.type) {
    sql += ` AND type = $${paramIndex++}`;
    params.push(filters.type);
  }
  
  if (filters?.quality && filters.quality.length > 0) {
    sql += ` AND quality = ANY($${paramIndex++})`;
    params.push(filters.quality);
  }
  
  if (filters?.minNetSpread) {
    sql += ` AND net_spread_pct >= $${paramIndex++}`;
    params.push(filters.minNetSpread);
  }
  
  if (filters?.minDeployable) {
    sql += ` AND max_deployable_usd >= $${paramIndex++}`;
    params.push(filters.minDeployable);
  }
  
  sql += ` ORDER BY net_spread_pct DESC, max_deployable_usd DESC`;
  
  const result = await query<{
    id: number;
    type: string;
    quality: ArbQuality;
    market_id: number | null;
    market_pair_id: number | null;
    gross_spread_pct: string;
    total_fees_pct: string;
    net_spread_pct: string;
    max_deployable_usd: string;
    capital_weighted_spread: string;
    detected_at: Date;
    last_seen_at: Date;
    snapshot_count: number;
    duration_seconds: number;
    details: Record<string, unknown>;
  }>(sql, params);
  
  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    quality: row.quality,
    marketId: row.market_id,
    marketPairId: row.market_pair_id,
    grossSpreadPct: parseFloat(row.gross_spread_pct),
    totalFeesPct: parseFloat(row.total_fees_pct),
    netSpreadPct: parseFloat(row.net_spread_pct),
    maxDeployableUsd: parseFloat(row.max_deployable_usd),
    capitalWeightedSpread: parseFloat(row.capital_weighted_spread),
    detectedAt: row.detected_at,
    lastSeenAt: row.last_seen_at,
    snapshotCount: row.snapshot_count,
    durationSeconds: row.duration_seconds,
    details: row.details,
  }));
}

/**
 * Get arb statistics for the reality check dashboard
 */
export async function getArbStats(days: number = 7): Promise<{
  totalDetected: number;
  persisted5min: number;
  persisted30min: number;
  byQuality: Record<ArbQuality, number>;
  avgNetSpread: number;
  medianDeployable: number;
  totalDeployableOpportunity: number;
}> {
  const result = await query<{
    total: string;
    persisted_5min: string;
    persisted_30min: string;
    executable_count: string;
    thin_count: string;
    theoretical_count: string;
    avg_net_spread: string;
    median_deployable: string;
    total_deployable: string;
  }>(`
    SELECT 
      COUNT(*)::TEXT as total,
      COUNT(*) FILTER (WHERE duration_seconds >= 300)::TEXT as persisted_5min,
      COUNT(*) FILTER (WHERE duration_seconds >= 1800)::TEXT as persisted_30min,
      COUNT(*) FILTER (WHERE quality = 'executable')::TEXT as executable_count,
      COUNT(*) FILTER (WHERE quality = 'thin')::TEXT as thin_count,
      COUNT(*) FILTER (WHERE quality = 'theoretical')::TEXT as theoretical_count,
      AVG(net_spread_pct)::TEXT as avg_net_spread,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY max_deployable_usd)::TEXT as median_deployable,
      SUM(max_deployable_usd)::TEXT as total_deployable
    FROM arb_opportunities
    WHERE detected_at >= NOW() - INTERVAL '${days} days'
  `);
  
  const row = result.rows[0];
  
  return {
    totalDetected: parseInt(row.total) || 0,
    persisted5min: parseInt(row.persisted_5min) || 0,
    persisted30min: parseInt(row.persisted_30min) || 0,
    byQuality: {
      executable: parseInt(row.executable_count) || 0,
      thin: parseInt(row.thin_count) || 0,
      theoretical: parseInt(row.theoretical_count) || 0,
    },
    avgNetSpread: parseFloat(row.avg_net_spread) || 0,
    medianDeployable: parseFloat(row.median_deployable) || 0,
    totalDeployableOpportunity: parseFloat(row.total_deployable) || 0,
  };
}
