import { describe, expect, it } from 'vitest';
import manifest from '../public/tablebase/hex-manifest.json';
import { HexTopology } from '../public/topology.js';

describe('Hexagonal 7-cell Tablebase Artifacts', () => {
  it('committed valid manifest schema with exact placement counts', () => {
    expect(manifest.topology).toBe('hex');
    expect(manifest.radius).toBe(2);
    expect(manifest.cellCount).toBe(7);
    expect(manifest.placements).toBe(37633);
    expect(manifest.states).toBe(75266);
    expect(manifest.results.maxDtm).toBe(7);
    expect(Number(manifest.results.winPct)).toBeCloseTo(40.92, 1);
    expect(Number(manifest.results.drawPct)).toBeCloseTo(43.80, 1);
    expect(Number(manifest.results.lossPct)).toBeCloseTo(15.28, 1);

    expect(manifest.files.turn0).toBe('hex-7-turn0.tb');
    expect(manifest.files.turn1).toBe('hex-7-turn1.tb');
  });

  it('verifies cell and piece specifications conform to the 7-cell hex contract', () => {
    const topo = new HexTopology(2);
    expect(topo.cellCount).toBe(7);
    expect(manifest.cells).toEqual(topo.cells());

    expect(manifest.pieces).toHaveLength(6);
    const blues = manifest.pieces.filter((p) => p.color === 0);
    const reds = manifest.pieces.filter((p) => p.color === 1);
    expect(blues.map((p) => p.type).sort()).toEqual(['paper', 'rock', 'scissors']);
    expect(reds.map((p) => p.type).sort()).toEqual(['paper', 'rock', 'scissors']);
  });
});
