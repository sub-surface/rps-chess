import { describe, expect, it } from 'vitest';
import { glyph, PIECE_STYLE_IDS, PIECE_STYLES } from '../public/pieces.js';

describe('piece artwork', () => {
  it('keeps every style unique, named, and renderable for both sides', () => {
    expect(PIECE_STYLE_IDS).toHaveLength(14);
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

  it('falls back safely for unknown styles and rejects unknown pieces', () => {
    expect(glyph('rock', 'B', 'unknown')).toContain('class="pc line pc-B"');
    expect(glyph('lizard', 'B', 'line')).toBe('');
  });
});
