// JANKEN shared rules engine — pure, no DOM. Imported by the browser client AND the
// Durable Object so move-legality is identical on both sides (single source of truth).
//
// A config (cfg) drives every variant:
//   size, perType            board dimensions & pieces-per-type
//   rockMove/paperMove/      movement archetype assigned to each RPS piece
//   scissorsMove
//   capture                  'rps' (only what you beat) | 'chess' (always)
//                            | 'checkers' (leap an adjacent enemy)
//   territory                true = paint squares & race for area; false = elimination
//   retread                  (territory only) may stop on already-claimed squares
//   trail                    (territory only) sliders ink unclaimed squares they pass over
//   enclosure                (territory only) closed regions flip; enemy pieces inside are removed
//   threefold                third occurrence of the same playable state is an automatic draw
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
  king: 'moves one square any way',
  rook: 'slides in a straight line',
  bishop: 'slides diagonally',
  knight: 'jumps in an L',
  queen: 'slides any way',
  cross: 'moves one square straight',
  longking: 'moves one square any way, or jumps two straight',
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

// Two ways to say the same square. `chess` is canonical and the only thing that reaches
// authoritative state or JPGN movetext: a1 is bottom-left, files run right, ranks run up. `grid`
// is the labelling most people reach for unprompted — rows lettered downward, columns numbered
// rightward, so a1 is top-left — and exists as a display preference only. Keeping the default in
// the fourth argument means every historical call site still writes chess coordinates.
export const COORD_STYLES = Object.freeze(['chess', 'grid']);
export const sqName = (r, c, size, style = 'chess') =>
  (style === 'grid' ? fileL(r) + (c + 1) : fileL(c) + (size - r));
// The two labels a coordinate ruler shows for a cell: [along the left edge, along the bottom].
export const axisLabels = (r, c, size, style = 'chess') =>
  (style === 'grid' ? [fileL(r), String(c + 1)] : [String(size - r), fileL(c)]);

export const emptyBoard = (S) => Array.from({ length: S }, () => Array.from({ length: S }, () => ({ owner: null, piece: null })));
export const cloneBoard = (b) => b.map(row => row.map(c => ({ owner: c.owner, piece: c.piece ? { ...c.piece } : null })));

const normalizedBoardSize = (raw) => {
  const value = Math.floor(+raw);
  return Number.isFinite(value) ? Math.max(3, Math.min(13, value)) : 9;
};

// The smallest boards cannot hold four of every piece without a formation crossing
// its 180-degree mirror. Keep this geometry-derived limit beside blocksBoard so the UI,
// restored configs and the server all agree on what can actually be placed.
export function maxPerTypeForBoard(rawSize, rawLayout = 'rows') {
  const size = normalizedBoardSize(rawSize);
  const layout = ['rows', 'corners', 'scattered'].includes(rawLayout) ? rawLayout : 'rows';
  if (layout === 'rows') {
    return Math.min(MAX_PER_TYPE, Math.max(1, Math.floor((size * Math.floor(size / 2)) / 3)));
  }
  if (layout === 'scattered') {
    const nearHalfCells = size * Math.floor((size - 1) / 2);
    return Math.min(MAX_PER_TYPE, Math.max(1, Math.floor(nearHalfCells / 3)));
  }
  const fitsCorners = (per) => {
    const occupied = new Set();
    for (let type = 0; type < 3; type++) for (let copy = 0; copy < per; copy++) {
      const cells = [
        [size - 1 - type, copy],
        [type, size - 1 - copy],
      ];
      for (const [row, col] of cells) {
        if (row < 0 || row >= size || col < 0 || col >= size) return false;
        const key = `${row}:${col}`;
        if (occupied.has(key)) return false;
        occupied.add(key);
      }
    }
    return true;
  };
  for (let per = MAX_PER_TYPE; per > 1; per--) if (fitsCorners(per)) return per;
  return 1;
}

// Analysis-board transforms return fresh boards so their source never changes underneath
// the operation. Mirror rebuilds the opposing army and painted territory as an exact
// 180-degree, colour-swapped copy of the chosen side; Rotate moves the whole position.
export function mirrorArmy(board, source = BLUE) {
  const target = other(source);
  const original = cloneBoard(board);
  const out = cloneBoard(board);
  const size = out.length;

  for (const row of out) for (const cell of row) {
    if (cell.piece?.color === target) cell.piece = null;
    if (cell.owner === target) cell.owner = null;
  }
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const sourceCell = original[row][col];
    const sourcePiece = sourceCell.piece?.color === source ? sourceCell.piece : null;
    if (sourceCell.owner !== source && !sourcePiece) continue;
    const targetCell = out[size - 1 - row][size - 1 - col];
    // A self-overlap on an odd board cannot hold both colours; keep the source intact.
    if (targetCell.owner === source || targetCell.piece?.color === source) continue;
    targetCell.owner = target;
    targetCell.piece = sourcePiece ? { type: sourcePiece.type, color: target } : null;
  }
  return out;
}

export function rotateBoard(board) {
  const size = board.length;
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => {
    const cell = board[size - 1 - row][size - 1 - col];
    return { owner: cell.owner, piece: cell.piece ? { ...cell.piece } : null };
  }));
}

// Starting position with 180° rotational symmetry. The default 'rows' layout places
// vertically ordered R/P/S blocks on the left and right sides of the board. 'scattered'
// randomises within each player's near half — fair because the whole board is shared
// state, not re-derived.
export function blocksBoard(size, per, layout = 'rows', random = Math.random) {
  size = normalizedBoardSize(size);
  layout = ['rows', 'corners', 'scattered'].includes(layout) ? layout : 'rows';
  const requested = Math.floor(+per);
  per = Number.isFinite(requested) ? Math.max(1, Math.min(maxPerTypeForBoard(size, layout), requested)) : 1;
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

// A repeated state must offer exactly the same choices. Painted ownership matters only
// in territory games; side-to-move and the action already used matter in multi-action turns.
export function repetitionKey(game) {
  const territory = game.cfg?.territory ? encodeOwners(game.board) : '-';
  return `${game.turn}:${game.acts || 0}:${encodePos(game.board)}:${territory}`;
}

// New games seed the opening as occurrence one. This also upgrades a persisted or
// hand-built game that predates repetition tracking without guessing at unseen history.
export function seedRepetitions(game) {
  if (!game.repetitions || typeof game.repetitions !== 'object' || Array.isArray(game.repetitions)) {
    game.repetitions = {};
  }
  if (game.cfg?.threefold && Object.keys(game.repetitions).length === 0) {
    game.repetitions[repetitionKey(game)] = 1;
  }
  return game.repetitions;
}

function recordRepetition(game) {
  if (!game.cfg.threefold) return 0;
  const repetitions = seedRepetitions(game);
  const key = repetitionKey(game);
  const count = (Number.isInteger(repetitions[key]) ? repetitions[key] : 0) + 1;
  repetitions[key] = count;
  return count;
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

// Claim every orthogonally connected region sealed off from the board edge by `color`.
// A region may contain neutral and enemy-owned squares; enemy pieces inside are removed.
// Requiring a closed loop avoids treating the vast outside of a single painted island as
// surrounded. Returns a compact event summary for sound, tests, and presentation.
export function captureEnclosures(board, color) {
  const size = board.length;
  const seen = Array.from({ length: size }, () => Array(size).fill(false));
  const inBounds = (r, c) => r >= 0 && r < size && c >= 0 && c < size;
  let regions = 0, squares = 0, pieces = 0;

  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (seen[row][col] || board[row][col].owner === color) continue;
    const region = [];
    const queue = [[row, col]];
    seen[row][col] = true;
    let reachesEdge = false;

    for (let index = 0; index < queue.length; index++) {
      const [r, c] = queue[index];
      region.push([r, c]);
      if (r === 0 || c === 0 || r === size - 1 || c === size - 1) reachesEdge = true;
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc) || seen[nr][nc] || board[nr][nc].owner === color) continue;
        seen[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }

    if (reachesEdge) continue;
    regions++;
    for (const [r, c] of region) {
      const cell = board[r][c];
      cell.owner = color;
      squares++;
      if (cell.piece && cell.piece.color !== color) {
        cell.piece = null;
        pieces++;
      }
    }
  }
  return { regions, squares, pieces };
}

// The scoreboard metric for the active variant.
export function result(game) {
  if (game.cfg.territory) { const s = scoreOf(game.board); return { B: s.B, R: s.R, open: s.open, metric: 'squares' }; }
  const p = pieceCounts(game.board); return { B: p.B, R: p.R, open: 0, metric: 'pieces' };
}

const canCap = (att, def, capture) => capture === 'chess' ? true : BEATS[att.type] === def.type;

// Resolve the piece removed by a move without mutating the board. Most captures land
// on their target. Checkers captures instead make an exact two-square orthogonal leap
// onto an empty square and remove the intervening enemy.
export function captureTarget(board, m, cfg) {
  const moving = board[m.fr]?.[m.fc]?.piece;
  const landing = board[m.tr]?.[m.tc];
  if (!moving || !landing) return null;
  if (cfg.capture === 'checkers') {
    const dr = m.tr - m.fr, dc = m.tc - m.fc;
    const isLeap = (Math.abs(dr) === 2 && dc === 0) || (Math.abs(dc) === 2 && dr === 0);
    if (!isLeap || landing.piece) return null;
    const row = m.fr + dr / 2, col = m.fc + dc / 2;
    const piece = board[row][col].piece;
    return piece && piece.color !== moving.color ? { row, col, piece } : null;
  }
  const piece = landing.piece;
  return piece && piece.color !== moving.color && canCap(moving, piece, cfg.capture)
    ? { row: m.tr, col: m.tc, piece }
    : null;
}

// Landing rule: with territory & no re-tread you may only stop on an UNCLAIMED empty
// square (or capture) — sliders glide over painted squares. Otherwise any empty square
// is a valid stop (classic chess movement). Pieces always block a slide.
export function legalDest(board, r, c, cfg) {
  const p = board[r][c].piece;
  if (!p) return [];
  const S = board.length, inB = (a, b) => a >= 0 && a < S && b >= 0 && b < S, out = [];
  const pat = pattern(p.type, cfg);
  const freeLand = cfg.retread || !cfg.territory;
  if (cfg.capture === 'checkers') {
    for (const [dr, dc] of pat.dirs) {
      const nr = r + dr, nc = c + dc;
      if (!inB(nr, nc)) continue;
      const isLeap = (Math.abs(dr) === 2 && dc === 0) || (Math.abs(dc) === 2 && dr === 0);
      if (isLeap) {
        if (captureTarget(board, { fr: r, fc: c, tr: nr, tc: nc }, cfg)) out.push([nr, nc]);
        continue;
      }
      const cell = board[nr][nc];
      if (!cell.piece && (freeLand || cell.owner === null)) out.push([nr, nc]);
    }
    return out;
  }
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

// Whether a capture remains possible for anyone, judged on surviving piece types rather than
// geometry: under RPS rules, rocks facing only rocks can never take each other however they
// move. This is what ends a Standard game — not an immediate "nothing is en prise", which
// would be true on move one.
export function capturesPossible(board, cfg) {
  const types = { [BLUE]: new Set(), [RED]: new Set() };
  for (const row of board) for (const cell of row) if (cell.piece) types[cell.piece.color].add(cell.piece.type);
  if (!types[BLUE].size || !types[RED].size) return false;
  if (cfg.capture === 'chess' || cfg.capture === 'checkers') return true;
  for (const type of types[BLUE]) if (types[RED].has(BEATS[type])) return true;
  for (const type of types[RED]) if (types[BLUE].has(BEATS[type])) return true;
  return false;
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
  if (cfg.territory && cfg.enclosure) {
    const score = scoreOf(game.board);
    if (score.B > cfg.size * cfg.size / 2 || score.R > cfg.size * cfg.size / 2) return 'majority';
  }
  if (pieces.B === 0 || pieces.R === 0) return 'elimination';
  // Without painting there is nothing left to contest once no capture can ever occur.
  if (!cfg.territory && !capturesPossible(game.board, cfg)) return 'nocaptures';
  if (cfg.territory) {
    if (scoreOf(game.board).open === 0) return 'territory';
  }
  // A player who cannot move can no longer contest the board, so the game ends immediately
  // rather than letting the mobile side keep painting/capturing against a locked-out opponent.
  if (!hasMove(game.board, BLUE, cfg) || !hasMove(game.board, RED, cfg)) return 'immobilization';
  if (cfg.threefold && (game.repetitions?.[repetitionKey(game)] || 0) >= 3) return 'repetition';
  if (game.dry >= Math.max(60, cfg.size * cfg.size)) return 'stall';
  return null;
}

function endNow(game) {
  const reason = terminalReason(game);
  if (!reason) return false;
  game.endReason = game.endReason || reason;
  if (reason === 'repetition') game.winner = null;
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
  if (cfg.threefold) seedRepetitions(game);
  const target = captureTarget(b, m, cfg);
  const captured = target?.piece || null;
  const cap = !!captured;
  let claimedNeutral = cfg.territory && !cap && b[m.tr][m.tc].owner === null;
  b[m.fr][m.fc].piece = null;
  if (target && (target.row !== m.tr || target.col !== m.tc)) {
    b[target.row][target.col].piece = null;
  }
  if (cfg.territory && cfg.trail && pattern(p.type, cfg).slide) {
    // Ink trail: a slide paints the unclaimed squares it glides over (never repaints).
    const dr = Math.sign(m.tr - m.fr), dc = Math.sign(m.tc - m.fc);
    for (let r = m.fr + dr, c = m.fc + dc; r !== m.tr || c !== m.tc; r += dr, c += dc) {
      if (b[r][c].owner === null) { b[r][c].owner = p.color; claimedNeutral = true; }
    }
  }
  b[m.tr][m.tc] = { owner: cfg.territory ? p.color : b[m.tr][m.tc].owner, piece: p };
  const enclosed = cfg.territory && cfg.enclosure
    ? captureEnclosures(b, p.color)
    : { regions: 0, squares: 0, pieces: 0 };
  game.lastMove = { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc };
  game.moves.push({
    c: p.color,
    piece: p.type,
    from: [m.fr, m.fc],
    to: [m.tr, m.tc],
    capture: captured ? captured.type : null,
    enclosed: enclosed.pieces,
    t: `${LETTER[p.type]} ${sqName(m.fr, m.fc, b.length)}${cap ? '×' : '–'}${sqName(m.tr, m.tc, b.length)}`,
  });
  game.passStreak = 0;
  game.dry = (cap || claimedNeutral || enclosed.squares) ? 0 : (game.dry + 1);
  game.acts = (game.acts || 0) + 1;
  if (endNow(game)) { game.gameOver = true; return cap || enclosed.pieces > 0; }
  const N = cfg.actionsPerTurn || 1;
  if (game.acts >= N || !hasMove(game.board, p.color, cfg)) {
    game.turn = other(p.color);
    resolveTurn(game);
  }
  if (!game.gameOver && cfg.threefold) {
    recordRepetition(game);
    if (endNow(game)) game.gameOver = true;
  }
  return cap || enclosed.pieces > 0;
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
    repetitions: {},
    cfg,
  };
  resolveTurn(g);
  seedRepetitions(g);
  return g;
}

// Rebuild the visible position after every recorded action. Online spectators,
// the replay theatre, and exports all receive the same compact start layers and
// move coordinates, so this keeps historical boards grounded in engine legality.
export function replayFrames(record) {
  const cfg = sanitizeCfg(record?.cfg);
  const pieces = decodePos(record?.startPos || record?.pos, cfg.size);
  const board = pieces && decodeOwners(record?.startOwners || record?.own, pieces);
  if (!board) throw new Error('The game does not contain a replayable starting position');
  const game = newGame(cfg, board);
  const frames = [{ board: cloneBoard(game.board), lastMove: null }];

  for (const recorded of record.moves || []) {
    const move = {
      fr: recorded.from?.[0],
      fc: recorded.from?.[1],
      tr: recorded.to?.[0],
      tc: recorded.to?.[1],
    };
    const source = game.board[move.fr]?.[move.fc]?.piece;
    if (game.gameOver
      || (recorded.c && recorded.c !== game.turn)
      || (recorded.piece && recorded.piece !== source?.type)
      || !isLegal(game.board, move, game.turn, cfg)) {
      throw new Error('The game contains an illegal replay move');
    }
    applyMove(game, move);
    frames.push({
      board: cloneBoard(game.board),
      lastMove: game.lastMove ? { ...game.lastMove } : null,
    });
  }
  return frames;
}

export const PRESETS = {
  standard: {
    size: 9, perType: 2, rockMove: 'king', paperMove: 'king', scissorsMove: 'king',
    moveStyle: 'kings', capture: 'rps', territory: false, retread: false, trail: false, enclosure: false,
    threefold: true, layout: 'rows', actionsPerTurn: 1, first: BLUE,
  },
  kings: {
    size: 9, perType: 2, rockMove: 'rook', paperMove: 'knight', scissorsMove: 'bishop',
    moveStyle: 'custom', capture: 'rps', territory: false, retread: false, trail: false, enclosure: false,
    threefold: true, layout: 'rows', actionsPerTurn: 1, first: BLUE,
  },
  checkers: {
    size: 8, perType: 2, rockMove: 'longking', paperMove: 'longking', scissorsMove: 'longking',
    moveStyle: 'custom', capture: 'checkers', territory: false, retread: false, trail: false, enclosure: false,
    threefold: true, layout: 'rows', actionsPerTurn: 1, first: BLUE,
  },
  painters: {
    size: 9, perType: 2, rockMove: 'queen', paperMove: 'queen', scissorsMove: 'queen',
    moveStyle: 'queens', capture: 'rps', territory: true, retread: false, trail: true, enclosure: false,
    threefold: true, layout: 'rows', actionsPerTurn: 1, first: BLUE,
  },
  // Every preset spells out every compared field, so presetOf() can recognise one
  // exactly. Standard's values are the base; each variant states only what it changes.
  ...Object.fromEntries(Object.entries({
    // Skirmish is the one pocket board small enough to solve exactly, so it plays the
    // unpainted game: elimination, with threefold as the only repetition rule.
    skirmish: { size: 3, perType: 1, territory: false, retread: false },
    triple: { actionsPerTurn: 3 },
    cavalry: { rockMove: 'knight', paperMove: 'knight', scissorsMove: 'knight' },
    ambush: { layout: 'scattered' },
    siege: { layout: 'corners', retread: false },
    expanse: { size: 13, perType: 4 },
    melee: { enclosure: true },
  }).map(([key, over]) => [key, {
    size: 9, perType: 2, rockMove: 'king', paperMove: 'king', scissorsMove: 'king',
    capture: 'rps', territory: true, retread: true, trail: false, enclosure: false,
    threefold: true, layout: 'rows', actionsPerTurn: 1, first: BLUE, ...over,
  }])),
};

// Display order and flavour for the variant picker. Every PRESETS key appears here.
export const PRESET_INFO = {
  standard: { label: 'Standard', tagline: 'Everything moves one square. Take what you beat; most pieces standing wins.' },
  skirmish: { label: 'Skirmish', tagline: 'A pocket 3×3 with one of each piece. Decided in a hurry.' },
  triple: { label: 'Triple step', tagline: 'Three moves a turn. Ground changes hands three times as fast.' },
  cavalry: { label: 'Cavalry', tagline: 'All knights. Nothing blocks a jump, so nothing is ever safe.' },
  painters: { label: 'Painters', tagline: 'Queens that ink every unclaimed square they glide across.' },
  ambush: { label: 'Ambush', tagline: 'Both armies scattered at random across their own half.' },
  siege: { label: 'Siege', tagline: 'A corner stand-off with no stepping back — only fresh ground counts.' },
  expanse: { label: 'Expanse', tagline: '13×13 with four of each. A long, patient campaign.' },
  kings: { label: "King's field", tagline: 'Rook, knight, bishop. No painting — take the last piece standing.' },
  checkers: { label: 'Checkers', tagline: 'Step one square, or leap over an enemy to take it. Every piece is a long king.' },
  melee: { label: 'Melee', tagline: 'Close territory loops to swallow whole regions. First past half wins.' },
  custom: { label: 'Custom', tagline: 'Your rules. Every dial below is yours to turn.' },
};
export const PRESET_KEYS = Object.keys(PRESET_INFO);
export const presetLabel = (key) => PRESET_INFO[key]?.label || 'Custom';
// Which preset (if any) a cfg currently matches, else 'custom'.
export function presetOf(cfg) {
  const safe = sanitizeCfg(cfg);
  const fields = [
    'size', 'perType', 'rockMove', 'paperMove', 'scissorsMove', 'capture',
    'territory', 'retread', 'trail', 'enclosure', 'threefold', 'layout', 'actionsPerTurn', 'first',
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
  const capture = safe.capture === 'rps'
    ? 'RPS'
    : safe.capture === 'checkers' ? 'checkers-capture' : 'chess-capture';
  const parts = [`${safe.size}×${safe.size}`, movementLabel(safe), capture];
  parts.push(safe.territory ? (safe.retread ? 'territory+' : 'territory') : 'elimination');
  if (safe.trail) parts.push('ink');
  if (safe.enclosure) parts.push('enclosure');
  if (!safe.threefold) parts.push('no 3-fold');
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
// The whole game, stated as briefly as it can be stated, for exactly these rules — used by
// the in-game rules flap and the how-to-play dialog, so a player is never told about a
// variant they are not playing.
export function rulesSummary(cfg) {
  const safe = sanitizeCfg(cfg);
  const n = safe.perType, s = n === 1 ? '' : 's';
  const moves = ['rock', 'paper', 'scissors'].map((type) => movementFor(safe, type));
  const slides = moves.some((move) => MOVEMENT_PATTERNS[move].slide);
  const jumps = moves.some((move) => move === 'knight' || move === 'longking');
  const out = [{
    h: 'Board',
    p: `${safe.size}×${safe.size}. ${n} rock${s}, ${n} paper${s} and ${n} scissors a side, `
      + `in ${LAYOUT_PROSE[safe.layout]}. ${safe.first === BLUE ? 'Blue' : 'Red'} opens.`,
  }, {
    h: 'Moving',
    // One line when all three share an archetype, otherwise one clause each.
    p: (moves.every((move) => move === moves[0])
      ? `Every piece ${MOVEMENT_SENTENCES[moves[0]]}.`
      : `${moves.map((move, i) => `${PIECE_WORDS[['rock', 'paper', 'scissors'][i]]} ${MOVEMENT_SENTENCES[move]}`).join('; ')}.`)
      + (slides ? ' Slides stop at the first piece in the way.' : '')
      + (jumps
        ? safe.capture === 'checkers'
          ? ' A two-square leap is legal only when it captures the enemy in between.'
          : ' Jumps ignore whatever they pass over.'
        : ''),
  }, {
    h: 'Capturing',
    p: safe.capture === 'rps'
      ? 'Take only what you beat — rock takes scissors, scissors takes paper, paper takes rock. Anything else blocks you.'
      : safe.capture === 'checkers'
        ? 'Leap exactly two squares straight over an adjacent enemy onto an empty square to take it. Ordinary moves cannot capture.'
        : 'Take any enemy piece. The RPS cycle is off.',
  }];
  if (safe.territory) {
    out.push({
      h: 'Painting',
      p: `Landing on a square paints it yours, for good. ${safe.retread
        ? 'Painted squares can be landed on again.'
        : 'Only unclaimed squares can be landed on — painted ones are glided over.'}`
        + (safe.trail ? ' Sliders ink every unclaimed square they cross.' : ''),
    });
    if (safe.enclosure) {
      out.push({
        h: 'Enclosure',
        p: 'Close a loop of your territory around a region. Every square inside becomes yours and enemy pieces there are removed.',
      });
    }
    out.push({
      h: 'Winning',
      p: safe.enclosure
        ? 'First to own more than half the board wins. Elimination, immobilization and the no-progress guard remain backstops.'
        : 'Most squares wins, counted when the board fills, a side runs out of pieces, or a side cannot move.',
    });
  } else {
    out.push({
      h: 'Winning',
      p: 'Take every enemy piece, or hold the most when no capture is possible any more.',
    });
  }
  if (safe.actionsPerTurn > 1) {
    out.push({ h: 'Turns', p: `${safe.actionsPerTurn} moves per turn, with any of your pieces.` });
  }
  if (safe.threefold) {
    out.push({
      h: 'Repetition',
      p: 'The third occurrence of the same position is a draw. Side to move and the action within a multi-action turn must also match.',
    });
  }
  return out;
}

// Clamp an untrusted config to safe ranges (server-side guard against abuse).
export function sanitizeCfg(raw) {
  raw = raw || {};
  const clamp = (v, lo, hi, d) => {
    v = Math.floor(+v);
    return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : d));
  };
  const one = (v, set, d) => set.includes(v) ? v : d;
  const size = clamp(raw.size, 3, 13, 9);
  const layout = one(raw.layout, ['rows', 'corners', 'scattered'], 'rows');
  // Territory is opt-in: an absent flag means Standard, which does not paint.
  const territory = !!raw.territory;
  const legacy = LEGACY_MOVES[raw.moveStyle] || LEGACY_MOVES.kings;
  const capture = one(raw.capture, ['rps', 'chess', 'checkers'], 'rps');
  // Checkers capture is a child of the long-king movement set: imported configs,
  // network rooms and custom games all receive a usable leap, not a dead rule.
  const rockMove = capture === 'checkers' ? 'longking' : one(raw.rockMove, MOVEMENT_TYPES, legacy.rock);
  const paperMove = capture === 'checkers' ? 'longking' : one(raw.paperMove, MOVEMENT_TYPES, legacy.paper);
  const scissorsMove = capture === 'checkers' ? 'longking' : one(raw.scissorsMove, MOVEMENT_TYPES, legacy.scissors);
  const moveStyle = rockMove === 'king' && paperMove === 'king' && scissorsMove === 'king'
    ? 'kings'
    : rockMove === 'queen' && paperMove === 'queen' && scissorsMove === 'queen'
      ? 'queens'
      : rockMove === 'king' && paperMove === 'rook' && scissorsMove === 'bishop'
        ? 'classic'
        : 'custom';
  return {
    size,
    perType: clamp(raw.perType, 1, maxPerTypeForBoard(size, layout), 2),
    rockMove,
    paperMove,
    scissorsMove,
    moveStyle,
    capture,
    territory,
    retread: territory && raw.retread !== false,
    trail: territory && !!raw.trail,
    enclosure: territory && !!raw.enclosure,
    threefold: raw.threefold !== false,
    layout,
    actionsPerTurn: clamp(raw.actionsPerTurn, 1, 3, 1),
    first: raw.first === RED ? RED : BLUE,
  };
}
