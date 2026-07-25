import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import { encodeGif, exportGameGif, frameGeometry, gameFrames, PALETTES } from '../public/gif.js';

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

  // The two palettes must stay interchangeable: the encoder, the sampler and these tests all index
  // colours by position, so a slot that means something different between themes is a silent bug.
  it('keeps both palettes the same shape, with a low-contrast last-move wash', () => {
    expect(PALETTES.light).toHaveLength(PALETTES.dark.length);
    for (const palette of [PALETTES.dark, PALETTES.light]) {
      expect(palette.every((entry) => entry.length === 3 && entry.every((c) => c >= 0 && c <= 255))).toBe(true);
      // Slots 9 and 14 are the wash, one per square parity. Each must sit near the square it lifts
      // and stay clear of both player colours, or it competes with them for attention.
      const lift = (wash, square) => Math.hypot(...wash.map((c, i) => c - square[i]));
      const far = (wash, piece) => Math.hypot(...wash.map((c, i) => c - piece[i]));
      for (const [wash, square] of [[palette[9], palette[0]], [palette[14], palette[1]]]) {
        expect(lift(wash, square)).toBeLessThan(60);
        expect(far(wash, palette[6])).toBeGreaterThan(90);
        expect(far(wash, palette[7])).toBeGreaterThan(90);
      }
      // The two parities must still be distinguishable under the wash, or the board loses its grid.
      expect(lift(palette[9], palette[14])).toBeGreaterThan(6);
    }
  });

  it('selects a palette from the theme and defaults to dark', async () => {
    const game = E.newGame(E.sanitizeCfg({ ...E.PRESETS.skirmish }));
    const paletteBytes = async (options) => {
      const bytes = new Uint8Array(await (await exportGameGif(game, options)).arrayBuffer());
      return Array.from(bytes.slice(13, 13 + 48)).join(',');   // the global colour table
    };
    const dark = await paletteBytes({ size: 180 });
    expect(await paletteBytes({ size: 180, theme: 'dark' })).toBe(dark);
    expect(await paletteBytes({ size: 180, theme: 'light' })).not.toBe(dark);
  });

  // The hook is how a browser exports its own artwork. It is never the asserted rendering path, but
  // it must be reachable, and its absence must leave the geometric renderer byte-identical.
  it('uses a drawPiece hook when given one and is unchanged without it', async () => {
    const cfg = E.sanitizeCfg({ ...E.PRESETS.skirmish });
    const game = E.newGame(cfg);
    const { cell } = frameGeometry(game.board.length, { size: 180 });
    expect(cell).toBe(Math.floor(180 / game.board.length));
    const plain = new Uint8Array(await (await exportGameGif(game, { size: 180 })).arrayBuffer());
    const stamp = new Uint8Array(cell * cell).fill(10);
    const stamped = new Uint8Array(await (await exportGameGif(game, {
      size: 180, drawPiece: () => stamp,
    })).arrayBuffer());
    expect(Array.from(stamped)).not.toEqual(Array.from(plain));
    // A hook that declines every square must reproduce the no-hook output exactly.
    const declined = new Uint8Array(await (await exportGameGif(game, {
      size: 180, drawPiece: () => null,
    })).arrayBuffer());
    expect(Array.from(declined)).toEqual(Array.from(plain));
  });
});
