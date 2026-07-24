// JANKEN shared rules engine — pure, no DOM. Imported by the browser client AND the
// Durable Object so move-legality is identical on both sides (single source of truth).
//
// A config (cfg) drives every variant:
//   size, perType            board dimensions & pieces-per-type
//   rockMove/paperMove/      movement archetype assigned to each RPS piece
//   scissorsMove
//   capture                  'rps' (only what you beat) | 'chess' (always)
//   territory                true = paint squares & race for area; false = elimination
//   retread                  (territory only) may stop on already-claimed squares
//   trail                    (territory only) sliders ink unclaimed squares they pass over
//   layout                   'rows' (centred facing blocks) | 'corners' | 'scattered' (random, symmetric)
//   first                    'B' | 'R'

export const BLUE = 'B', RED = 'R';
export const other = (c) => (c === BLUE ? RED : BLUE);
// One source for the piece budget: sanitizeCfg clamps perType to it, and decodePos
// rejects anything larger, so a custom position can always express a legal start.
export const MAX_PER_TYPE = 4;
export const MAX_PIECES_PER_SIDE = MAX_PER_TYPE * 3;
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const LETTER = { rock: 'R', paper: 'P', scissors: 'S' };

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KING = [...ORTHO, ...DIAG];
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const LONG_KING = [...KING, [-2, 0], [2, 0], [0, -2], [0, 2]];
export const MOVEMENT_TYPES = ['king', 'rook', 'bishop', 'knight', 'queen', 'cross', 'longking'];
export const MOVEMENT_LABELS = {
  king: 'King',
  rook: 'Rook',
  bishop: 'Bishop',
  knight: 'Knight',
  queen: 'Queen',
  cross: 'Cross',
  longking: 'Long king',
};
export const MOVEMENT_DESCRIPTIONS = {
  king: 'steps 1 — any way',
  rook: 'slides — straight',
  bishop: 'slides — diagonal',
  knight: 'jumps in an L',
  queen: 'slides — any way',
  cross: 'steps 1 — straight',
  longking: 'steps 1, or jumps 2 straight',
};
// Full-sentence forms, for prose rules and tooltips rather than compact labels.
export const MOVEMENT_SENTENCES = {
  king: 'moves one square in any direction',
  rook: 'slides any distance in a straight line',
  bishop: 'slides any distance diagonally',
  knight: 'jumps in an L, clearing anything in between',
  queen: 'slides any distance in any direction',
  cross: 'moves one square up, down, left or right',
  longking: 'moves one square any way, or jumps exactly two squares straight',
};
const MOVEMENT_PATTERNS = {
  king: { dirs: KING, slide: false },
  rook: { dirs: ORTHO, slide: true },
  bishop: { dirs: DIAG, slide: true },
  knight: { dirs: KNIGHT, slide: false },
  queen: { dirs: KING, slide: true },
  cross: { dirs: ORTHO, slide: false },
  longking: { dirs: LONG_KING, slide: false },
};
const LEGACY_MOVES = {
  classic: { rock: 'king', paper: 'rook', scissors: 'bishop' },
  kings: { rock: 'king', paper: 'king', scissors: 'king' },
  queens: { rock: 'queen', paper: 'queen', scissors: 'queen' },
};

export function movementFor(cfg, type) {
  const direct = cfg && cfg[`${type}Move`];
  if (MOVEMENT_TYPES.includes(direct)) return direct;
  return (LEGACY_MOVES[cfg?.moveStyle] || LEGACY_MOVES.kings)[type] || 'king';
}

// Accepting a movement/style string as the second argument keeps analysis tools and
// older callers compatible while the canonical rules use a per-piece config.
export function pattern(type, cfgOrMovement) {
  const movement = typeof cfgOrMovement === 'string'
    ? (MOVEMENT_TYPES.includes(cfgOrMovement)
      ? cfgOrMovement
      : (LEGACY_MOVES[cfgOrMovement] || LEGACY_MOVES.kings)[type])
    : movementFor(cfgOrMovement, type);
  return MOVEMENT_PATTERNS[movement] || MOVEMENT_PATTERNS.king;
}

export const fileL = (c) => String.fromCharCode(97 + c);
export const sqName = (r, c, size) => fileL(c) + (size - r);

export const emptyBoard = (S) => Array.from({ length: S }, () => Array.from({ length: S }, () => ({ owner: null, piece: null })));
export const cloneBoard = (b) => b.map(row => row.map(c => ({ owner: c.owner, piece: c.piece ? { ...c.piece } : null })));

// Starting position with 180° rotational symmetry. The default 'rows' layout places
// vertically ordered R/P/S blocks on the left and right sides of the board. 'scattered'
// randomises within each player's near half — fair because the whole board is shared
// state, not re-derived.
export function blocksBoard(size, per, layout = 'rows', random = Math.random) {
  const b = emptyBoard(size);
  const put = (r, c, type) => {
    b[r][c] = { owner: BLUE, piece: { type, color: BLUE } };
    b[size - 1 - r][size - 1 - c] = { owner: RED, piece: { type, color: RED } };
  };
  const rows = ['rock', 'paper', 'scissors'];
  if (layout === 'scattered') {
    const cells = [];
    for (let r = Math.floor(size / 2) + 1; r < size; r++) for (let c = 0; c < size; c++) cells.push([r, c]);
    for (let i = cells.length - 1; i > 0; i--) { const j = (random() * (i + 1)) | 0; [cells[i], cells[j]] = [cells[j], cells[i]]; }
    let k = 0;
    for (const type of rows) for (let n = 0; n < per; n++) put(cells[k][0], cells[k++][1], type);
    return b;
  }
  if (layout === 'rows') {
    // Use only the left half for Blue; put() creates Red in the disjoint right half.
    // At 9×9 / 2 per type this is exactly b6,c6 / b5,c5 / b4,c4, matching
    // the reference formation. Narrow boards wrap the block over extra centred rows.
    const half = Math.floor(size / 2);
    const width = Math.min(per, half);
    const height = Math.ceil((rows.length * per) / width);
    const r0 = Math.floor((size - height) / 2);
    const c0 = Math.floor((half - width) / 2);
    let index = 0;
    for (const type of rows) for (let n = 0; n < per; n++) {
      put(r0 + Math.floor(index / width), c0 + (index % width), type);
      index++;
    }
    return b;
  }
  for (let i = 0; i < rows.length; i++)
    for (let k = 0; k < per; k++) put(size - 1 - i, k, rows[i]);
  return b;
}

// Compact start-position code: one char per cell, row-major. '.' is empty;
// R/P/S are Blue rock/paper/scissors, lowercase for Red. Pieces stand on their
// own colour (like blocksBoard); everything else starts unclaimed.
const TYPE_OF = { R: 'rock', P: 'paper', S: 'scissors' };
export function encodePos(board) {
  return board.map((row) => row.map((cell) => {
    if (!cell.piece) return '.';
    const letter = LETTER[cell.piece.type];
    return cell.piece.color === BLUE ? letter : letter.toLowerCase();
  }).join('')).join('');
}
export function decodePos(str, size) {
  if (typeof str !== 'string' || str.length !== size * size) return null;
  const b = emptyBoard(size);
  let blue = 0, red = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') continue;
    const type = TYPE_OF[ch.toUpperCase()];
    if (!type) return null;
    const color = ch === ch.toUpperCase() ? BLUE : RED;
    if (color === BLUE) blue++; else red++;
    b[(i / size) | 0][i % size] = { owner: color, piece: { type, color } };
  }
  if (!blue || !red || blue > MAX_PIECES_PER_SIDE || red > MAX_PIECES_PER_SIDE) return null;
  return b;
}

// Companion layer for exact analysis/JPGN positions. One character per cell:
// B/R for painted ownership and '.' for neutral. Piece and ownership layers stay
// separate so the original compact piece code remains backward compatible.
export function encodeOwners(board) {
  return board.map((row) => row.map((cell) => cell.owner || '.').join('')).join('');
}
export function decodeOwners(str, board) {
  if (typeof str !== 'string' || !Array.isArray(board) || str.length !== board.length * board.length) return null;
  if (!/^[BR.]+$/.test(str)) return null;
  const out = cloneBoard(board);
  for (let i = 0; i < str.length; i++) {
    const owner = str[i] === '.' ? null : str[i];
    const cell = out[(i / out.length) | 0][i % out.length];
    if (cell.piece && owner !== cell.piece.color) return null;
    cell.owner = owner;
  }
  return out;
}

export function scoreOf(board) {
  let B = 0, R = 0, open = 0;
  for (const row of board) for (const c of row) { if (c.owner === BLUE) B++; else if (c.owner === RED) R++; else open++; }
  return { B, R, open };
}
export function pieceCounts(board) {
  let B = 0, R = 0;
  for (const row of board) for (const c of row) if (c.piece) { if (c.piece.color === BLUE) B++; else R++; }
  return { B, R };
}
// The scoreboard metric for the active variant.
export function result(game) {
  if (game.cfg.territory) { const s = scoreOf(game.board); return { B: s.B, R: s.R, open: s.open, metric: 'squares' }; }
  const p = pieceCounts(game.board); return { B: p.B, R: p.R, open: 0, metric: 'pieces' };
}

const canCap = (att, def, capture) => capture === 'chess' ? true : BEATS[att.type] === def.type;

// Landing rule: with territory & no re-tread you may only stop on an UNCLAIMED empty
// square (or capture) — sliders glide over painted squares. Otherwise any empty square
// is a valid stop (classic chess movement). Pieces always block a slide.
export function legalDest(board, r, c, cfg) {
  const p = board[r][c].piece;
  if (!p) return [];
  const S = board.length, inB = (a, b) => a >= 0 && a < S && b >= 0 && b < S, out = [];
  const pat = pattern(p.type, cfg);
  const freeLand = cfg.retread || !cfg.territory;
  const kind = (nr, nc) => {
    const cell = board[nr][nc];
    if (cell.piece) return (cell.piece.color !== p.color && canCap(p, cell.piece, cfg.capture)) ? 'cap' : 'block';
    if (freeLand) return 'land';
    return cell.owner === null ? 'land' : 'skip';
  };
  if (!pat.slide) {
    for (const [dr, dc] of pat.dirs) {
      const nr = r + dr, nc = c + dc;
      if (!inB(nr, nc)) continue;
      const k = kind(nr, nc);
      if (k === 'land' || k === 'cap') out.push([nr, nc]);
    }
  } else {
    for (const [dr, dc] of pat.dirs) {
      let nr = r + dr, nc = c + dc;
      while (inB(nr, nc)) {
        const k = kind(nr, nc);
        if (k === 'land') out.push([nr, nc]);
        else if (k === 'cap') { out.push([nr, nc]); break; }
        else if (k === 'block') break;
        nr += dr; nc += dc;
      }
    }
  }
  return out;
}

export function hasMove(board, color, cfg) {
  for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
    const p = board[r][c].piece;
    if (p && p.color === color && legalDest(board, r, c, cfg).length) return true;
  }
  return false;
}
export function allMoves(board, color, cfg) {
  const res = [];
  for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
    const p = board[r][c].piece;
    if (p && p.color === color) for (const [tr, tc] of legalDest(board, r, c, cfg)) res.push({ fr: r, fc: c, tr, tc });
  }
  return res;
}
export function isLegal(board, m, turn, cfg) {
  const row = board[m.fr]; const p = row && row[m.fc] && row[m.fc].piece;
  if (!p || p.color !== turn) return false;
  return legalDest(board, m.fr, m.fc, cfg).some(t => t[0] === m.tr && t[1] === m.tc);
}

// Return the reason the position is terminal, or null while play can continue. The
// winner is whoever leads the active scoreboard when this condition is reached.
export function terminalReason(game) {
  const cfg = game.cfg;
  const pieces = pieceCounts(game.board);
  if (pieces.B === 0 || pieces.R === 0) return 'elimination';
  if (cfg.territory) {
    if (scoreOf(game.board).open === 0) return 'territory';
  }
  // A player who cannot move can no longer contest the board, so the game ends immediately
  // rather than letting the mobile side keep painting/capturing against a locked-out opponent.
  if (!hasMove(game.board, BLUE, cfg) || !hasMove(game.board, RED, cfg)) return 'immobilization';
  if (game.dry >= Math.max(60, cfg.size * cfg.size)) return 'stall';
  return null;
}

function endNow(game) {
  const reason = terminalReason(game);
  if (!reason) return false;
  game.endReason = game.endReason || reason;
  return true;
}

// Hand over the turn, or end the game if it is now decided. endNow already accounts for a
// stuck side (either colour), so there is no passing — being immobilized ends the game.
export function resolveTurn(game) {
  if (endNow(game)) { game.gameOver = true; return; }
  game.passStreak = 0;
  game.acts = 0;
}

// Apply a validated move (mutates the game). Returns whether it was a capture.
// A turn is up to cfg.actionsPerTurn moves by the same player.
export function applyMove(game, m) {
  const cfg = game.cfg, b = game.board, p = b[m.fr][m.fc].piece;
  const captured = b[m.tr][m.tc].piece;
  const cap = !!captured;
  let claimedNeutral = cfg.territory && !cap && b[m.tr][m.tc].owner === null;
  b[m.fr][m.fc].piece = null;
  if (cfg.territory && cfg.trail && pattern(p.type, cfg).slide) {
    // Ink trail: a slide paints the unclaimed squares it glides over (never repaints).
    const dr = Math.sign(m.tr - m.fr), dc = Math.sign(m.tc - m.fc);
    for (let r = m.fr + dr, c = m.fc + dc; r !== m.tr || c !== m.tc; r += dr, c += dc) {
      if (b[r][c].owner === null) { b[r][c].owner = p.color; claimedNeutral = true; }
    }
  }
  b[m.tr][m.tc] = { owner: cfg.territory ? p.color : b[m.tr][m.tc].owner, piece: p };
  game.lastMove = { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc };
  game.moves.push({
    c: p.color,
    piece: p.type,
    from: [m.fr, m.fc],
    to: [m.tr, m.tc],
    capture: captured ? captured.type : null,
    t: `${LETTER[p.type]} ${sqName(m.fr, m.fc, b.length)}${cap ? '×' : '–'}${sqName(m.tr, m.tc, b.length)}`,
  });
  game.passStreak = 0;
  game.dry = (cap || claimedNeutral) ? 0 : (game.dry + 1);
  game.acts = (game.acts || 0) + 1;
  if (endNow(game)) { game.gameOver = true; return cap; }
  const N = cfg.actionsPerTurn || 1;
  if (game.acts < N && hasMove(game.board, p.color, cfg)) return cap;   // same player moves again
  game.turn = other(p.color);
  resolveTurn(game);
  return cap;
}

export function newGame(cfg, board) {
  const start = board || blocksBoard(cfg.size, cfg.perType, cfg.layout);
  const g = {
    board: start,
    startPos: encodePos(start),
    startOwners: encodeOwners(start),
    turn: cfg.first,
    moves: [],
    passStreak: 0,
    gameOver: false,
    endReason: null,
    lastMove: null,
    dry: 0,
    acts: 0,
    cfg,
  };
  resolveTurn(g);
  return g;
}

export const PRESETS = {
  standard: {
    size: 9, perType: 2, rockMove: 'king', paperMove: 'king', scissorsMove: 'king',
    moveStyle: 'kings', capture: 'rps', territory: true, retread: true, trail: false,
    layout: 'rows', actionsPerTurn: 1, first: BLUE,
  },
  kings: {
    size: 9, perType: 2, rockMove: 'rook', paperMove: 'knight', scissorsMove: 'bishop',
    moveStyle: 'custom', capture: 'rps', territory: false, retread: false, trail: false,
    layout: 'rows', actionsPerTurn: 1, first: BLUE,
  },
  painters: {
    size: 9, perType: 2, rockMove: 'queen', paperMove: 'queen', scissorsMove: 'queen',
    moveStyle: 'queens', capture: 'rps', territory: true, retread: false, trail: true,
    layout: 'rows', actionsPerTurn: 1, first: BLUE,
  },
  // Every preset spells out all twelve compared fields, so presetOf() can recognise one
  // exactly. Standard's values are the base; each variant states only what it changes.
  ...Object.fromEntries(Object.entries({
    skirmish: { size: 6, perType: 1 },
    triple: { actionsPerTurn: 3 },
    cavalry: { rockMove: 'knight', paperMove: 'knight', scissorsMove: 'knight' },
    ambush: { layout: 'scattered' },
    siege: { layout: 'corners', retread: false },
    expanse: { size: 13, perType: 4 },
    melee: { capture: 'chess', territory: false, retread: false },
  }).map(([key, over]) => [key, {
    size: 9, perType: 2, rockMove: 'king', paperMove: 'king', scissorsMove: 'king',
    capture: 'rps', territory: true, retread: true, trail: false,
    layout: 'rows', actionsPerTurn: 1, first: BLUE, ...over,
  }])),
};

// Display order and flavour for the variant picker. Every PRESETS key appears here.
export const PRESET_INFO = {
  standard: { label: 'Standard', tagline: 'Everything moves one square. Land anywhere, and it is yours.' },
  skirmish: { label: 'Skirmish', tagline: 'A pocket 6×6 with one of each piece. Decided in a hurry.' },
  triple: { label: 'Triple step', tagline: 'Three moves a turn. Ground changes hands three times as fast.' },
  cavalry: { label: 'Cavalry', tagline: 'All knights. Nothing blocks a jump, so nothing is ever safe.' },
  painters: { label: 'Painters', tagline: 'Queens that ink every unclaimed square they glide across.' },
  ambush: { label: 'Ambush', tagline: 'Both armies scattered at random across their own half.' },
  siege: { label: 'Siege', tagline: 'A corner stand-off with no stepping back — only fresh ground counts.' },
  expanse: { label: 'Expanse', tagline: '13×13 with four of each. A long, patient campaign.' },
  kings: { label: "King's field", tagline: 'Rook, knight, bishop. No painting — take the last piece standing.' },
  melee: { label: 'Melee', tagline: 'Capture anything you reach. The RPS cycle is switched off.' },
  custom: { label: 'Custom', tagline: 'Your rules. Every dial below is yours to turn.' },
};
export const PRESET_KEYS = Object.keys(PRESET_INFO);
export const presetLabel = (key) => PRESET_INFO[key]?.label || 'Custom';
// Which preset (if any) a cfg currently matches, else 'custom'.
export function presetOf(cfg) {
  const safe = sanitizeCfg(cfg);
  const fields = [
    'size', 'perType', 'rockMove', 'paperMove', 'scissorsMove', 'capture',
    'territory', 'retread', 'trail', 'layout', 'actionsPerTurn', 'first',
  ];
  for (const k in PRESETS) if (fields.every((field) => PRESETS[k][field] === safe[field])) return k;
  return 'custom';
}

export function movementLabel(cfg) {
  const moves = ['rock', 'paper', 'scissors'].map((type) => movementFor(cfg, type));
  if (moves.every((move) => move === moves[0])) {
    const label = MOVEMENT_LABELS[moves[0]].toLowerCase();
    return `all ${label === 'cross' ? 'crosses' : `${label}s`}`;
  }
  return moves
    .map((move, index) => `${['R', 'P', 'S'][index]} ${MOVEMENT_LABELS[move].toLowerCase()}`)
    .join(' / ');
}

// Short human summary, e.g. "9×9 · all kings · RPS · territory+".
export function variantLabel(cfg) {
  const safe = sanitizeCfg(cfg);
  const parts = [`${safe.size}×${safe.size}`, movementLabel(safe), safe.capture === 'rps' ? 'RPS' : 'chess-capture'];
  parts.push(safe.territory ? (safe.retread ? 'territory+' : 'territory') : 'elimination');
  if (safe.trail) parts.push('ink');
  if (safe.layout !== 'rows') parts.push(safe.layout);
  if (safe.actionsPerTurn > 1) parts.push(`${safe.actionsPerTurn} actions`);
  return parts.join(' · ');
}

const PIECE_WORDS = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
const LAYOUT_PROSE = {
  rows: 'facing blocks near the centre',
  corners: 'blocks anchored to opposite corners',
  scattered: 'scattered at random within each half',
};
// The whole game explained from scratch for exactly these rules — used by the in-game rules
// flap, so a player reading it is never told about a variant they are not playing.
export function rulesSummary(cfg) {
  const safe = sanitizeCfg(cfg);
  const n = safe.perType, s = n === 1 ? '' : 's';
  const out = [{
    h: 'The board',
    p: `Blue and Red share a ${safe.size}×${safe.size} board. Each side starts with ${n} rock${s}, `
      + `${n} paper${s} and ${n} scissors, arranged in ${LAYOUT_PROSE[safe.layout]} with 180° `
      + `rotational symmetry. ${safe.first === BLUE ? 'Blue' : 'Red'} moves first.`,
  }, {
    h: 'Moving',
    // When all three share one archetype, say it once instead of three times.
    p: (() => {
      const moves = ['rock', 'paper', 'scissors'].map((type) => movementFor(safe, type));
      const body = moves.every((move) => move === moves[0])
        ? `Every piece ${MOVEMENT_SENTENCES[moves[0]]}.`
        : `${moves.map((move, i) => `${PIECE_WORDS[['rock', 'paper', 'scissors'][i]]} ${MOVEMENT_SENTENCES[move]}`).join('; ')}.`;
      return `${body} A slide stops at the first piece in its path; a jump ignores whatever it passes over.`;
    })(),
  }, {
    h: 'Capturing',
    p: safe.capture === 'rps'
      ? 'You may only take a piece you beat — rock takes scissors, scissors takes paper, paper '
        + 'takes rock. An enemy you cannot take blocks you instead, which makes piece identity '
        + 'as much a wall as a weapon.'
      : 'Any enemy piece may be captured. The rock-paper-scissors cycle is switched off, so '
        + 'every piece threatens every other.',
  }];
  if (safe.territory) {
    out.push({
      h: 'Painting',
      p: 'Every square a piece lands on is painted its colour, permanently. '
        + (safe.retread
          ? 'Pieces may stop on squares that are already painted, including your own.'
          : 'A piece may only stop on unclaimed ground or on a capture — painted squares are '
            + 'glided over, never landed on.')
        + (safe.trail ? ' Sliding pieces also ink every unclaimed square they pass through.' : ''),
    }, {
      h: 'Winning',
      p: 'The game ends when no unclaimed square is left, when a side has no pieces, or when a '
        + 'side cannot move. Whoever holds the most squares wins.',
    });
  } else {
    out.push({
      h: 'Winning',
      p: 'Nothing is painted here. Capture every enemy piece to win outright; if a side cannot '
        + 'move or the game stalls, whoever has more pieces left wins.',
    });
  }
  if (safe.actionsPerTurn > 1) {
    out.push({
      h: 'Turns',
      p: `A turn is up to ${safe.actionsPerTurn} moves by the same player, and they may be made `
        + 'with the same piece or different ones. The turn ends early if no legal move remains.',
    });
  }
  return out;
}

// Clamp an untrusted config to safe ranges (server-side guard against abuse).
export function sanitizeCfg(raw) {
  raw = raw || {};
  const clamp = (v, lo, hi, d) => { v = Math.floor(+v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const one = (v, set, d) => set.includes(v) ? v : d;
  const territory = raw.territory !== false;
  const legacy = LEGACY_MOVES[raw.moveStyle] || LEGACY_MOVES.kings;
  const rockMove = one(raw.rockMove, MOVEMENT_TYPES, legacy.rock);
  const paperMove = one(raw.paperMove, MOVEMENT_TYPES, legacy.paper);
  const scissorsMove = one(raw.scissorsMove, MOVEMENT_TYPES, legacy.scissors);
  const moveStyle = rockMove === 'king' && paperMove === 'king' && scissorsMove === 'king'
    ? 'kings'
    : rockMove === 'queen' && paperMove === 'queen' && scissorsMove === 'queen'
      ? 'queens'
      : rockMove === 'king' && paperMove === 'rook' && scissorsMove === 'bishop'
        ? 'classic'
        : 'custom';
  return {
    size: clamp(raw.size, 6, 13, 9),
    perType: clamp(raw.perType, 1, MAX_PER_TYPE, 2),
    rockMove,
    paperMove,
    scissorsMove,
    moveStyle,
    capture: one(raw.capture, ['rps', 'chess'], 'rps'),
    territory,
    retread: territory && raw.retread !== false,
    trail: territory && !!raw.trail,
    layout: one(raw.layout, ['rows', 'corners', 'scattered'], 'rows'),
    actionsPerTurn: clamp(raw.actionsPerTurn, 1, 3, 1),
    first: raw.first === RED ? RED : BLUE,
  };
}
