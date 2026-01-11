/**
 * Tests for price validation and transformation
 * 
 * Ensures price data is validated and normalized correctly
 */

import { validatePrices, calculateSpread } from '@/lib/data-transforms';

describe('validatePrices', () => {
  describe('valid price ranges', () => {
    it('should accept prices between 0 and 1', () => {
      const result = validatePrices(0.65, 0.35);
      expect(result.yesPrice).toBe(0.65);
      expect(result.noPrice).toBe(0.35);
      expect(result.isValid).toBe(true);
    });

    it('should accept boundary prices (0 and 1)', () => {
      const result = validatePrices(1, 0);
      expect(result.yesPrice).toBe(1);
      expect(result.noPrice).toBe(0);
      expect(result.isValid).toBe(true);
    });

    it('should accept 50/50 prices', () => {
      const result = validatePrices(0.5, 0.5);
      expect(result.yesPrice).toBe(0.5);
      expect(result.noPrice).toBe(0.5);
      expect(result.isValid).toBe(true);
    });
  });

  describe('invalid price handling', () => {
    it('should clamp prices above 1', () => {
      const result = validatePrices(1.5, 0.3);
      expect(result.yesPrice).toBe(1);
      expect(result.noPrice).toBe(0.3);
      expect(result.isValid).toBe(false);
    });

    it('should clamp negative prices to 0', () => {
      const result = validatePrices(-0.1, 0.5);
      expect(result.yesPrice).toBe(0);
      expect(result.noPrice).toBe(0.5);
      expect(result.isValid).toBe(false);
    });

    it('should handle null prices', () => {
      const result = validatePrices(null, null);
      expect(result.yesPrice).toBe(0);
      expect(result.noPrice).toBe(0);
      expect(result.isValid).toBe(true); // 0 is technically valid
    });

    it('should handle undefined prices', () => {
      const result = validatePrices(undefined, 0.5);
      expect(result.yesPrice).toBe(0);
      expect(result.noPrice).toBe(0.5);
      expect(result.isValid).toBe(true);
    });

    it('should handle both prices out of range', () => {
      const result = validatePrices(2, -1);
      expect(result.yesPrice).toBe(1);
      expect(result.noPrice).toBe(0);
      expect(result.isValid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle very small prices', () => {
      const result = validatePrices(0.001, 0.999);
      expect(result.yesPrice).toBe(0.001);
      expect(result.noPrice).toBe(0.999);
      expect(result.isValid).toBe(true);
    });

    it('should handle prices that sum to more than 1', () => {
      // This is valid for individual prices (arb opportunity!)
      const result = validatePrices(0.55, 0.55);
      expect(result.yesPrice).toBe(0.55);
      expect(result.noPrice).toBe(0.55);
      expect(result.isValid).toBe(true);
    });
  });
});

describe('calculateSpread', () => {
  it('should calculate zero spread for perfect market', () => {
    const spread = calculateSpread(0.5, 0.5);
    expect(spread).toBe(0);
  });

  it('should calculate positive spread (no arb opportunity)', () => {
    const spread = calculateSpread(0.48, 0.48);
    expect(spread).toBeCloseTo(0.04, 5); // 4% spread
  });

  it('should calculate negative spread (arb opportunity!)', () => {
    const spread = calculateSpread(0.52, 0.52);
    expect(spread).toBeCloseTo(-0.04, 5); // -4% spread = arb
  });

  it('should handle extreme prices', () => {
    const spread = calculateSpread(0.95, 0.02);
    expect(spread).toBeCloseTo(0.03, 5);
  });

  it('should handle both bids at 0', () => {
    const spread = calculateSpread(0, 0);
    expect(spread).toBe(1); // Maximum spread
  });

  it('should handle typical market spread', () => {
    // Typical liquid market: YES bid 0.64, NO bid 0.34
    const spread = calculateSpread(0.64, 0.34);
    expect(spread).toBeCloseTo(0.02, 5); // 2% spread
  });
});
