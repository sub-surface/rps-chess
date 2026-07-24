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
      moveStyle: 'classic',
      capture: 'rps',
      territory: false,
      retread: false,
      actionsPerTurn: 3,
      first: E.BLUE,
    });
  });

  it('derives classic and queen movement from the selected parameters', () => {
    const config = E.sanitizeCfg({ territory: false });
    const board = E.emptyBoard(9);
    board[4][4].piece = { type: 'rock', color: E.BLUE };
    expect(E.legalDest(board, 4, 4, config)).toHaveLength(8);

    board[4][4].piece.type = 'paper';
    expect(E.legalDest(board, 4, 4, config)).toHaveLength(16);

    board[4][4].piece.type = 'scissors';
    expect(E.legalDest(board, 4, 4, config)).toHaveLength(16);

    config.moveStyle = 'queens';
    expect(E.legalDest(board, 4, 4, config)).toHaveLength(32);
  });

  it('skips painted territory while allowing a slider to travel beyond it', () => {
    const config = E.sanitizeCfg({ territory: true, retread: false });
    const board = E.emptyBoard(9);
    board[4][4] = { owner: E.BLUE, piece: { type: 'paper', color: E.BLUE } };
    board[4][5].owner = E.BLUE;
    const destinations = E.legalDest(board, 4, 4, config);
    expect(destinations).not.toContainEqual([4, 5]);
    expect(destinations).toContainEqual([4, 6]);
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

  it('terminates representative games across the supported variant space', () => {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const variants = [
      { size: 6, moveStyle: 'classic', capture: 'rps', territory: true, retread: false, actionsPerTurn: 1 },
      { size: 9, moveStyle: 'kings', capture: 'rps', territory: false, actionsPerTurn: 2 },
      { size: 10, moveStyle: 'queens', capture: 'chess', territory: true, retread: true, actionsPerTurn: 3 },
      { size: 13, moveStyle: 'classic', capture: 'chess', territory: false, actionsPerTurn: 1 },
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
