// Colour-aware, dependency-free piece artwork. Every family is inline SVG so it
// stays sharp from the 22px legend to the full board and automatically follows
// the active Blue/Red palette.

export const PIECE_STYLES = Object.freeze([
  { id: 'line', label: 'Line' },
  { id: 'solid', label: 'Solid' },
  { id: 'pixel', label: 'Pixel' },
  { id: 'kanji', label: 'Kanji' },
  { id: 'kawaii', label: 'Rounded kawaii' },
  { id: 'blob', label: 'Chunky blob' },
  { id: 'geometric', label: 'Geometric' },
  { id: 'doodle', label: 'Hand-drawn' },
  { id: 'origami', label: 'Origami' },
  { id: 'sticker', label: 'Sticker' },
  { id: 'arcade', label: 'Retro arcade' },
  { id: 'halftone', label: 'Halftone' },
  { id: 'ghost', label: 'Ghost line' },
  { id: 'longshadow', label: 'Long shadow' },
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

const DOODLE = {
  rock: `<path d="M16 66 Q20 52 29 45 Q27 35 39 29 Q48 20 57 30 Q69 25 72 40 Q86 45 82 61 Q88 72 73 78 Q56 85 35 81 Q20 83 16 66 Z"/>
         <path d="M30 66 L67 38 M36 75 L76 48 M48 79 L78 59" stroke-width="3"/>`,
  paper: `<path d="M29 18 Q31 14 37 16 L61 15 L76 30 L74 84 Q72 87 66 84 L31 86 Q28 83 30 76 Z"/>
          <path d="M61 16 L60 31 L75 30 M38 45 Q52 42 66 45 M38 57 Q51 54 65 58 M38 70 Q48 67 58 70" stroke-width="4"/>`,
  scissors: `<path d="M29 18 Q33 14 38 21 L52 50 L66 17 Q72 13 76 21 L58 59"/>
             <path d="M42 59 Q25 58 25 75 Q26 87 37 86 Q48 85 50 71 Q52 85 64 87 Q75 86 76 75 Q75 59 58 59"/>
             <path d="M27 30 L35 27 M66 31 L75 34 M48 40 L53 43" stroke-width="3"/>`,
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

const GEOMETRIC = {
  rock: '<path d="M29 21 H70 L88 51 L70 81 H29 L12 51 Z"/>',
  paper: '<path d="M28 14 H61 L77 30 V86 H28 Z"/><path d="M61 14 V30 H77" fill="#fff" opacity=".28"/>',
  scissors: '<path d="M25 18 L32 13 L53 46 L68 13 L76 19 L58 52 L76 79 L68 86 L51 60 L34 86 L25 79 L44 52 Z"/><circle cx="32" cy="80" r="8" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="68" cy="80" r="8" fill="none" stroke="currentColor" stroke-width="6"/>',
};

const HALFTONE_LINES = {
  rock: '<path d="M24 52 L53 24 M18 65 L66 24 M20 76 L78 34 M34 83 L84 48 M51 83 L82 62" stroke-width="3" stroke-dasharray="1 5"/>',
  paper: '<path d="M34 28 L69 28 M34 38 L69 38 M34 48 L69 48 M34 58 L69 58 M34 68 L69 68 M34 78 L69 78" stroke-width="3" stroke-dasharray="1 5"/>',
  scissors: '<path d="M28 21 L71 80 M72 20 L29 81" stroke-width="9" stroke-dasharray="1 5"/><circle cx="33" cy="76" r="7" stroke-width="3" stroke-dasharray="1 4"/><circle cx="67" cy="76" r="7" stroke-width="3" stroke-dasharray="1 4"/>',
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
  if (style === 'pixel') {
    return `<svg class="pc pixel pix pc-${color}" viewBox="0 0 12 12" fill="currentColor" stroke="none">${pixelCells(type)}</svg>`;
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
  if (style === 'blob') {
    return svg(style, color, `<path d="${BASE[type]}"/><path d="${BASE[type]}" transform="translate(5 7) scale(.9)" fill="#fff" opacity=".12"/>`, 'fill="currentColor" stroke="currentColor" stroke-width="4"');
  }
  if (style === 'geometric') return svg(style, color, GEOMETRIC[type], 'fill="currentColor" stroke="none"');
  if (style === 'doodle') return svg(style, color, DOODLE[type], 'fill="none" stroke="currentColor" stroke-width="5"');
  if (style === 'origami') return svg(style, color, ORIGAMI[type], 'fill="currentColor" stroke="currentColor" stroke-width="1.5"');
  if (style === 'sticker') {
    return svg(style, color, `<g fill="currentColor" stroke="#fff" stroke-width="15">${BASE[type] ? `<path d="${BASE[type]}"/>` : ''}</g>`
      + `<path d="${BASE[type]}" fill="currentColor" stroke="currentColor" stroke-width="4"/>`);
  }
  if (style === 'halftone') {
    return svg(style, color, `<path d="${BASE[type]}" fill="currentColor" opacity=".12"/>`
      + `<path d="${BASE[type]}"/>${HALFTONE_LINES[type]}`, 'fill="none" stroke="currentColor" stroke-width="5"');
  }
  if (style === 'ghost') {
    return svg(style, color, `<path d="${BASE[type]}"/>`, 'fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="7 7"');
  }
  if (style === 'longshadow') {
    return svg(style, color, `<g transform="translate(8 8)" opacity=".2">${SOLID[type]}</g>${SOLID[type]}`, 'fill="currentColor" stroke="none"');
  }
  return svg('line', color, LINE[type]);
}
