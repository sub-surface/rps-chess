// Colour-aware, dependency-free piece artwork. Every family is inline SVG so it
// stays sharp from the 22px legend to the full board and automatically follows
// the active Blue/Red palette.

// Seven families, down from fourteen. The cull kept the ones that stay legible at 22px in the
// legend and still read as rock/paper/scissors at board size; a retired ID falls back to `line`,
// which is what makes dropping one safe for a browser that has it persisted.
export const PIECE_STYLES = Object.freeze([
  { id: 'sprite', label: 'Pixel sprites' },
  { id: 'line', label: 'Line' },
  { id: 'solid', label: 'Solid' },
  { id: 'kanji', label: 'Kanji' },
  { id: 'kawaii', label: 'Rounded kawaii' },
  { id: 'origami', label: 'Origami' },
  { id: 'arcade', label: 'Retro arcade' },
]);
export const PIECE_STYLE_IDS = Object.freeze(PIECE_STYLES.map(({ id }) => id));

const LINE = {
  rock: `<path d="M14 62 L26 43 L35 29 L46 41 L58 25 L70 40 L86 47 L81 67 L69 82 L38 84 L21 75 Z"/>
         <path d="M35 29 L43 58 M58 25 L53 60 M70 40 L64 62" stroke-width="4"/><path d="M30 68 L74 65" stroke-width="4"/>`,
  paper: `<path d="M31 17 H60 L74 31 V83 H31 Z"/><path d="M60 17 V31 H74" stroke-width="5"/><path d="M40 46 H64 M40 58 H64 M40 70 H56" stroke-width="5"/>`,
  scissors: `<circle cx="33" cy="73" r="9" stroke-width="6"/><circle cx="67" cy="73" r="9" stroke-width="6"/><path d="M40 67 L76 21"/><path d="M60 67 L24 21"/><circle cx="50" cy="44" r="3.4" fill="currentColor" stroke="none"/>`,
};
const SOLID = {
  rock: `<path d="M18 64 L30 36 L50 22 L72 34 L84 60 L70 82 L32 82 Z"/>`,
  paper: `<path d="M30 14 L62 14 L76 28 L76 86 L30 86 Z"/><path d="M62 14 L76 28 L62 28 Z" opacity=".45"/>
          <path d="M38 44 H68 M38 56 H68 M38 68 H58" stroke="currentColor" stroke-width="4" opacity=".35" fill="none"/>`,
  scissors: `<path d="M27 18 L37 13 L58 60 L48 66 Z"/><path d="M73 18 L63 13 L42 60 L52 66 Z"/>
             <circle cx="34" cy="76" r="10"/><circle cx="66" cy="76" r="10"/>`,
};
const PIX = {
  rock: ['............', '............', '....XXXX....', '...XXXXXX...', '..XXXXXXXX..', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', '.XXXXXXXXXX.', '............', '............'],
  paper: ['............', '..XXXXXXXX..', '..X......X..', '..X.XXXX.X..', '..X......X..', '..X.XXXX.X..', '..X......X..', '..X.XXX..X..', '..X......X..', '..XXXXXXXX..', '............', '............'],
  scissors: ['............', '.X........X.', '..X......X..', '...X....X...', '....X..X....', '.....XX.....', '....X..X....', '...X....X...', '..XX....XX..', '..XX....XX..', '............', '............'],
};
const KANJI = { rock: '石', paper: '紙', scissors: '鋏' };

const BASE = {
  rock: 'M17 65 C18 55 23 48 30 43 C31 30 41 22 51 25 C59 19 70 28 70 39 C80 42 85 52 82 63 C85 75 74 83 62 82 H36 C23 84 14 76 17 65 Z',
  paper: 'M29 18 Q29 14 34 14 H61 L76 29 V81 Q76 86 71 86 H34 Q29 86 29 81 Z',
  scissors: 'M29 18 Q34 13 39 19 L52 47 L65 18 Q70 13 75 18 Q79 22 75 28 L59 57 Q72 62 75 73 Q78 85 66 88 Q55 89 50 76 Q45 89 34 88 Q22 85 25 73 Q28 62 41 57 L25 28 Q21 22 29 18 Z',
};

const FACE = {
  rock: '<circle cx="41" cy="61" r="3"/><circle cx="59" cy="61" r="3"/><path d="M45 70 Q50 75 55 70" fill="none" stroke-width="3"/>',
  paper: '<circle cx="41" cy="57" r="3"/><circle cx="59" cy="57" r="3"/><path d="M45 66 Q50 71 55 66" fill="none" stroke-width="3"/>',
  scissors: '<circle cx="40" cy="72" r="2.7"/><circle cx="60" cy="72" r="2.7"/><path d="M46 79 Q50 82 54 79" fill="none" stroke-width="3"/>',
};

const ORIGAMI = {
  rock: `<path d="M16 65 L27 38 L50 20 L74 37 L85 65 L70 84 L31 84 Z"/>
         <path d="M16 65 L50 20 L48 61 Z" fill="#fff" opacity=".18"/><path d="M50 20 L74 37 L48 61 Z" fill="#fff" opacity=".32"/>
         <path d="M16 65 L48 61 L31 84 Z" opacity=".62"/><path d="M48 61 L85 65 L70 84 L31 84 Z" opacity=".82"/>`,
  paper: `<path d="M28 14 H61 L77 30 V86 H28 Z"/><path d="M28 14 L52 34 L28 86 Z" fill="#fff" opacity=".18"/>
          <path d="M52 34 L77 30 L77 86 Z" opacity=".72"/><path d="M61 14 L77 30 H61 Z" fill="#fff" opacity=".35"/>`,
  scissors: `<path d="M26 15 L50 51 L74 15 L61 62 L78 85 L50 72 L22 85 L39 62 Z"/>
             <path d="M26 15 L50 51 L39 62 Z" fill="#fff" opacity=".24"/><path d="M74 15 L50 51 L61 62 Z" opacity=".66"/>
             <path d="M22 85 L50 72 L39 62 Z" fill="#fff" opacity=".16"/>`,
};

// The sprite sheet is 128×64 with 32px cells: column 0 is empty, columns 1–3 are rock, paper and
// scissors, row 0 is Blue and row 1 is Red.
//
// The crop is a *nested* <svg> whose viewBox selects the cell. That looks like one element too many
// until you notice `.sq svg.pc` sets `overflow: visible` for the families that draw outside their
// box — which would let the whole sheet paint over the board. A nested viewport clips on its own,
// needs no CSS to cooperate, and unlike a clipPath needs no document-unique id per glyph.
const SPRITE_COL = { rock: 1, paper: 2, scissors: 3 };
export const SPRITE_SHEET = '/assets/rps-sprites.png';
export const SPRITE_CELL = 32;

// Consumers that need raster pixels (the GIF renderer) use the same source rectangle as the SVG
// glyph. Keeping the sheet address here prevents one renderer quietly drifting onto a neighbour.
export const spriteSource = (type, color) => {
  const col = SPRITE_COL[type];
  if (!col) return null;
  return {
    href: SPRITE_SHEET,
    x: SPRITE_CELL * col,
    y: color === 'R' ? SPRITE_CELL : 0,
    size: SPRITE_CELL,
  };
};

const svg = (style, color, body, attrs = 'fill="none" stroke="currentColor" stroke-width="6"') =>
  `<svg class="pc ${style} pc-${color}" viewBox="0 0 100 100" ${attrs}>${body}</svg>`;

const pixelCells = (type, arcade = false) => {
  const matrix = PIX[type];
  let cells = '';
  for (let y = 0; y < matrix.length; y++) for (let x = 0; x < matrix[y].length; x++) {
    if (matrix[y][x] === 'X') {
      cells += `<rect x="${x}" y="${y}" width="1" height="1"${arcade ? ' fill-opacity=".52" stroke="currentColor" stroke-width=".14"' : ''}/>`;
    }
  }
  return cells;
};

export function glyph(type, color, requestedStyle = 'line') {
  if (!['rock', 'paper', 'scissors'].includes(type)) return '';
  const style = PIECE_STYLE_IDS.includes(requestedStyle) ? requestedStyle : 'line';
  if (style === 'sprite') {
    // Neutral has no row of its own; it borrows Blue's artwork rather than rendering blank.
    const source = spriteSource(type, color);
    return `<svg class="pc sprite pc-${color}" viewBox="0 0 ${SPRITE_CELL} ${SPRITE_CELL}">`
      + `<svg width="${SPRITE_CELL}" height="${SPRITE_CELL}" viewBox="${source.x} ${source.y} ${SPRITE_CELL} ${SPRITE_CELL}">`
      + `<image href="${SPRITE_SHEET}" width="128" height="64"/></svg></svg>`;
  }
  if (style === 'arcade') {
    return `<svg class="pc arcade pix pc-${color}" viewBox="0 0 12 12" fill="currentColor" stroke="currentColor">${pixelCells(type, true)}</svg>`;
  }
  if (style === 'solid') return svg(style, color, SOLID[type], 'fill="currentColor" stroke="none"');
  if (style === 'kanji') {
    return svg(style, color, `<text x="50" y="57" text-anchor="middle" dominant-baseline="central" font-size="70" font-weight="600">${KANJI[type]}</text>`, 'fill="currentColor" stroke="none"');
  }
  if (style === 'kawaii') {
    return svg(style, color, `<path d="${BASE[type]}" fill="currentColor" opacity=".24"/>`
      + `<path d="${BASE[type]}" fill="none"/>${FACE[type]}`, 'fill="currentColor" stroke="currentColor" stroke-width="5"');
  }
  if (style === 'origami') return svg(style, color, ORIGAMI[type], 'fill="currentColor" stroke="currentColor" stroke-width="1.5"');
  return svg('line', color, LINE[type]);
}
