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
  };
}

/**
 * Track arb persistence - update or create arb opportunity record
 */
export async function trackArbPersistence(
  arb: SingleMarketArb | CrossPlatformArb
): Promise<number> {
  const isSingleMarket = 'type' in arb && arb.type === 'underround';
  const type = isSingleMarket ? 'underround' : 'cross_platform';
  
  // Check if this arb already exists
  const existing = await query<{ id: number; snapshot_count: number }>(
    `SELECT id, snapshot_count FROM arb_opportunities 
     WHERE ${isSingleMarket ? 'market_id' : 'market_pair_id'} = $1 
       AND type = $2 
       AND resolved_at IS NULL`,
    [isSingleMarket ? (arb as SingleMarketArb).marketId : (arb as CrossPlatformArb).pairId, type]
  );
  
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
    // Insert new
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
        isSingleMarket ? (arb as SingleMarketArb).marketId : (arb as CrossPlatformArb).pairId,
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
  type?: 'underround' | 'cross_platform';
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
