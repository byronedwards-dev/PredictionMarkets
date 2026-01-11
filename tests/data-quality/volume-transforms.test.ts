/**
 * Tests for volume transformation logic
 * 
 * Ensures volume data from Polymarket and Kalshi is correctly
 * transformed to our internal format
 */

import {
  transformPolymarketVolume,
  transformKalshiVolume,
  sumVolumes,
  formatVolume,
} from '@/lib/data-transforms';

describe('transformPolymarketVolume', () => {
  it('should calculate 24h volume from weekly volume', () => {
    const result = transformPolymarketVolume(70000, 1000000);
    expect(result.volume24h).toBe(10000); // 70000 / 7
    expect(result.volumeAllTime).toBe(1000000);
  });

  it('should handle zero volumes', () => {
    const result = transformPolymarketVolume(0, 0);
    expect(result.volume24h).toBe(0);
    expect(result.volumeAllTime).toBe(0);
  });

  it('should handle null weekly volume', () => {
    const result = transformPolymarketVolume(null, 500000);
    expect(result.volume24h).toBe(0);
    expect(result.volumeAllTime).toBe(500000);
  });

  it('should handle undefined volumes', () => {
    const result = transformPolymarketVolume(undefined, undefined);
    expect(result.volume24h).toBe(0);
    expect(result.volumeAllTime).toBe(0);
  });

  it('should never return negative volumes', () => {
    // Even if API sends negative (bug), we should clamp to 0
    const result = transformPolymarketVolume(-7000, -1000);
    expect(result.volume24h).toBe(0);
    expect(result.volumeAllTime).toBe(0);
  });

  it('should handle large volumes', () => {
    const result = transformPolymarketVolume(7000000000, 100000000000); // $100B
    expect(result.volume24h).toBe(1000000000);
    expect(result.volumeAllTime).toBe(100000000000);
  });

  it('should handle fractional volumes', () => {
    const result = transformPolymarketVolume(7.77, 100.5);
    expect(result.volume24h).toBeCloseTo(1.11, 2);
    expect(result.volumeAllTime).toBe(100.5);
  });
});

describe('transformKalshiVolume', () => {
  it('should pass through valid volumes', () => {
    const result = transformKalshiVolume(5000, 250000);
    expect(result.volume24h).toBe(5000);
    expect(result.volumeAllTime).toBe(250000);
  });

  it('should handle null 24h volume', () => {
    const result = transformKalshiVolume(null, 100000);
    expect(result.volume24h).toBe(0);
    expect(result.volumeAllTime).toBe(100000);
  });

  it('should handle null all-time volume', () => {
    const result = transformKalshiVolume(5000, null);
    expect(result.volume24h).toBe(5000);
    expect(result.volumeAllTime).toBe(0);
  });

  it('should handle both null', () => {
    const result = transformKalshiVolume(null, null);
    expect(result.volume24h).toBe(0);
    expect(result.volumeAllTime).toBe(0);
  });

  it('should clamp negative volumes to zero', () => {
    const result = transformKalshiVolume(-500, -1000);
    expect(result.volume24h).toBe(0);
    expect(result.volumeAllTime).toBe(0);
  });
});

describe('sumVolumes', () => {
  it('should sum numeric volumes', () => {
    const result = sumVolumes([1000, 2000, 3000]);
    expect(result).toBe(6000);
  });

  it('should handle string volumes', () => {
    const result = sumVolumes(['1000', '2000.50', '3000']);
    expect(result).toBe(6000.5);
  });

  it('should handle mixed types', () => {
    const result = sumVolumes([1000, '2000', null, undefined, 3000]);
    expect(result).toBe(6000);
  });

  it('should treat null as 0', () => {
    const result = sumVolumes([null, null, 1000]);
    expect(result).toBe(1000);
  });

  it('should treat undefined as 0', () => {
    const result = sumVolumes([undefined, 1000, undefined]);
    expect(result).toBe(1000);
  });

  it('should treat NaN strings as 0', () => {
    const result = sumVolumes(['not-a-number', 1000, 'also-not']);
    expect(result).toBe(1000);
  });

  it('should handle empty array', () => {
    const result = sumVolumes([]);
    expect(result).toBe(0);
  });

  it('should handle all null/undefined', () => {
    const result = sumVolumes([null, undefined, null]);
    expect(result).toBe(0);
  });
});

describe('formatVolume', () => {
  it('should format millions', () => {
    expect(formatVolume(1500000)).toBe('$1.5M');
    expect(formatVolume(10000000)).toBe('$10.0M');
  });

  it('should format thousands', () => {
    expect(formatVolume(5000)).toBe('$5K');
    expect(formatVolume(150000)).toBe('$150K');
  });

  it('should format small amounts', () => {
    expect(formatVolume(500)).toBe('$500');
    expect(formatVolume(0)).toBe('$0');
  });

  it('should handle boundary values', () => {
    expect(formatVolume(999)).toBe('$999');
    expect(formatVolume(1000)).toBe('$1K');
    expect(formatVolume(999999)).toBe('$1000K');
    expect(formatVolume(1000000)).toBe('$1.0M');
  });
});
