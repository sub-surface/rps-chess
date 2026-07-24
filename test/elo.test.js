import { describe, expect, it } from 'vitest';
import { K, eloDelta, expectedScore } from '../src/elo.js';

describe('elo', () => {
  it('is symmetric at equal ratings', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(eloDelta(1200, 1200, 1)).toBe(K / 2);
    expect(eloDelta(1200, 1200, 0)).toBe(-K / 2);
    expect(eloDelta(1200, 1200, 0.5)).toBe(0);
  });

  it('is zero-sum between two players', () => {
    expect(eloDelta(1200, 1400, 1) + eloDelta(1400, 1200, 0)).toBeCloseTo(0, 5);
    expect(eloDelta(1000, 1500, 0.5) + eloDelta(1500, 1000, 0.5)).toBeCloseTo(0, 5);
  });

  it('pays the underdog more than the favourite', () => {
    const underdogWin = eloDelta(1200, 1400, 1);
    const favouriteWin = eloDelta(1400, 1200, 1);
    expect(underdogWin).toBeGreaterThan(favouriteWin);
    expect(underdogWin).toBeGreaterThan(K / 2);
    expect(favouriteWin).toBeLessThan(K / 2);
    expect(favouriteWin).toBeGreaterThan(0);
  });
});
