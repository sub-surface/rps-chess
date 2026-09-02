import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import { censusAzelWall } from '../scripts/azel-wall.mjs';
import azelArtifact from '../public/atlas/azel-wall.json';

describe('azel-wall census and contract', () => {
  it('reconstructs the exact Azel start layout', () => {
    const cfg = E.PRESETS.azel;
    const board = E.blocksBoard(cfg.size, cfg.perType, cfg.layout);
    expect(E.encodePos(board)).toBe('.....RS.srPS.spRS.sr.....');
    expect(cfg.size).toBe(5);
    expect(cfg.layout).toBe('azel');
  });

  it('runs a bounded census deterministically with clean cap handling', () => {
    const run1 = censusAzelWall({ maxStates: 150, maxEdges: 600, maxPlies: 4 });
    const run2 = censusAzelWall({ maxStates: 150, maxEdges: 600, maxPlies: 4 });
    expect(run1).toEqual(run2);
    expect(run1.complete).toBe(false);
    expect(run1.traversal.totalStates).toBe(150);
    expect(run1.traversal.totalEdges).toBeGreaterThan(0);
    expect(run1.traversal.revisits).toBeGreaterThanOrEqual(0);
    expect(run1.caps.maxStates).toBe(150);
  });

  it('audits the committed public/atlas/azel-wall.json artifact', () => {
    expect(azelArtifact.variant).toBe('azel');
    expect(azelArtifact.boardSize).toBe(5);
    expect(azelArtifact.layout).toBe('azel');
    expect(azelArtifact.startPos).toBe('.....RS.srPS.spRS.sr.....');
    expect(azelArtifact.complete).toBe(false);
    expect(azelArtifact.caps.maxStates).toBeGreaterThan(0);
    expect(azelArtifact.traversal.totalStates).toBe(azelArtifact.caps.maxStates);
    expect(azelArtifact.traversal.totalEdges).toBeGreaterThan(0);
    expect(azelArtifact.traversal.plies.length).toBeGreaterThan(0);
    expect(azelArtifact.traversal.plies[0].edges).toBe(17);
  });
});
