/**
 * Volume Spike Detection
 * 
 * Uses Dome API candlestick data to detect unusual volume activity
 * and generate alerts for markets worth monitoring
 */

import { query } from './db';
import dome, { CandlestickData } from './dome-api';

// Configuration
const VOLUME_SPIKE_THRESHOLD = 2.0;  // 2x average volume triggers alert
const LOOKBACK_HOURS = 24;            // Compare against last 24h average
const MIN_VOLUME_USD = 1000;          // Minimum volume to consider (avoid noise)

export interface VolumeAlert {
  marketId: number;
  platform: string;
  title: string;
  currentVolumeUsd: number;
  rollingAvg24h: number;
  multiplier: number;
  zScore: number;
  alertedAt: Date;
}

/**
 * Calculate rolling statistics from candlestick data
 */
function calculateVolumeStats(candles: CandlestickData[]): {
  avg: number;
  stddev: number;
  total: number;
} {
  if (candles.length === 0) {
    return { avg: 0, stddev: 0, total: 0 };
  }
  
  const volumes = candles.map(c => c.volume);
  const total = volumes.reduce((sum, v) => sum + v, 0);
  const avg = total / volumes.length;
  
  if (volumes.length < 2) {
    return { avg, stddev: 0, total };
  }
  
  const squaredDiffs = volumes.map(v => Math.pow(v - avg, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / (volumes.length - 1);
  const stddev = Math.sqrt(variance);
  
  return { avg, stddev, total };
}

/**
 * Detect volume spike for a single Polymarket market using candlesticks
 */
export async function detectVolumeSpike(
  marketId: number,
  tokenId: string,
  title: string
): Promise<VolumeAlert | null> {
  try {
    const now = Date.now();
    const lookbackMs = LOOKBACK_HOURS * 60 * 60 * 1000;
    
    // Fetch hourly candles for the lookback period
    const response = await dome.polymarket.getCandlesticks({
      token_id: tokenId,
      interval: '1h',
      start_time: now - lookbackMs,
      end_time: now,
    });
    
    const candles = response.candles || [];
    
    if (candles.length < 3) {
      // Not enough data for meaningful comparison
      return null;
    }
    
    // Get stats for all but the most recent candle (historical baseline)
    const historicalCandles = candles.slice(0, -1);
    const { avg, stddev } = calculateVolumeStats(historicalCandles);
    
    // Get the most recent candle's volume
    const latestCandle = candles[candles.length - 1];
    const currentVolume = latestCandle.volume;
    
    // Skip low-volume markets
    if (currentVolume < MIN_VOLUME_USD || avg < MIN_VOLUME_USD / 10) {
      return null;
    }
    
    // Calculate multiplier and z-score
    const multiplier = avg > 0 ? currentVolume / avg : 0;
    const zScore = stddev > 0 ? (currentVolume - avg) / stddev : 0;
    
    // Check if this qualifies as a spike
    if (multiplier < VOLUME_SPIKE_THRESHOLD) {
      return null;
    }
    
    return {
      marketId,
      platform: 'polymarket',
      title,
      currentVolumeUsd: currentVolume,
      rollingAvg24h: avg,
      multiplier,
      zScore,
      alertedAt: new Date(),
    };
  } catch (err) {
    // Silently fail for individual markets - don't break the sync
    console.warn(`Volume check failed for market ${marketId}: ${err}`);
    return null;
  }
}

/**
 * Store a volume alert in the database
 */
export async function storeVolumeAlert(alert: VolumeAlert): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO volume_alerts (
      market_id, volume_usd, rolling_avg_7d, rolling_stddev_7d, z_score, multiplier
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id`,
    [
      alert.marketId,
      alert.currentVolumeUsd,
      alert.rollingAvg24h,
      0, // stddev - we're using multiplier instead
      alert.zScore,
      alert.multiplier,
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Get recent volume alerts
 */
export async function getRecentAlerts(hours: number = 24): Promise<{
  id: number;
  marketId: number;
  title: string;
  platform: string;
  volumeUsd: number;
  multiplier: number;
  alertedAt: Date;
}[]> {
  const result = await query<{
    id: number;
    market_id: number;
    title: string;
    platform: string;
    volume_usd: string;
    multiplier: string;
    alert_at: Date;
  }>(
    `SELECT va.id, va.market_id, m.title, m.platform, 
            va.volume_usd, va.multiplier, va.alert_at
     FROM volume_alerts va
     JOIN markets m ON m.id = va.market_id
     WHERE va.alert_at > NOW() - INTERVAL '${hours} hours'
     ORDER BY va.multiplier DESC, va.alert_at DESC
     LIMIT 50`
  );
  
  return result.rows.map(row => ({
    id: row.id,
    marketId: row.market_id,
    title: row.title,
    platform: row.platform,
    volumeUsd: parseFloat(row.volume_usd),
    multiplier: parseFloat(row.multiplier),
    alertedAt: row.alert_at,
  }));
}

/**
 * Alternative: Detect volume spike using snapshot deltas
 * This uses your existing snapshot data without additional API calls
 */
export async function detectVolumeSpikeFromSnapshots(
  marketId: number
): Promise<{ multiplier: number; currentVolume: number; avgVolume: number } | null> {
  // Get the last 24h of snapshots (assuming 5-min intervals = ~288 snapshots)
  const result = await query<{
    volume_24h: string;
    snapshot_at: Date;
  }>(
    `SELECT volume_24h, snapshot_at
     FROM price_snapshots
     WHERE market_id = $1
       AND snapshot_at > NOW() - INTERVAL '24 hours'
     ORDER BY snapshot_at DESC
     LIMIT 288`,
    [marketId]
  );
  
  if (result.rows.length < 12) {
    // Need at least 1 hour of data
    return null;
  }
  
  // Current volume is from the most recent snapshot
  const currentVolume = parseFloat(result.rows[0].volume_24h) || 0;
  
  // Calculate average volume from older snapshots
  const olderSnapshots = result.rows.slice(12); // Skip the last hour
  if (olderSnapshots.length === 0) return null;
  
  const avgVolume = olderSnapshots.reduce((sum, s) => sum + (parseFloat(s.volume_24h) || 0), 0) / olderSnapshots.length;
  
  if (avgVolume < MIN_VOLUME_USD) return null;
  
  const multiplier = avgVolume > 0 ? currentVolume / avgVolume : 0;
  
  return { multiplier, currentVolume, avgVolume };
}

/**
 * Batch check multiple markets for volume spikes
 */
export async function checkVolumeSpikes(
  markets: Array<{ id: number; tokenId: string; title: string }>
): Promise<VolumeAlert[]> {
  const alerts: VolumeAlert[] = [];
  
  // Process in small batches to respect rate limits
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(m => detectVolumeSpike(m.id, m.tokenId, m.title))
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        alerts.push(result.value);
        await storeVolumeAlert(result.value);
      }
    }
    
    // Small delay between batches
    if (i + BATCH_SIZE < markets.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return alerts;
}
