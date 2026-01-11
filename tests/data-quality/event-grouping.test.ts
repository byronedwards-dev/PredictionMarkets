/**
 * Tests for event grouping logic
 * 
 * Ensures markets are correctly grouped by event based on title patterns
 */

import { extractEventName } from '@/lib/data-transforms';

describe('extractEventName', () => {
  describe('Kalshi event ID parsing', () => {
    it('should parse Super Bowl event IDs', () => {
      const result = extractEventName('Will Chiefs win Super Bowl?', 'kalshi', 'KXSB-26');
      expect(result.key).toBe('KXSB-26');
      expect(result.name).toBe('Super Bowl (KXSB-26)');
    });

    it('should parse NBA Championship event IDs', () => {
      const result = extractEventName('Lakers to win?', 'kalshi', 'KXNBACHAMP-2026');
      expect(result.key).toBe('KXNBACHAMP-2026');
      expect(result.name).toBe('NBA Championship (KXNBACHAMP-2026)');
    });

    it('should parse Bitcoin event IDs', () => {
      const result = extractEventName('BTC above 100k?', 'kalshi', 'KXBTCMAXY-2026-Q1');
      expect(result.key).toBe('KXBTCMAXY-2026-Q1');
      expect(result.name).toBe('Bitcoin Maximum (KXBTCMAXY-2026-Q1)');
    });

    it('should parse Fed Rate Cut event IDs', () => {
      const result = extractEventName('Fed cuts rates?', 'kalshi', 'KXRATECUTCOUNT-2026');
      expect(result.key).toBe('KXRATECUTCOUNT-2026');
      expect(result.name).toBe('Fed Rate Cuts (KXRATECUTCOUNT-2026)');
    });

    it('should use raw event ID for unknown patterns', () => {
      const result = extractEventName('Some market', 'kalshi', 'UNKNOWN-EVENT-123');
      expect(result.key).toBe('UNKNOWN-EVENT-123');
      expect(result.name).toBe('UNKNOWN-EVENT-123');
    });
  });

  describe('Polymarket title pattern matching', () => {
    it('should group Super Bowl markets', () => {
      const result = extractEventName('Super Bowl 2026 Winner', 'polymarket', null);
      expect(result.key).toBe('super-bowl-2026');
      expect(result.name).toBe('Super Bowl 2026');
    });

    it('should group Presidential Election markets', () => {
      const result = extractEventName('2024 US Presidential Election Winner', 'polymarket', null);
      expect(result.key).toBe('2024-us-presidential-election');
      expect(result.name).toBe('2024 US Presidential Election');
    });

    it('should group Democratic primary markets', () => {
      const result = extractEventName('2024 Democratic presidential nomination', 'polymarket', null);
      expect(result.key).toBe('2024-democratic-presidential-nomination');
      expect(result.name).toBe('2024 Democratic Presidential nomination');
    });

    it('should group NBA Championship markets', () => {
      const result = extractEventName('2025 NBA Championship winner', 'polymarket', null);
      expect(result.key).toBe('2025-nba-championship');
      expect(result.name).toBe('2025 NBA Championship');
    });

    it('should group Federal Reserve markets', () => {
      const result = extractEventName('Will the Fed raise interest rates in March?', 'polymarket', null);
      expect(result.key).toBe('federal-reserve-rates');
      expect(result.name).toBe('Federal Reserve Rates');
    });

    it('should group Bitcoin price markets', () => {
      const result = extractEventName('Bitcoin price above $100,000 by end of year?', 'polymarket', null);
      expect(result.key).toBe('bitcoin-price');
      expect(result.name).toBe('Bitcoin Price');
    });

    it('should group Ethereum price markets', () => {
      const result = extractEventName('ETH price prediction $10k', 'polymarket', null);
      expect(result.key).toBe('ethereum-price');
      expect(result.name).toBe('Ethereum Price');
    });
  });

  describe('Default grouping (no pattern match)', () => {
    it('should use truncated title as fallback', () => {
      const result = extractEventName('Will it rain tomorrow in New York City?', 'polymarket', null);
      expect(result.key).toContain('single-polymarket-');
      expect(result.name).toBe('Will it rain tomorrow in New York City');
    });

    it('should truncate long titles', () => {
      const longTitle = 'This is a very long market title that exceeds sixty characters in length and should be truncated';
      const result = extractEventName(longTitle, 'polymarket', null);
      expect(result.name.length).toBeLessThanOrEqual(60);
    });

    it('should handle titles with question marks', () => {
      const result = extractEventName('Will X happen? More details here', 'polymarket', null);
      expect(result.name).toBe('Will X happen');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty title', () => {
      const result = extractEventName('', 'polymarket', null);
      expect(result.key).toBe('unknown-polymarket');
      expect(result.name).toBe('Unknown Market');
    });

    it('should handle null-ish title', () => {
      // @ts-expect-error Testing null input
      const result = extractEventName(null, 'polymarket', null);
      expect(result.name).toBe('Unknown Market');
    });

    it('should handle whitespace-only title', () => {
      const result = extractEventName('   ', 'polymarket', null);
      expect(result.key).toBe('unknown-polymarket');
    });

    it('should handle special characters in title', () => {
      const result = extractEventName('Will $BTC hit $100k (again)?', 'polymarket', null);
      // Should match Bitcoin pattern
      expect(result.key).toBe('bitcoin-price');
    });

    it('should handle unicode characters', () => {
      const result = extractEventName('2024–25 English Premier League winner', 'polymarket', null);
      expect(result.name).toBe('2024-25 English Premier League');
    });
  });
});
