import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import { annotateMoves, exportJpgn, parseJpgn, replayJpgn } from '../public/notation.js';

function playFirst(game, count) {
  for (let index = 0; index < count && !game.gameOver; index++) {
    const move = E.allMoves(game.board, game.turn, game.cfg)[0];
    expect(move).toBeTruthy();
    E.applyMove(game, move);
  }
}

describe('JANKEN Portable Game Notation', () => {
  it('exports, parses, and exactly replays a standard game', () => {
    const cfg = E.sanitizeCfg(E.PRESETS.standard);
    const game = E.newGame(cfg);
    game.startedAt = Date.UTC(2026, 6, 24);
    playFirst(game, 8);

    const text = exportJpgn(game, {
      names: { B: 'Blue "Ace"', R: 'Red\\Fox' },
      site: 'https://example.test/',
    });
    expect(text).toContain('[JPGN "1.1"]');
    expect(text).toContain('[Ruleset "Standard"]');
    expect(text).toContain('rockMove=king;paperMove=king;scissorsMove=king');
    expect(text).toContain('enclosure=0');
    expect(text).toContain('threefold=1');
    expect(text).toContain('[Position "9:');
    expect(text).toContain('[Territory "9:');
    expect(text).toContain('[Replayable "1"]');
    expect(text).toContain('1.B1 ');
    expect(text).toContain('1.R1 ');

    const parsed = parseJpgn(text);
    expect(parsed.tags.Blue).toBe('Blue "Ace"');
    expect(parsed.tags.Red).toBe('Red\\Fox');
    expect(parsed.tags.Date).toBe('2026.07.24');
    const replayed = replayJpgn(text).game;
    expect(E.encodePos(replayed.board)).toBe(E.encodePos(game.board));
    expect(E.encodeOwners(replayed.board)).toBe(E.encodeOwners(game.board));
    expect(replayed.turn).toBe(game.turn);
    expect(replayed.moves).toHaveLength(game.moves.length);

    const historical = text.replace(';threefold=1', '');
    expect(parseJpgn(historical).cfg.threefold).toBe(false);
  });

  // A coordinate preference is display metadata. If it ever reached movetext, two records of the
  // same game would stop being comparable, so the tag is additive and the moves never move.
  it('records a coordinate preference without touching the movetext', () => {
    const cfg = E.sanitizeCfg(E.PRESETS.skirmish);
    const game = E.newGame(cfg);
    game.startedAt = Date.UTC(2026, 6, 24);
    playFirst(game, 4);

    const canonical = exportJpgn(game);
    const grid = exportJpgn(game, { coordStyle: 'grid' });
    expect(canonical).not.toContain('[Coords');
    expect(grid).toContain('[Coords "grid"]');
    // Identical bytes once the one added tag is removed: same movetext, same everything else.
    expect(grid.replace('[Coords "grid"]\n', '')).toBe(canonical);
    // And it still replays, because the parser reads coordinates the one canonical way.
    expect(E.encodePos(replayJpgn(grid).game.board)).toBe(E.encodePos(game.board));
    expect(parseJpgn(grid).tags.Coords).toBe('grid');

    // The history panel is the only caller that relabels, and only in its own display strings.
    const [first] = annotateMoves(game.moves, cfg.size, 'grid');
    const [same] = annotateMoves(game.moves, cfg.size);
    expect(first.notation).not.toBe(same.notation);
    expect(first.move).toBe(same.move);
  });

  it('preserves the territory enclosure rule in portable records', () => {
    const cfg = E.sanitizeCfg(E.PRESETS.melee);
    const game = E.newGame(cfg);
    const text = exportJpgn(game);

    expect(text).toContain('enclosure=1');
    expect(parseJpgn(text).cfg).toMatchObject({
      capture: 'rps',
      territory: true,
      enclosure: true,
    });
  });

  it('exports and replays a jumped checkers capture', () => {
    const cfg = E.sanitizeCfg({ ...E.PRESETS.checkers, size: 6, perType: 1 });
    const board = E.emptyBoard(6);
    board[4][2] = { owner: E.BLUE, piece: { type: 'rock', color: E.BLUE } };
    board[3][2] = { owner: E.RED, piece: { type: 'scissors', color: E.RED } };
    board[0][5] = { owner: E.RED, piece: { type: 'paper', color: E.RED } };
    const game = E.newGame(cfg, board);
    E.applyMove(game, { fr: 4, fc: 2, tr: 2, tc: 2 });

    const text = exportJpgn(game);
    expect(text).toContain('capture=checkers');
    expect(text).toContain('forcedCapture=1');
    expect(text).toContain('[RulesetVersion "1.1"]');
    expect(text).toContain('Rc2xc4');
    const replayed = replayJpgn(text).game;
    expect(replayed.board[3][2].piece).toBeNull();
    expect(replayed.board[2][2].piece).toEqual({ type: 'rock', color: E.BLUE });
    expect(() => replayJpgn(text.replace('Rc2xc4', 'Rc2-c4'))).toThrow(/capture marker/i);
  });

  // The unrestricted leap is reachable from a record and nowhere else. A 1.1 reader must replay a
  // pre-1.1 game under the rule it was played by, or its history stops being legal.
  it('replays a pre-1.1 record under the unrestricted leap it was written with', () => {
    const cfg = E.sanitizeCfg({ ...E.PRESETS.checkers, size: 6, perType: 1 });
    const board = E.emptyBoard(6);
    board[4][2] = { owner: E.BLUE, piece: { type: 'rock', color: E.BLUE } };
    board[3][2] = { owner: E.RED, piece: { type: 'paper', color: E.RED } };  // paper beats rock
    board[0][5] = { owner: E.RED, piece: { type: 'scissors', color: E.RED } };
    const legacy = E.sanitizeCfg({ ...cfg, rulesVersion: '1.0' });
    const game = E.newGame(legacy, board);
    E.applyMove(game, { fr: 4, fc: 2, tr: 2, tc: 2 });
    const text = exportJpgn(game);
    expect(text).toContain('[RulesetVersion "1.0"]');
    expect(replayJpgn(text).game.board[2][2].piece).toEqual({ type: 'rock', color: E.BLUE });

    // Relabel the same record as 1.1 and the move it contains is no longer legal.
    expect(() => replayJpgn(text.replace('[RulesetVersion "1.0"]', '[RulesetVersion "1.1"]')))
      .toThrow(/capture marker|illegal move/i);
  });

  // An absent field means the rule that predated it, never the new one.
  it('reads an absent forcedCapture and RulesetVersion as the historical rules', () => {
    const text = exportJpgn(E.newGame(E.sanitizeCfg(E.PRESETS.standard)));
    const stripped = text
      .replace(';forcedCapture=0', '')
      .replace('[RulesetVersion "1.1"]\n', '');
    const parsed = parseJpgn(stripped);
    expect(parsed.cfg.forcedCapture).toBe(false);
    expect(parsed.cfg.rulesVersion).toBe('1.0');
    // A record that does spell it out keeps the obligation.
    const forced = exportJpgn(E.newGame(E.sanitizeCfg({ ...E.PRESETS.standard, forcedCapture: true })));
    expect(parseJpgn(forced).cfg.forcedCapture).toBe(true);
    expect(parseJpgn(forced).cfg.rulesVersion).toBe('1.1');
  });

  it('keeps every piece letter correct across all three actions in a turn', () => {
    const cfg = E.sanitizeCfg({
      ...E.PRESETS.triple,
      size: 6,
      rockMove: 'rook',
      paperMove: 'knight',
      scissorsMove: 'bishop',
    });
    const board = E.blocksBoard(6, 1, 'rows');
    board[2][2].owner = E.BLUE;
    board[3][3].owner = E.RED;
    const game = E.newGame(cfg, board);
    for (const color of [E.BLUE, E.RED]) {
      for (const type of ['rock', 'paper', 'scissors']) {
        expect(game.turn).toBe(color);
        const move = E.allMoves(game.board, game.turn, game.cfg)
          .find((candidate) => game.board[candidate.fr][candidate.fc].piece?.type === type);
        expect(move).toBeTruthy();
        E.applyMove(game, move);
      }
    }

    const text = exportJpgn(game);
    expect(text).toMatch(/1\.B1\s+R\S+\s+1\.B2\s+P\S+\s+1\.B3\s+S\S+/);
    expect(text).toMatch(/1\.R1\s+R\S+\s+1\.R2\s+P\S+\s+1\.R3\s+S\S+/);
    expect(annotateMoves(game.moves, cfg.size).map(({ color, action, notation }) => (
      `${color}${action}:${notation[0]}`
    ))).toEqual(['B1:R', 'B2:P', 'B3:S', 'R1:R', 'R2:P', 'R3:S']);
    const { parsed, game: replayed } = replayJpgn(text);
    expect(parsed.cfg).toMatchObject({
      actionsPerTurn: 3,
      rockMove: 'rook',
      paperMove: 'knight',
      scissorsMove: 'bishop',
    });
    expect(E.encodeOwners(parsed.board)).toBe(E.encodeOwners(board));
    expect(E.encodeOwners(replayed.board)).toBe(E.encodeOwners(game.board));
  });

  it('exports and replays threefold as a draw despite an unequal board score', () => {
    const cfg = E.sanitizeCfg({
      ...E.PRESETS.standard,
      size: 6,
      perType: 1,
      capture: 'chess',
    });
    const board = E.emptyBoard(6);
    board[5][0] = { owner: E.BLUE, piece: { type: 'rock', color: E.BLUE } };
    board[5][2] = { owner: E.BLUE, piece: { type: 'scissors', color: E.BLUE } };
    board[0][5] = { owner: E.RED, piece: { type: 'paper', color: E.RED } };
    const game = E.newGame(cfg, board);
    const cycle = [
      { fr: 5, fc: 0, tr: 4, tc: 0 },
      { fr: 0, fc: 5, tr: 1, tc: 5 },
      { fr: 4, fc: 0, tr: 5, tc: 0 },
      { fr: 1, fc: 5, tr: 0, tc: 5 },
    ];
    for (let repetition = 0; repetition < 2; repetition++) {
      for (const move of cycle) E.applyMove(game, move);
    }

    const text = exportJpgn(game);
    expect(text).toContain('[Result "1/2-1/2"]');
    expect(text).toContain('[Termination "repetition"]');
    expect(text).toContain('[Score "2-1 pieces"]');
    const replayed = replayJpgn(text).game;
    expect(replayed.gameOver).toBe(true);
    expect(replayed.endReason).toBe('repetition');
    expect(replayed.winner).toBeNull();
  });

  it('replays adjudicated resignations and rejects tampered moves', () => {
    const cfg = E.sanitizeCfg({ ...E.PRESETS.standard, size: 6, perType: 1 });
    const game = E.newGame(cfg);
    playFirst(game, 1);
    game.gameOver = true;
    game.winner = E.RED;
    game.endReason = 'resign';
    const text = exportJpgn(game, { room: 'resign-test', names: { B: 'Ana', R: 'Bo' } });

    const replayed = replayJpgn(text).game;
    expect(replayed.gameOver).toBe(true);
    expect(replayed.winner).toBe(E.RED);
    expect(replayed.endReason).toBe('resign');

    const tampered = text.replace(/([RPS])([a-m]\d+)([-x])([a-m]\d+)/, '$1z99$3$4');
    expect(() => parseJpgn(tampered)).toThrow(/movetext/i);
  });
});
