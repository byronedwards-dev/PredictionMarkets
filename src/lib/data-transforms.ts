/**
 * Data transformation utilities
 * 
 * These functions handle the mapping and transformation of market data
 * from external APIs to our internal format. Extracted for testability.
 */

// ============================================
// Event Grouping
// ============================================

/**
 * Extract event name from market title for grouping
 */
export function extractEventName(
  title: string, 
  platform: string, 
  eventId: string | null
): { key: string; name: string } {
  // Handle empty/null title
  if (!title || title.trim() === '') {
    return { key: `unknown-${platform}`, name: 'Unknown Market' };
  }

  // Kalshi: Use event_id directly (e.g., KXSB-26 → "Super Bowl 2026")
  if (platform === 'kalshi' && eventId) {
    // Parse Kalshi event patterns
    const kalshiPatterns: Record<string, string> = {
      'KXSB': 'Super Bowl',
      'KXNCAAF': 'College Football Playoff',
      'KXNBACHAMP': 'NBA Championship',
      'KXNFLGAME': 'NFL Game',
      'KXNBAGAME': 'NBA Game',
      'KXBTCMAXY': 'Bitcoin Maximum',
      'KXBTCMINY': 'Bitcoin Minimum',
      'KXETHMAXY': 'Ethereum Maximum',
      'KXRATECUTCOUNT': 'Fed Rate Cuts',
      'KXLLM': 'AI Models',
    };
    
    for (const [prefix, name] of Object.entries(kalshiPatterns)) {
      if (eventId.startsWith(prefix)) {
        return { key: eventId, name: `${name} (${eventId})` };
      }
    }
    return { key: eventId, name: eventId };
  }
  
  // Polymarket: Extract event from title patterns
  const patterns = [
    // Presidential elections - Party-based (Democrats/Republicans winning election)
    { regex: /\b(Democrats|Republicans)\b.*(\d{4}) US [Pp]residential [Ee]lection/i, group: '$2 US Presidential Election (Party)' },
    // Presidential elections - Candidate-based (individual candidates)
    { regex: /(\d{4}) US [Pp]residential [Ee]lection/i, group: '$1 US Presidential Election (Candidate)' },
    // Presidential nominations/primaries
    { regex: /(\d{4}) (Democratic|Republican) presidential (nomination|primary)/i, group: '$1 $2 Presidential $3' },
    // Sports championships
    { regex: /Super Bowl (\d{4})/i, group: 'Super Bowl $1' },
    { regex: /(\d{4}) (NBA|NFL|MLB|NHL) (Finals|Championship|Playoffs)/i, group: '$1 $2 $3' },
    { regex: /(\d{4})[–-](\d{2,4}) (English Premier League|Champions League|La Liga|Serie A|Bundesliga)/i, group: '$1-$2 $3' },
    { regex: /(\d{4}) (NBA|NFL) (Finals|Championship)/i, group: '$1 $2 $3' },
    // Fed/Economic
    { regex: /(Fed|Federal Reserve).*(rate|interest)/i, group: 'Federal Reserve Rates' },
    { regex: /Trump.*Fed/i, group: 'Trump & Federal Reserve' },
    // Crypto
    { regex: /(Bitcoin|BTC).*(price|\$)/i, group: 'Bitcoin Price' },
    { regex: /(Ethereum|ETH).*(price|\$)/i, group: 'Ethereum Price' },
  ];
  
  for (const { regex, group } of patterns) {
    const match = title.match(regex);
    if (match) {
      let eventName = group;
      for (let i = 1; i < match.length; i++) {
        eventName = eventName.replace(`$${i}`, match[i]);
      }
      return { key: eventName.toLowerCase().replace(/\s+/g, '-'), name: eventName };
    }
  }
  
  // Default: Use first meaningful part of title (up to first question mark or 60 chars)
  const shortTitle = title.split('?')[0].substring(0, 60).trim();
  return { 
    key: `single-${platform}-${shortTitle.toLowerCase().replace(/\s+/g, '-').substring(0, 30)}`, 
    name: shortTitle 
  };
}

// ============================================
// Volume Transformations
// ============================================

export interface VolumeData {
  volume24h: number;
  volumeAllTime: number;
}

/**
 * Transform Polymarket volume fields to our internal format
 * Polymarket provides: volume_1_week, volume_1_month, volume_1_year, volume_total
 */
export function transformPolymarketVolume(
  volume1Week: number | null | undefined,
  volumeTotal: number | null | undefined
): VolumeData {
  // Estimate 24h volume as weekly / 7
  const volume24h = (volume1Week ?? 0) / 7;
  const volumeAllTime = volumeTotal ?? 0;
  
  return {
    volume24h: Math.max(0, volume24h), // Ensure non-negative
    volumeAllTime: Math.max(0, volumeAllTime),
  };
}

/**
 * Transform Kalshi volume fields to our internal format
 * Kalshi provides: volume (all-time), volume_24h
 */
export function transformKalshiVolume(
  volume24h: number | null | undefined,
  volumeAllTime: number | null | undefined
): VolumeData {
  return {
    volume24h: Math.max(0, volume24h ?? 0),
    volumeAllTime: Math.max(0, volumeAllTime ?? 0),
  };
}

// ============================================
// Price Transformations
// ============================================

export interface PriceData {
  yesPrice: number;
  noPrice: number;
  isValid: boolean;
}

/**
 * Validate and normalize price data
 * Prices should be between 0 and 1
 */
export function validatePrices(
  yesPrice: number | null | undefined,
  noPrice: number | null | undefined
): PriceData {
  const yes = yesPrice ?? 0;
  const no = noPrice ?? 0;
  
  // Check if prices are in valid range
  const isValid = yes >= 0 && yes <= 1 && no >= 0 && no <= 1;
  
  // Clamp to valid range
  return {
    yesPrice: Math.max(0, Math.min(1, yes)),
    noPrice: Math.max(0, Math.min(1, no)),
    isValid,
  };
}

/**
 * Calculate spread from bid prices
 * Spread = 1 - yesBid - noBid (should be small positive number for liquid markets)
 */
export function calculateSpread(yesBid: number, noBid: number): number {
  const spread = 1 - yesBid - noBid;
  return spread;
}

// ============================================
// Volume Aggregation
// ============================================

/**
 * Safely sum volumes, treating null/undefined/NaN as 0
 */
export function sumVolumes(volumes: (number | string | null | undefined)[]): number {
  return volumes.reduce((sum: number, vol) => {
    const parsed = typeof vol === 'string' ? parseFloat(vol) : vol;
    const value = parsed ?? 0;
    return sum + (isNaN(value) ? 0 : value);
  }, 0);
}

/**
 * Format volume for display
 */
export function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}
