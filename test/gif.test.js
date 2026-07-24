import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import { encodeGif, exportGameGif, gameFrames } from '../public/gif.js';

describe('animated GIF export', () => {
  it('encodes a looping GIF89a stream with every frame', () => {
    const bytes = encodeGif({
      width: 2,
      height: 2,
      palette: [[0, 0, 0], [255, 255, 255]],
      frames: [
        { pixels: new Uint8Array([0, 1, 1, 0]), delay: 10 },
        { pixels: new Uint8Array([1, 0, 0, 1]), delay: 20 },
      ],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.at(-1)).toBe(0x3b);
    let controls = 0;
    for (let index = 0; index < bytes.length - 2; index++) {
      if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9 && bytes[index + 2] === 0x04) controls++;
    }
    expect(controls).toBe(2);
    expect(new TextDecoder().decode(bytes)).toContain('NETSCAPE2.0');
  });

  it('reconstructs the game and exports it without a canvas dependency', async () => {
    const cfg = E.sanitizeCfg({
      ...E.PRESETS.standard,
      size: 6,
      perType: 1,
      rockMove: 'rook',
      paperMove: 'knight',
      scissorsMove: 'bishop',
    });
    const game = E.newGame(cfg);
    for (let index = 0; index < 6 && !game.gameOver; index++) {
      E.applyMove(game, E.allMoves(game.board, game.turn, cfg)[0]);
    }
    const frames = gameFrames(game);
    expect(frames).toHaveLength(game.moves.length + 1);
    expect(E.encodePos(frames.at(-1).board)).toBe(E.encodePos(game.board));
    expect(E.encodeOwners(frames.at(-1).board)).toBe(E.encodeOwners(game.board));

    const blob = exportGameGif(game, { size: 180 });
    expect(blob.type).toBe('image/gif');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.at(-1)).toBe(0x3b);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
