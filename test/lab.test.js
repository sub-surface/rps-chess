import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import * as L from '../public/lab.js';
import * as TB from '../public/tablebase.js';
import lab from '../public/atlas/lab.json';

// The laboratory makes two kinds of claim and the tests have to separate them exactly as the page
// does. Counting is checked against the solved board, where the true answer is already published.
// Measuring is checked for determinism and for the arithmetic of its own intervals — never for a
// particular outcome, which would be asserting that a sample came out a certain way.
describe('lab counting is exact', () => {
  it('reproduces the solved 3x3 counts from the closed form', () => {
    const cfg = L.labCfg(3);
    expect(cfg.perType).toBe(1);
    const space = L.stateSpace(cfg);
    // The tablebase enumerated these by walking every placement. If the formula disagrees with
    // the enumeration, one of them is wrong and this is the only place that can tell us.
    expect(space.placements).toBe(BigInt(TB.PLACEMENTS));
    expect(space.states).toBe(BigInt(TB.STATES));
    expect(space.cells).toBe(TB.CELLS);
    expect(space.pieces).toBe(6);
    // 192 legal deals: 4 antipodal pairs choose 3, two ways round each, 3! type orders.
    expect(L.openingCount(cfg)).toBe(192n);
  });

  it('counts larger boards without losing precision', () => {
    // 25 cells, six pieces a side. C(12,6) x 2^6 x 6! / (2!2!2!) = 5,322,240 legal deals.
    expect(L.openingCount(L.labCfg(5))).toBe(5322240n);
    const nine = L.stateSpace(L.labCfg(9));
    // Well past 2^53, so this has to be exact integer arithmetic rather than a float.
    expect(nine.states > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(nine.states % 2n).toBe(0n);
    expect(String(nine.states)).toMatch(/^\d+$/);
    // Strictly increasing in board size: more room can only mean more arrangements.
    let previous = 0n;
    for (const size of L.LADDER) {
      const states = L.stateSpace(L.labCfg(size)).states;
      expect(states > previous).toBe(true);
      previous = states;
    }
  });

  it('counts Azel material rather than assuming three equal piles', () => {
    const cfg = E.sanitizeCfg(E.PRESETS.azel);
    const space = L.stateSpace(cfg);
    expect(space.pieces).toBe(12);
    // Six pieces a side, but 2/1/3, so the repeated-piece divisor is 2!x1!x3! = 12 rather than 8.
    expect(L.openingCount(cfg)).toBe(L.openingCount(L.labCfg(5)) * 8n / 12n);
  });

  it('states a king’s mobility ceiling from the geometry', () => {
    // 3x3: eight edge-or-corner cells plus one interior. 4x3 + 4x5 + 1x8 = 40.
    expect(L.mobilityCeiling(3)).toMatchObject({ cells: 9, total: 40 });
    expect(L.mobilityCeiling(9).total).toBe(4 * 3 + 28 * 5 + 49 * 8);
    // Approaches 8 from below as the edge becomes a smaller share of the board.
    expect(L.mobilityCeiling(13).mean).toBeGreaterThan(L.mobilityCeiling(5).mean);
    expect(L.mobilityCeiling(13).mean).toBeLessThan(8);
  });

  it('reads a decimal exponent off numbers a float has already lost', () => {
    expect(L.log10Of(1000n)).toBeCloseTo(3, 9);
    expect(L.log10Of(415550n)).toBeCloseTo(Math.log10(415550), 9);
    expect(L.log10Of(10n ** 40n)).toBeCloseTo(40, 6);

    const deSmall = L.decimalExponent(415550n);
    expect(deSmall.exponent).toBe(5);
    expect(deSmall.mantissa).toBeCloseTo(4.155, 3);

    const deBig = L.decimalExponent(10n ** 40n);
    expect(deBig.exponent).toBe(40);
    expect(deBig.mantissa).toBe(1.0);
  });

  it('calculates exact material layer strata matching the tablebase', () => {
    const cfg = L.labCfg(3);
    const layers = L.materialLayers(cfg);
    expect(layers).toHaveLength(7);
    const expectedStates = [2n, 108n, 2160n, 20160n, 90720n, 181440n, 120960n];
    for (let m = 0; m <= 6; m++) {
      expect(layers[m].m).toBe(m);
      expect(layers[m].states).toBe(expectedStates[m]);
    }
    const sumStates = layers.reduce((sum, l) => sum + l.states, 0n);
    expect(sumStates).toBe(BigInt(TB.STATES));
  });

  it('supports custom piece material multisets', () => {
    const customCfg = {
      size: 3,
      customMaterial: { rock: 2, paper: 1, scissors: 0 },
    };
    const space = L.stateSpace(customCfg);
    expect(space.pieces).toBe(6);
    expect(space.states).toBeGreaterThan(0n);
    expect(space.states % 2n).toBe(0n);
  });
});

describe('lab measuring is reproducible', () => {
  it('replays a game identically from the same seed', () => {
    const cfg = L.labCfg(5);
    const first = L.playout(cfg, 12345);
    const again = L.playout(cfg, 12345);
    expect(again).toEqual(first);
    expect(L.playout(cfg, 12346)).not.toEqual(first);
    expect(first.plies).toBeGreaterThan(0);
    expect(['elimination', 'nocaptures', 'immobilization', 'repetition', 'stall', 'plycap'])
      .toContain(first.endReason);
  });

  it('summarises a batch without inventing a result', () => {
    const run = L.measure(L.labCfg(3), { games: 40, seed: 7 });
    expect(run.games).toBe(40);
    expect(run.blue + run.red + run.draws).toBe(40);
    expect(run.plyBuckets.reduce((sum, count) => sum + count, 0)).toBe(40);
    expect(run.firstPlayer.lo).toBeLessThanOrEqual(run.firstPlayer.p);
    expect(run.firstPlayer.hi).toBeGreaterThanOrEqual(run.firstPlayer.p);
    expect(Object.values(run.endings).reduce((sum, count) => sum + count, 0)).toBe(40);
    expect(L.measure(L.labCfg(3), { games: 40, seed: 7 })).toEqual(run);
  });

  it('narrows the interval when batches are pooled rather than averaged', () => {
    const cfg = L.labCfg(3);
    const first = L.measure(cfg, { games: 60, seed: 7 });
    const second = L.measure(cfg, { games: 60, seed: 7, offset: 60 });
    // Distinct games, or the extra batch is a copy and the interval would narrow dishonestly.
    expect(second).not.toEqual(first);
    const pooled = L.mergeSummaries(first, second);
    expect(pooled.games).toBe(120);
    expect(pooled.blue).toBe(first.blue + second.blue);
    const width = (run) => run.firstPlayer.hi - run.firstPlayer.lo;
    expect(width(pooled)).toBeLessThan(width(first));
    expect(L.mergeSummaries(null, first)).toEqual(first);
    // Means and histograms pool; a median does not, so the pooled summary declines to state one
    // rather than averaging two of them into a number that is neither batch's.
    expect(first.medianPlies).toBeGreaterThan(0);
    expect(pooled.medianPlies).toBeNull();
    expect(pooled.meanPlies).toBeCloseTo((first.meanPlies + second.meanPlies) / 2, 6);
    expect(pooled.plyBuckets).toEqual(first.plyBuckets.map((n, i) => n + second.plyBuckets[i]));
  });

  it('computes a Wilson interval that stays inside the unit range', () => {
    expect(L.wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 0 });
    expect(L.wilson(50, 100).p).toBe(0.5);
    expect(L.wilson(0, 20).lo).toBe(0);
    expect(L.wilson(20, 20).hi).toBe(1);
    // Wilson keeps a bound off the edge where a normal interval would run past it.
    expect(L.wilson(0, 20).hi).toBeGreaterThan(0);
    expect(L.wilson(20, 20).lo).toBeLessThan(1);
  });

  it('interpolates branching only between measured points, and says which', () => {
    const points = [{ size: 3, value: 6 }, { size: 5, value: 16 }, { size: 9, value: 34 }];
    expect(L.branchingFor(5, points)).toBe(16);
    expect(L.branchingFor(7, points)).toBe(25);         // halfway between 16 and 34
    expect(L.branchingFor(11, points)).toBeGreaterThan(34);
    expect(L.branchingFor(3, points)).toBe(6);
  });
});

// The shipped dataset is an artifact like the tablebase, so the suite checks it still describes
// the engine it claims to. A stale lab.json fails here rather than misinforming the page.
describe('the committed lab dataset', () => {
  it('matches the rules and the counts the engine produces today', () => {
    expect(lab.rules.label).toBe(E.variantLabel(L.labCfg(9)));
    expect(lab.ladder.map((rung) => rung.size)).toEqual([...L.LADDER]);
    for (const rung of lab.ladder) {
      const cfg = L.labCfg(rung.size);
      expect(rung.perType).toBe(cfg.perType);
      expect(rung.placements).toBe(L.stateSpace(cfg).placements.toString());
      expect(rung.openings).toBe(L.openingCount(cfg).toString());
      expect(rung.solvedBytes).toBe(L.stateSpace(cfg).states.toString());
    }
    expect(lab.ladder.find((rung) => rung.size === 3).solved).toBe(true);
  });

  it('carries a measured run for every size the page plots', () => {
    for (const size of L.PLAYED) {
      for (const policy of ['greedy', 'random']) {
        const run = lab.play.find((entry) => entry.size === size && entry.policy === policy);
        expect(run, `${size} ${policy}`).toBeTruthy();
        expect(run.games).toBe(lab.method.games);
        expect(run.blue + run.red + run.draws).toBe(run.games);
        expect(run.plyBuckets).toHaveLength(L.PLY_BUCKETS.length);
        expect(run.rules).toBe(E.variantLabel(L.labCfg(size)));
      }
    }
  });

  it('prices a solve from the run that actually happened', () => {
    const three = lab.ladder.find((rung) => rung.size === 3);
    // The 3x3 really took about 21 seconds a variant. An estimate that does not land near it is
    // pricing the larger boards off a rate nobody has ever achieved.
    expect(three.solveSeconds).toBeGreaterThan(10);
    expect(three.solveSeconds).toBeLessThan(40);
    const five = lab.ladder.find((rung) => rung.size === 5);
    expect(five.solveSeconds).toBeGreaterThan(three.solveSeconds * 1e6);
    // Branching is measured where a run exists and interpolated elsewhere; both are labelled.
    expect(lab.ladder.filter((rung) => rung.branchingMeasured).map((rung) => rung.size))
      .toEqual([...L.PLAYED]);
  });
});
