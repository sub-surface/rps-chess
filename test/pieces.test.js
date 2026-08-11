import { describe, expect, it } from 'vitest';
import { glyph, PIECE_STYLE_IDS, PIECE_STYLES, spriteSource } from '../public/pieces.js';

describe('piece artwork', () => {
  it('keeps every style unique, named, and renderable for both sides', () => {
    expect(PIECE_STYLE_IDS).toHaveLength(7);
    expect(new Set(PIECE_STYLE_IDS).size).toBe(PIECE_STYLE_IDS.length);
    expect(PIECE_STYLES.every(({ id, label }) => id && label)).toBe(true);

    for (const style of PIECE_STYLE_IDS) {
      for (const type of ['rock', 'paper', 'scissors']) {
        for (const color of ['B', 'R']) {
          const svg = glyph(type, color, style);
          expect(svg, `${style}/${type}/${color}`).toMatch(/^<svg /);
          expect(svg).toContain(`pc-${color}`);
          expect(svg).toContain(`class="pc ${style}`);
          expect(svg).not.toMatch(/<script|javascript:/i);
        }
      }
    }
  });

  // Retired families are the reason this matters: `pieceStyle` is persisted in browsers, so an ID
  // that no longer exists must resolve to artwork rather than to an empty square.
  it('falls back safely for unknown styles and rejects unknown pieces', () => {
    expect(glyph('rock', 'B', 'unknown')).toContain('class="pc line pc-B"');
    for (const retired of ['pixel', 'blob', 'geometric', 'doodle', 'sticker', 'halftone', 'ghost', 'longshadow']) {
      expect(glyph('paper', 'R', retired), retired).toContain('class="pc line pc-R"');
    }
    expect(glyph('lizard', 'B', 'line')).toBe('');
  });

  // The sprite family is the one raster family, so it addresses its sheet by cell rather than
  // drawing paths. A wrong offset is silent — it just shows the neighbouring piece — and a missing
  // crop is worse: `.sq svg.pc` sets overflow visible, so an unclipped sheet paints over the board.
  it('crops the sprite sheet to the right cell per piece and colour', () => {
    const cells = { rock: 32, paper: 64, scissors: 96 };
    for (const [type, x] of Object.entries(cells)) {
      expect(glyph(type, 'B', 'sprite')).toContain(`viewBox="${x} 0 32 32"`);
      expect(glyph(type, 'R', 'sprite')).toContain(`viewBox="${x} 32 32 32"`);
    }
    // Neutral has no row of its own and borrows Blue's rather than rendering blank.
    expect(glyph('rock', 'N', 'sprite')).toContain('viewBox="32 0 32 32"');
    expect(glyph('rock', 'B', 'sprite')).toContain('/assets/rps-sprites.png');
    // The crop must be a nested viewport, which clips without needing CSS to agree.
    const svg = glyph('paper', 'B', 'sprite');
    expect(svg.match(/<svg/g)).toHaveLength(2);
    expect(svg).toContain('<image href');
  });

  it('shares raster source coordinates with consumers that need actual pixels', () => {
    expect(spriteSource('rock', 'B')).toMatchObject({ x: 32, y: 0, size: 32 });
    expect(spriteSource('paper', 'R')).toMatchObject({ x: 64, y: 32, size: 32 });
    expect(spriteSource('scissors', 'N')).toMatchObject({ x: 96, y: 0, size: 32 });
    expect(spriteSource('lizard', 'B')).toBeNull();
  });
});
