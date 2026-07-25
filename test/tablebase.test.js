import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import * as T from '../public/tablebase.js';
import manifest from '../public/tablebase/manifest.json';

// Enumeration allocates a 4 MB index, so do it once for the whole file.
const { index, keys } = T.enumeratePlacements();

describe('tablebase addressing', () => {
  it('enumerates every placement of six pieces on nine squares exactly once', () => {
    // Σ C(6,k)·P(9,k) for k = 0..6 — each piece captured or on a square, all squares distinct.
    const choose = (n, k) => (k ? choose(n - 1, k - 1) * n / k : 1);
    let expected = 0;
    for (let k = 0; k <= 6; k++) {
      let arrangements = 1;
      for (let i = 0; i < k; i++) arrangements *= 9 - i;
      expected += choose(6, k) * arrangements;
    }
    expect(expected).toBe(T.PLACEMENTS);
    expect(keys.length).toBe(T.PLACEMENTS);
    expect(new Set(keys).size).toBe(T.PLACEMENTS);
    for (let p = 0; p < T.PLACEMENTS; p += 997) expect(index[keys[p]]).toBe(p);
  });

  it('round-trips a board through its placement key', () => {
    const board = E.blocksBoard(T.SIZE, 1, 'rows');
    const positions = T.positionsOf(board);
    expect(positions).not.toBeNull();
    const restored = T.boardOf(positions);
    for (let row = 0; row < T.SIZE; row++) for (let col = 0; col < T.SIZE; col++) {
      expect(restored[row][col].piece).toEqual(board[row][col].piece);
    }
    expect(T.positionsFromKey(T.keyOf(positions))).toEqual(positions);
    expect(index[T.keyOf(positions)]).toBeGreaterThanOrEqual(0);
  });

  it('refuses boards this tablebase cannot address', () => {
    expect(T.positionsOf(E.emptyBoard(4))).toBeNull();
    const doubled = E.emptyBoard(T.SIZE);
    doubled[0][0].piece = { type: 'rock', color: E.BLUE };
    doubled[1][1].piece = { type: 'rock', color: E.BLUE };
    expect(T.positionsOf(doubled)).toBeNull();
  });

  it('packs a value and a distance into one byte', () => {
    for (const value of [T.LOSS, T.DRAW, T.WIN]) for (const dtm of [0, 1, 18, 30, T.DTM_MAX]) {
      const entry = T.packEntry(value, dtm);
      expect(entry).toBeLessThan(256);
      expect(T.valueOf(entry)).toBe(value - 1);
      expect(T.dtmOf(entry)).toBe(dtm);
    }
    expect(T.stateOf(5, E.BLUE)).toBe(10);
    expect(T.stateOf(5, E.RED)).toBe(11);
  });
});

describe('solved variants', () => {
  it('covers one variant per movement archetype, all playing Skirmish rules', () => {
    expect(manifest.variants.map((v) => v.id)).toEqual([...E.MOVEMENT_TYPES]);
    for (const variant of manifest.variants) {
      // The recorded config must still be what sanitization produces, or the artifact
      // describes rules the game no longer offers.
      expect(E.sanitizeCfg(variant.cfg), variant.id).toEqual(variant.cfg);
      expect(variant.cfg.size).toBe(T.SIZE);
      expect(variant.cfg.perType).toBe(1);
      expect(variant.cfg.territory, `${variant.id} must play the unpainted game`).toBe(false);
      expect(variant.cfg.rockMove).toBe(variant.id);
      expect(variant.cfg.scissorsMove).toBe(variant.id);
    }
    // The king variant is the shipped preset itself.
    const king = manifest.variants.find((v) => v.id === 'king');
    expect(E.presetOf(king.cfg)).toBe('skirmish');
  });

  it('accounts for every state exactly once', () => {
    for (const variant of manifest.variants) {
      const { W, D, L } = variant.wdl;
      expect(W + D + L, variant.id).toBe(T.STATES);
      expect(variant.layers.reduce((sum, layer) => sum + layer.states, 0)).toBe(T.STATES);
      for (const layer of variant.layers) {
        expect(layer.W + layer.D + layer.L, `${variant.id} m=${layer.m}`).toBe(layer.states);
      }
      expect(variant.maxDtm).toBeLessThanOrEqual(T.DTM_MAX);
    }
  });

  it('finds every legal starting position drawn', () => {
    // Layouts are 180°-rotationally symmetric, so Red's army is always Blue's antipode.
    // Those 192 placements are the only positions a game can actually begin from.
    for (const variant of manifest.variants) {
      expect(variant.fairStarts.count, variant.id).toBe(192);
      expect(variant.fairStarts.D, `${variant.id} has a decisive legal start`).toBe(192);
      expect(variant.start.value, `${variant.id} shipped start`).toBe(0);
    }
    const [blue, red] = manifest.startLineup;
    expect(manifest.variants[0].lineups[blue][red]).toBe(0);
  });

  it('still matches the engine in the small material layers', () => {
    // Rebuilding the whole graph is a generator's job, but the layers with at most three
    // pieces are quick — enough to catch artifacts that outlived a rules change.
    for (const variant of manifest.variants) {
      let edges = 0;
      for (let p = 0; p < T.PLACEMENTS; p++) {
        const positions = T.positionsFromKey(keys[p]);
        if (positions.filter((square) => square >= 0).length > 3) continue;
        const board = T.boardOf(positions);
        if (E.terminalReason({ board, cfg: variant.cfg, repetitions: {}, dry: 0 })) continue;
        edges += E.allMoves(board, E.BLUE, variant.cfg).length
          + E.allMoves(board, E.RED, variant.cfg).length;
      }
      expect(edges, `${variant.id} artifact is stale — rerun npm run tablebase`)
        .toBe(variant.edgesUpToThreePieces);
    }
  });
});

// The runtime oracle: the one path from a live config to a verdict, shared by the atlas, the
// analysis panel and the perfect bot. Nothing here touches the network — these are the pure parts.
describe('tablebase runtime oracle', () => {
  const table = new Uint8Array(T.STATES);
  const kingCfg = E.sanitizeCfg(manifest.variants.find((v) => v.id === 'king').cfg);

  it('shares one placement index rather than rebuilding it per caller', () => {
    expect(T.placements()).toBe(T.placements());
    // It must agree with an independent enumeration, or a stored verdict is read from a wrong slot.
    const board = E.blocksBoard(T.SIZE, 1, 'rows');
    expect(T.placementOf(board)).toBe(index[T.keyOf(T.positionsOf(board))]);
    // A board this tablebase cannot describe is -1, not a wrong slot.
    expect(T.placementOf(E.blocksBoard(9, 2, 'rows'))).toBe(-1);
  });

  it('recognises a solved variant from a config and refuses the rest', () => {
    expect(T.variantForCfg(manifest.variants, kingCfg).id).toBe('king');
    expect(T.variantForCfg(manifest.variants, E.PRESETS.standard)).toBe(null);
    // A preference field the tables know nothing about must not stop recognition.
    expect(T.variantForCfg(manifest.variants, { ...kingCfg, pieceStyle: 'sprite' }).id).toBe('king');
    // A rules field that differs must stop it.
    expect(T.variantForCfg(manifest.variants, { ...kingCfg, capture: 'chess' })).toBe(null);
  });

  it('reads a packed entry back as the value and distance it stored', () => {
    const board = E.blocksBoard(T.SIZE, 1, 'rows');
    const placement = T.placementOf(board);
    table[T.stateOf(placement, E.BLUE)] = T.packEntry(T.WIN, 7);
    table[T.stateOf(placement, E.RED)] = T.packEntry(T.LOSS, 4);
    expect(T.probe(table, board, E.BLUE)).toMatchObject({ value: 1, dtm: 7 });
    expect(T.probe(table, board, E.RED)).toMatchObject({ value: -1, dtm: 4 });
    expect(T.probe(table, E.blocksBoard(9, 2, 'rows'), E.BLUE)).toBe(null);
    expect(T.probe(null, board, E.BLUE)).toBe(null);
  });

  it('ranks moves by result first, then races a win and stalls a loss', () => {
    // Values are for the side that just moved, so a move into the opponent's loss is a win.
    const move = (value, dtm) => ({ after: { value: -value, dtm } });
    const ranked = T.rankMoves([
      move(0, 0), move(1, 9), move(-1, 2), move(1, 3), move(-1, 8),
    ]);
    expect(ranked.map((m) => T.moverValue(m))).toEqual([1, 1, 0, -1, -1]);
    expect(ranked[0].after.dtm).toBe(3);              // finish the win quickly
    expect(ranked.at(-1).after.dtm).toBe(2);          // drag the loss out: 8 before 2
    // Only moves exactly as good as the best are top moves; a slower win is not one.
    expect(T.topMoves(ranked)).toHaveLength(1);
    expect(T.topMoves(T.rankMoves([move(0, 0), move(0, 0), move(-1, 1)]))).toHaveLength(2);
    expect(T.topMoves([])).toEqual([]);
  });

  it('offers no moves from a terminal position, whatever the geometry allows', () => {
    const board = E.emptyBoard(T.SIZE);
    board[0][0].piece = { type: 'rock', color: E.BLUE };
    board[2][2].piece = { type: 'rock', color: E.RED };
    // Rock cannot take rock, so this is over even though both sides can still walk about.
    expect(E.allMoves(board, E.BLUE, kingCfg).length).toBeGreaterThan(0);
    expect(T.movesFrom(table, board, E.BLUE, kingCfg)).toEqual([]);
  });
});
