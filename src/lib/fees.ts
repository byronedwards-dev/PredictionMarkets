import { query } from './db';

export interface PlatformFees {
  platform: string;
  takerFeePct: number;
  makerFeePct: number;
  settlementFeePct: number;
  withdrawalFeeFlat: number;
  feeNotes: string | null;
  lastVerifiedAt: Date | null;
}

// Cache fees in memory, refresh on startup and when updated
let feeCache: Map<string, PlatformFees> = new Map();
let cacheLoadedAt: Date | null = null;

// Default fees (used if database not yet configured)
const DEFAULT_FEES: Record<string, PlatformFees> = {
  polymarket: {
    platform: 'polymarket',
    takerFeePct: 0.02,
    makerFeePct: 0,
    settlementFeePct: 0,
    withdrawalFeeFlat: 0,
    feeNotes: 'Approx 2% spread-based fee, varies by market liquidity',
    lastVerifiedAt: null,
  },
  kalshi: {
    platform: 'kalshi',
    takerFeePct: 0.01,
    makerFeePct: 0,
    settlementFeePct: 0,
    withdrawalFeeFlat: 0,
    feeNotes: 'Approximately $0.01-0.02 per contract, modeled as 1%',
    lastVerifiedAt: null,
  },
};

export async function loadFees(): Promise<void> {
  try {
    const result = await query<{
      platform: string;
      taker_fee_pct: string;
      maker_fee_pct: string;
      settlement_fee_pct: string;
      withdrawal_fee_flat: string;
      fee_notes: string | null;
      last_verified_at: Date | null;
    }>('SELECT * FROM platform_config');

    feeCache.clear();
    
    for (const config of result.rows) {
      feeCache.set(config.platform, {
        platform: config.platform,
        takerFeePct: parseFloat(config.taker_fee_pct),
        makerFeePct: parseFloat(config.maker_fee_pct),
        settlementFeePct: parseFloat(config.settlement_fee_pct),
        withdrawalFeeFlat: parseFloat(config.withdrawal_fee_flat),
        feeNotes: config.fee_notes,
        lastVerifiedAt: config.last_verified_at,
      });
    }
    
    cacheLoadedAt = new Date();
    console.log(`Fee cache loaded: ${feeCache.size} platforms`);
  } catch (error) {
    console.warn('Failed to load fees from database, using defaults:', error);
    // Use defaults
    feeCache = new Map(Object.entries(DEFAULT_FEES));
  }
}

export function getFees(platform: string): PlatformFees {
  const fees = feeCache.get(platform);
  if (fees) return fees;

  // Return default if not in cache
  const defaultFee = DEFAULT_FEES[platform];
  if (defaultFee) return defaultFee;

  // Conservative fallback
  return {
    platform,
    takerFeePct: 0.02,
    makerFeePct: 0,
    settlementFeePct: 0,
    withdrawalFeeFlat: 0,
    feeNotes: 'Default conservative estimate',
    lastVerifiedAt: null,
  };
}

export function getTotalFee(platform: string, isMaker: boolean = false): number {
  const fees = getFees(platform);
  const tradeFee = isMaker ? fees.makerFeePct : fees.takerFeePct;
  return tradeFee + fees.settlementFeePct;
}

// For cross-platform arbs
export function getCombinedFees(platform1: string, platform2: string): number {
  return getTotalFee(platform1) + getTotalFee(platform2);
}

// Get all fees for display
export function getAllFees(): PlatformFees[] {
  // Ensure cache is populated with at least defaults
  if (feeCache.size === 0) {
    return Object.values(DEFAULT_FEES);
  }
  return Array.from(feeCache.values());
}

// Update fee configuration
export async function updateFee(
  platform: string,
  field: 'taker_fee_pct' | 'maker_fee_pct' | 'settlement_fee_pct',
  newValue: number,
  reason?: string
): Promise<void> {
  const oldValue = getFees(platform);
  const oldFieldValue = field === 'taker_fee_pct' 
    ? oldValue.takerFeePct 
    : field === 'maker_fee_pct'
    ? oldValue.makerFeePct
    : oldValue.settlementFeePct;

  // Update the config
  await query(
    `UPDATE platform_config SET ${field} = $1, updated_at = NOW() WHERE platform = $2`,
    [newValue, platform]
  );

  // Log the change
  await query(
    `INSERT INTO platform_fee_history (platform, field_changed, old_value, new_value, change_reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [platform, field, oldFieldValue, newValue, reason || null]
  );

  // Reload cache
  await loadFees();
}

// Get fee change history
export async function getFeeHistory(platform?: string): Promise<{
  platform: string;
  fieldChanged: string;
  oldValue: number;
  newValue: number;
  changedAt: Date;
  changeReason: string | null;
}[]> {
  const result = await query<{
    platform: string;
    field_changed: string;
    old_value: string;
    new_value: string;
    changed_at: Date;
    change_reason: string | null;
  }>(
    platform
      ? 'SELECT * FROM platform_fee_history WHERE platform = $1 ORDER BY changed_at DESC'
      : 'SELECT * FROM platform_fee_history ORDER BY changed_at DESC',
    platform ? [platform] : undefined
  );

  return result.rows.map((row) => ({
    platform: row.platform,
    fieldChanged: row.field_changed,
    oldValue: parseFloat(row.old_value),
    newValue: parseFloat(row.new_value),
    changedAt: row.changed_at,
    changeReason: row.change_reason,
  }));
}

// Initialize fees on module load
loadFees().catch(console.error);
