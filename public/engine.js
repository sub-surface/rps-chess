// JANKEN shared rules engine — pure, no DOM. Imported by the browser client AND the
// Durable Object so move-legality is identical on both sides (single source of truth).
//
// A config (cfg) drives every variant:
//   size, perType            board dimensions & pieces-per-type
//   moveStyle                'classic' (R=king,P=rook,S=bishop) | 'kings' | 'queens'
//   capture                  'rps' (only what you beat) | 'chess' (always)
//   territory                true = paint squares & race for area; false = elimination
//   retread                  (territory only) may stop on already-claimed squares
//   trail                    (territory only) sliders ink unclaimed squares they pass over
//   layout                   'rows' (centred blocks) | 'corners' | 'scattered' (random, symmetric)
//   first                    'B' | 'R'

export const BLUE = 'B', RED = 'R';
export const other = (c) => (c === BLUE ? RED : BLUE);
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const LETTER = { rock: 'R', paper: 'P', scissors: 'S' };

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KING = [...ORTHO, ...DIAG];
const PATTERNS = {
  classic: { rock: { dirs: KING, slide: false }, paper: { dirs: ORTHO, slide: true }, scissors: { dirs: DIAG, slide: true } },
  kings: { rock: { dirs: KING, slide: false }, paper: { dirs: KING, slide: false }, scissors: { dirs: KING, slide: false } },
  queens: { rock: { dirs: KING, slide: true }, paper: { dirs: KING, slide: true }, scissors: { dirs: KING, slide: true } },
};
export const pattern = (type, style) => (PATTERNS[style] || PATTERNS.classic)[type];

export const fileL = (c) => String.fromCharCode(97 + c);
export const sqName = (r, c, size) => fileL(c) + (size - r);

export const emptyBoard = (S) => Array.from({ length: S }, () => Array.from({ length: S }, () => ({ owner: null, piece: null })));
export const cloneBoard = (b) => b.map(row => row.map(c => ({ owner: c.owner, piece: c.piece ? { ...c.piece } : null })));

// Starting position with 180° rotational symmetry. 'scattered' randomises within each
// player's near half — fair because the whole board is shared state, not re-derived.
export function blocksBoard(size, per, layout = 'rows') {
  const b = emptyBoard(size);
  const put = (r, c, type) => {
    b[r][c] = { owner: BLUE, piece: { type, color: BLUE } };
    b[size - 1 - r][size - 1 - c] = { owner: RED, piece: { type, color: RED } };
  };
  const rows = ['rock', 'paper', 'scissors'];
  if (layout === 'scattered') {
    const cells = [];
    for (let r = Math.floor(size / 2) + 1; r < size; r++) for (let c = 0; c < size; c++) cells.push([r, c]);
    for (let i = cells.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cells[i], cells[j]] = [cells[j], cells[i]]; }
    let k = 0;
    for (const type of rows) for (let n = 0; n < per; n++) put(cells[k][0], cells[k++][1], type);
    return b;
  }
  const c0 = layout === 'corners' ? 0 : Math.floor((size - per) / 2);
  for (let i = 0; i < rows.length; i++)
    for (let k = 0; k < per; k++) put(size - 1 - i, c0 + k, rows[i]);
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
  if (!blue || !red || blue > 12 || red > 12) return null;
  return b;
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
  const pat = pattern(p.type, cfg.moveStyle);
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

// True when the game is decided regardless of whose turn it is.
function endNow(game) {
  const cfg = game.cfg;
  if (cfg.territory) { if (scoreOf(game.board).open === 0) return true; }
  else { const pc = pieceCounts(game.board); if (pc.B === 0 || pc.R === 0) return true; }
  return game.dry >= Math.max(60, cfg.size * cfg.size);   // no-progress stall guard
}

// Hand over the turn; auto-pass a stuck side, end on board-full / elimination / stall.
export function resolveTurn(game) {
  if (endNow(game)) { game.gameOver = true; return; }
  let guard = 0;
  while (!hasMove(game.board, game.turn, game.cfg)) {
    game.passStreak++;
    if (game.passStreak >= 2) { game.gameOver = true; return; }
    game.turn = other(game.turn);
    if (++guard > 3) { game.gameOver = true; return; }
  }
  game.acts = 0;
}

// Apply a validated move (mutates the game). Returns whether it was a capture.
// A turn is up to cfg.actionsPerTurn moves by the same player.
export function applyMove(game, m) {
  const cfg = game.cfg, b = game.board, p = b[m.fr][m.fc].piece;
  const cap = !!b[m.tr][m.tc].piece;
  let claimedNeutral = cfg.territory && !cap && b[m.tr][m.tc].owner === null;
  b[m.fr][m.fc].piece = null;
  if (cfg.territory && cfg.trail) {
    // Ink trail: a slide paints the unclaimed squares it glides over (never repaints).
    const dr = Math.sign(m.tr - m.fr), dc = Math.sign(m.tc - m.fc);
    for (let r = m.fr + dr, c = m.fc + dc; r !== m.tr || c !== m.tc; r += dr, c += dc) {
      if (b[r][c].owner === null) { b[r][c].owner = p.color; claimedNeutral = true; }
    }
  }
  b[m.tr][m.tc] = { owner: cfg.territory ? p.color : b[m.tr][m.tc].owner, piece: p };
  game.lastMove = { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc };
  game.moves.push({ c: p.color, t: `${LETTER[p.type]} ${sqName(m.fr, m.fc, b.length)}${cap ? '×' : '–'}${sqName(m.tr, m.tc, b.length)}` });
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
  const g = { board: board || blocksBoard(cfg.size, cfg.perType, cfg.layout), turn: cfg.first, moves: [], passStreak: 0, gameOver: false, lastMove: null, dry: 0, acts: 0, cfg };
  resolveTurn(g);
  return g;
}

export const PRESETS = {
  standard: { size: 9, perType: 2, moveStyle: 'classic', capture: 'rps', territory: true, retread: false, trail: false, layout: 'rows', actionsPerTurn: 1, first: BLUE },
  kings: { size: 9, perType: 2, moveStyle: 'kings', capture: 'rps', territory: false, retread: false, trail: false, layout: 'rows', actionsPerTurn: 1, first: BLUE },
  painters: { size: 9, perType: 2, moveStyle: 'queens', capture: 'rps', territory: true, retread: false, trail: true, layout: 'rows', actionsPerTurn: 1, first: BLUE },
};
// Which preset (if any) a cfg currently matches, else 'custom'.
export function presetOf(cfg) {
  for (const k in PRESETS) if (['size', 'perType', 'moveStyle', 'capture', 'territory', 'retread', 'trail', 'layout', 'actionsPerTurn', 'first'].every(f => PRESETS[k][f] === cfg[f])) return k;
  return 'custom';
}

// Short human summary of a variant, e.g. "9×9 · classic · RPS · territory".
export function variantLabel(cfg) {
  const parts = [`${cfg.size}×${cfg.size}`, cfg.moveStyle, cfg.capture === 'rps' ? 'RPS' : 'chess-capture'];
  parts.push(cfg.territory ? (cfg.retread ? 'territory+' : 'territory') : 'elimination');
  if (cfg.trail) parts.push('ink');
  if (cfg.layout && cfg.layout !== 'rows') parts.push(cfg.layout);
  if ((cfg.actionsPerTurn || 1) > 1) parts.push(`${cfg.actionsPerTurn} actions`);
  return parts.join(' · ');
}

// Clamp an untrusted config to safe ranges (server-side guard against abuse).
export function sanitizeCfg(raw) {
  raw = raw || {};
  const clamp = (v, lo, hi, d) => { v = Math.floor(+v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const one = (v, set, d) => set.includes(v) ? v : d;
  return {
    size: clamp(raw.size, 6, 13, 9),
    perType: clamp(raw.perType, 1, 4, 2),
    moveStyle: one(raw.moveStyle, ['classic', 'kings', 'queens'], 'classic'),
    capture: one(raw.capture, ['rps', 'chess'], 'rps'),
    territory: raw.territory !== false,
    retread: !!raw.retread && raw.territory !== false,
    trail: !!raw.trail && raw.territory !== false,
    layout: one(raw.layout, ['rows', 'corners', 'scattered'], 'rows'),
    actionsPerTurn: clamp(raw.actionsPerTurn, 1, 3, 1),
    first: raw.first === RED ? RED : BLUE,
  };
}
