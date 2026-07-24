import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import { exportJpgn, parseJpgn, replayJpgn } from '../public/notation.js';

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
  });

  it('numbers multiple actions explicitly and preserves exact painted starts', () => {
    const cfg = E.sanitizeCfg({
      ...E.PRESETS.standard,
      size: 6,
      actionsPerTurn: 2,
      rockMove: 'rook',
      paperMove: 'knight',
      scissorsMove: 'bishop',
    });
    const board = E.blocksBoard(6, 1, 'rows');
    board[2][2].owner = E.BLUE;
    board[3][3].owner = E.RED;
    const game = E.newGame(cfg, board);
    playFirst(game, 4);

    const text = exportJpgn(game);
    expect(text).toMatch(/1\.B1\s+\S+\s+1\.B2\s+\S+/);
    expect(text).toMatch(/1\.R1\s+\S+\s+1\.R2\s+\S+/);
    const { parsed, game: replayed } = replayJpgn(text);
    expect(parsed.cfg).toMatchObject({
      rockMove: 'rook',
      paperMove: 'knight',
      scissorsMove: 'bishop',
    });
    expect(E.encodeOwners(parsed.board)).toBe(E.encodeOwners(board));
    expect(E.encodeOwners(replayed.board)).toBe(E.encodeOwners(game.board));
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
