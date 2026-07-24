import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';

describe('shared rules engine', () => {
  it('sanitizes every untrusted variant field', () => {
    expect(E.sanitizeCfg({
      size: 999,
      perType: -4,
      moveStyle: 'teleport',
      capture: 'anything',
      territory: false,
      retread: true,
      actionsPerTurn: 8,
      first: 'x',
    })).toEqual({
      size: 13,
      perType: 1,
      rockMove: 'king',
      paperMove: 'king',
      scissorsMove: 'king',
      moveStyle: 'kings',
      capture: 'rps',
      territory: false,
      retread: false,
      trail: false,
      layout: 'rows',
      actionsPerTurn: 3,
      first: E.BLUE,
    });
    // Standard does not paint, so an absent territory flag must not turn painting on.
    expect(E.sanitizeCfg({}).territory).toBe(false);
    expect(E.sanitizeCfg({}).retread).toBe(false);
    expect(E.sanitizeCfg({})).toMatchObject(E.PRESETS.standard);
    expect(E.presetOf(E.sanitizeCfg({}))).toBe('standard');
    expect(E.sanitizeCfg({ territory: true }).retread).toBe(true);
    expect(E.sanitizeCfg({ territory: true, retread: false }).retread).toBe(false);
    expect(E.sanitizeCfg({ moveStyle: 'classic' })).toMatchObject({
      rockMove: 'king',
      paperMove: 'rook',
      scissorsMove: 'bishop',
    });
  });

  it('paints an ink trail over unclaimed squares only', () => {
    const config = E.sanitizeCfg({ size: 6, moveStyle: 'queens', territory: true, trail: true, retread: true });
    const board = E.emptyBoard(6);
    board[5][0].piece = { type: 'paper', color: E.BLUE };
    board[5][2].owner = E.RED;
    board[0][5].piece = { type: 'rock', color: E.RED };
    const game = E.newGame(config, board);
    E.applyMove(game, { fr: 5, fc: 0, tr: 5, tc: 4 });
    expect(game.board[5][1].owner).toBe(E.BLUE);   // trail claims fresh ground
    expect(game.board[5][2].owner).toBe(E.RED);    // trail never repaints
    expect(game.board[5][3].owner).toBe(E.BLUE);
    expect(game.board[5][4].owner).toBe(E.BLUE);   // landing square
  });

  it('round-trips position codes and rejects malformed ones', () => {
    const board = E.blocksBoard(9, 2, 'corners');
    const pos = E.encodePos(board);
    expect(pos).toHaveLength(81);
    const decoded = E.decodePos(pos, 9);
    expect(E.encodePos(decoded)).toBe(pos);
    expect(decoded[8][0].piece).toEqual({ type: 'rock', color: E.BLUE });
    expect(decoded[8][0].owner).toBe(E.BLUE);
    decoded[7][4].owner = E.RED;
    const owners = E.encodeOwners(decoded);
    expect(E.decodeOwners(owners, E.decodePos(pos, 9))[7][4].owner).toBe(E.RED);
    expect(E.decodeOwners(owners.replace('R', 'X'), decoded)).toBeNull();

    expect(E.decodePos(pos, 6)).toBeNull();                       // wrong length
    expect(E.decodePos(pos.replace('R', 'X'), 9)).toBeNull();     // bad glyph
    expect(E.decodePos('.'.repeat(81), 9)).toBeNull();            // no pieces
    expect(E.decodePos('R' + '.'.repeat(80), 9)).toBeNull();      // one-sided
    expect(E.decodePos('R'.repeat(40) + 'r'.repeat(41), 9)).toBeNull(); // over cap
  });

  it('builds symmetric starting boards for every layout', () => {
    for (const layout of ['rows', 'corners', 'scattered']) {
      const board = E.blocksBoard(9, 2, layout);
      const counts = E.pieceCounts(board);
      expect(counts).toEqual({ B: 6, R: 6 });
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const piece = board[r][c].piece;
        if (!piece) continue;
        const mirror = board[8 - r][8 - c].piece;
        expect(mirror, `${layout} not symmetric at ${r},${c}`).toBeTruthy();
        expect(mirror.type).toBe(piece.type);
        expect(mirror.color).toBe(E.other(piece.color));
      }
    }

    // The Standard 9×9 formation matches the supplied centred side-facing reference.
    const standard = E.blocksBoard(9, 2, 'rows');
    for (const [row, type] of [[3, 'rock'], [4, 'paper'], [5, 'scissors']]) {
      for (const col of [1, 2]) expect(standard[row][col].piece).toEqual({ type, color: E.BLUE });
      for (const col of [6, 7]) {
        const mirrorType = row === 3 ? 'scissors' : row === 4 ? 'paper' : 'rock';
        expect(standard[row][col].piece).toEqual({ type: mirrorType, color: E.RED });
      }
    }

    // Every supported size/piece count keeps all pieces and never overlaps its mirror.
    for (let size = 6; size <= 13; size++) for (let perType = 1; perType <= 4; perType++) {
      expect(E.pieceCounts(E.blocksBoard(size, perType, 'rows'))).toEqual({
        B: perType * 3,
        R: perType * 3,
      });
    }
  });

  it('supports every per-piece movement archetype', () => {
    const board = E.emptyBoard(9);
    board[4][4].piece = { type: 'rock', color: E.BLUE };
    const expected = {
      king: 8,
      rook: 16,
      bishop: 16,
      knight: 8,
      queen: 32,
      cross: 4,
      longking: 12,
    };
    for (const [rockMove, count] of Object.entries(expected)) {
      const config = E.sanitizeCfg({ territory: false, rockMove });
      expect(E.legalDest(board, 4, 4, config), rockMove).toHaveLength(count);
    }
    expect(E.PRESETS.standard).toMatchObject({
      rockMove: 'king', paperMove: 'king', scissorsMove: 'king',
    });
    expect(E.PRESETS.kings).toMatchObject({
      rockMove: 'rook', paperMove: 'knight', scissorsMove: 'bishop',
    });
  });

  it('skips painted territory while allowing a slider to travel beyond it', () => {
    const config = E.sanitizeCfg({ territory: true, retread: false, paperMove: 'rook' });
    const board = E.emptyBoard(9);
    board[4][4] = { owner: E.BLUE, piece: { type: 'paper', color: E.BLUE } };
    board[4][5].owner = E.BLUE;
    const destinations = E.legalDest(board, 4, 4, config);
    expect(destinations).not.toContainEqual([4, 5]);
    expect(destinations).toContainEqual([4, 6]);
  });

  it('only paints trails for sliders, never across jumps', () => {
    const config = E.sanitizeCfg({
      size: 6,
      territory: true,
      retread: true,
      trail: true,
      rockMove: 'knight',
    });
    const board = E.emptyBoard(6);
    board[4][2] = { owner: E.BLUE, piece: { type: 'rock', color: E.BLUE } };
    board[0][0] = { owner: E.RED, piece: { type: 'paper', color: E.RED } };
    const game = E.newGame(config, board);
    E.applyMove(game, { fr: 4, fc: 2, tr: 2, tc: 3 });
    expect(game.board[3][3].owner).toBeNull();
    expect(game.board[2][3].owner).toBe(E.BLUE);
  });

  it('applies RPS capture restrictions and multi-action turns', () => {
    const captureConfig = E.sanitizeCfg({ territory: false, capture: 'rps' });
    const captureBoard = E.emptyBoard(6);
    captureBoard[3][3].piece = { type: 'rock', color: E.BLUE };
    captureBoard[2][2].piece = { type: 'scissors', color: E.RED };
    captureBoard[2][3].piece = { type: 'paper', color: E.RED };
    expect(E.legalDest(captureBoard, 3, 3, captureConfig)).toContainEqual([2, 2]);
    expect(E.legalDest(captureBoard, 3, 3, captureConfig)).not.toContainEqual([2, 3]);

    const config = E.sanitizeCfg({ size: 6, territory: true, actionsPerTurn: 2 });
    const board = E.emptyBoard(6);
    board[5][0].piece = { type: 'rock', color: E.BLUE };
    board[5][2].piece = { type: 'rock', color: E.BLUE };
    board[0][0].piece = { type: 'rock', color: E.RED };
    const game = E.newGame(config, board);
    E.applyMove(game, { fr: 5, fc: 0, tr: 4, tc: 0 });
    expect(game.turn).toBe(E.BLUE);
    expect(game.acts).toBe(1);
    E.applyMove(game, { fr: 5, fc: 2, tr: 4, tc: 2 });
    expect(game.turn).toBe(E.RED);
    expect(game.acts).toBe(0);
  });

  it('ends the moment either player has no move, scoring by territory', () => {
    // Red has a single rock boxed in by painted (non-re-treadable) squares; Blue is mobile.
    const cfg = E.sanitizeCfg({ size: 6, moveStyle: 'classic', capture: 'rps', territory: true, retread: false, first: E.BLUE });
    const board = E.emptyBoard(6);
    board[0][0] = { owner: E.RED, piece: { type: 'rock', color: E.RED } };
    board[0][1] = { owner: E.BLUE, piece: null };
    board[1][0] = { owner: E.BLUE, piece: null };
    board[1][1] = { owner: E.BLUE, piece: null };
    board[5][5] = { owner: E.BLUE, piece: { type: 'rock', color: E.BLUE } };
    expect(E.hasMove(board, E.RED, cfg)).toBe(false);
    expect(E.hasMove(board, E.BLUE, cfg)).toBe(true);

    const game = E.newGame(cfg, board);
    expect(game.gameOver).toBe(true);            // ends despite Blue still having moves
    expect(game.endReason).toBe('immobilization');
    expect(game.moves).toHaveLength(0);          // Blue never gets to pad the score
    const res = E.result(game);
    expect(res.B).toBeGreaterThan(res.R);        // winner is whoever holds more territory

    // With re-tread on (the new Standard default) the same rock can step onto painted squares,
    // so it is not boxed in and play continues.
    const relaxed = E.newGame(E.sanitizeCfg({ ...cfg, retread: true }), E.cloneBoard(board));
    expect(relaxed.gameOver).toBe(false);
  });

  it('terminates representative games across the supported variant space', () => {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const variants = [
      { size: 6, rockMove: 'king', paperMove: 'rook', scissorsMove: 'bishop', capture: 'rps', territory: true, retread: false, actionsPerTurn: 1 },
      { size: 9, rockMove: 'rook', paperMove: 'knight', scissorsMove: 'bishop', capture: 'rps', territory: false, actionsPerTurn: 2 },
      { size: 10, moveStyle: 'queens', capture: 'chess', territory: true, retread: true, actionsPerTurn: 3 },
      { size: 13, rockMove: 'queen', paperMove: 'cross', scissorsMove: 'longking', capture: 'chess', territory: false, actionsPerTurn: 1 },
      { size: 9, rockMove: 'knight', paperMove: 'queen', scissorsMove: 'cross', capture: 'rps', territory: true, trail: true, actionsPerTurn: 1 },
      { size: 7, rockMove: 'longking', paperMove: 'rook', scissorsMove: 'king', capture: 'rps', territory: true, layout: 'scattered', actionsPerTurn: 1 },
      { size: 8, rockMove: 'bishop', paperMove: 'knight', scissorsMove: 'queen', capture: 'rps', territory: true, layout: 'corners', trail: true, actionsPerTurn: 2 },
    ];

    for (const raw of variants) {
      for (let run = 0; run < 12; run++) {
        const game = E.newGame(E.sanitizeCfg({ ...raw, perType: 2, first: run % 2 ? E.RED : E.BLUE }));
        let moves = 0;
        while (!game.gameOver && moves < 5000) {
          const legal = E.allMoves(game.board, game.turn, game.cfg);
          expect(legal.length).toBeGreaterThan(0);
          E.applyMove(game, legal[Math.floor(random() * legal.length)]);
          moves++;
        }
        expect(game.gameOver, `variant ${JSON.stringify(raw)} exceeded ${moves} moves`).toBe(true);
      }
    }
  });
});

describe('preset library', () => {
  it('gives every preset a distinct, recognisable ruleset', () => {
    for (const [key, preset] of Object.entries(E.PRESETS)) {
      // A duplicate ruleset would make presetOf silently report the earlier key.
      expect(E.presetOf(E.sanitizeCfg(preset)), `${key} is not uniquely recognisable`).toBe(key);
    }
    expect(Object.keys(E.PRESETS).length).toBeGreaterThanOrEqual(10);
  });

  it('describes every preset and orders them for the picker', () => {
    for (const key of Object.keys(E.PRESETS)) {
      expect(E.PRESET_INFO[key], `${key} has no label or tagline`).toBeTruthy();
      expect(E.PRESET_INFO[key].label.length).toBeGreaterThan(0);
      expect(E.PRESET_INFO[key].tagline.length).toBeGreaterThan(0);
      expect(E.PRESET_KEYS).toContain(key);
    }
    expect(E.PRESET_KEYS).toContain('custom');   // the picker's escape hatch
    expect(E.presetLabel('kings')).toBe("King's field");
    expect(E.presetLabel('nonsense')).toBe('Custom');
  });

  it('every preset produces a playable opening position', () => {
    for (const [key, preset] of Object.entries(E.PRESETS)) {
      const cfg = E.sanitizeCfg(preset);
      const game = E.newGame(cfg);
      expect(game.gameOver, `${key} starts already finished`).toBe(false);
      const counts = E.pieceCounts(game.board);
      expect(counts.B, `${key} is missing Blue pieces`).toBe(cfg.perType * 3);
      expect(counts.R).toBe(counts.B);
      expect(E.allMoves(game.board, cfg.first, cfg).length, `${key} has no opening move`).toBeGreaterThan(0);
      // Custom positions must be able to express the preset's own piece budget.
      expect(E.decodePos(E.encodePos(game.board), cfg.size)).not.toBeNull();
    }
  });
});

describe('rules summary', () => {
  const text = (cfg) => E.rulesSummary(cfg).map((s) => `${s.h} ${s.p}`).join('\n');

  it('describes the variant actually passed in', () => {
    const standard = text(E.PRESETS.standard);
    expect(standard).toContain('9×9');
    expect(standard).toContain('Every piece moves one square any way');
    expect(standard).toContain('rock takes scissors');
    expect(standard).toContain('Take every enemy piece');
    expect(standard).not.toContain('Painting');
    expect(standard).not.toMatch(/Turns/);
    // Standard has no sliders and no jumpers, so neither caveat should appear.
    expect(standard).not.toContain('Slides stop');
    expect(standard).not.toContain('Jumps ignore');

    const melee = text(E.PRESETS.melee);
    expect(melee).toContain('Take any enemy piece');
    expect(melee).toContain('Take every enemy piece');
    expect(melee).not.toContain('Painting');   // no territory section at all

    const painters = text(E.PRESETS.painters);
    expect(painters).toContain('Sliders ink every unclaimed square they cross');
    expect(painters).toContain('glided over');
    expect(painters).toContain('Slides stop at the first piece');

    expect(text(E.PRESETS.triple)).toContain('3 moves per turn');
    expect(text(E.PRESETS.skirmish)).toContain('1 rock, 1 paper and 1 scissors');
    // A shared archetype is stated once; mixed assignments are spelled out per piece.
    expect(text(E.PRESETS.cavalry)).toContain('Every piece jumps in an L');
    const mixed = text(E.PRESETS.kings);
    expect(mixed).toContain('Rock slides in a straight line');
    expect(mixed).toContain('Scissors slides diagonally');
    expect(mixed).not.toContain('Every piece');
    expect(mixed).toContain('Jumps ignore');   // Paper is a knight here
  });

  it('ends a captureless position and scores it by pieces', () => {
    const cfg = E.sanitizeCfg(E.PRESETS.standard);
    const board = E.emptyBoard(9);
    // Rocks facing rocks: legal moves remain, but no capture can ever happen.
    board[4][2].piece = { type: 'rock', color: E.BLUE };
    board[4][3].piece = { type: 'rock', color: E.BLUE };
    board[4][6].piece = { type: 'rock', color: E.RED };
    expect(E.capturesPossible(board, cfg)).toBe(false);
    expect(E.allMoves(board, E.BLUE, cfg).length).toBeGreaterThan(0);
    const game = E.newGame(cfg, board);
    expect(game.gameOver).toBe(true);
    expect(game.endReason).toBe('nocaptures');
    expect(E.result(game)).toMatchObject({ B: 2, R: 1, metric: 'pieces' });

    // A matchup that can still resolve keeps playing.
    const live = E.cloneBoard(board);
    live[4][6].piece = { type: 'scissors', color: E.RED };
    expect(E.capturesPossible(live, cfg)).toBe(true);
    expect(E.newGame(cfg, live).gameOver).toBe(false);

    // Chess capture always leaves a capture available while both sides have pieces.
    expect(E.capturesPossible(board, E.sanitizeCfg({ capture: 'chess' }))).toBe(true);
    // A full Standard opening is never captureless.
    expect(E.capturesPossible(E.blocksBoard(9, 2, 'rows'), cfg)).toBe(true);
  });

  it('sanitizes hostile input rather than echoing it', () => {
    const summary = text({ size: 999, perType: -4, capture: '<script>', layout: 'nope' });
    expect(summary).toContain('13×13');
    expect(summary).toContain('facing blocks near the centre');
    // Concise: no section should run long.
    for (const section of E.rulesSummary(E.PRESETS.standard)) {
      expect(section.p.length, `${section.h} is verbose`).toBeLessThan(190);
    }
    expect(summary).not.toContain('<script>');
  });
});
