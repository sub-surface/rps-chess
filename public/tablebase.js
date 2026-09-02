// Shared tablebase addressing and artifact decoding, imported unchanged by the browser and by
// scripts/tablebase.mjs. The generator and the page must agree on exactly one thing — which
// slot in the artifact a position occupies — so that agreement lives here and nowhere else.
//
// The solved game is the 3×3 board with one piece of each type a side: the Skirmish preset.
// Six labelled pieces, each either captured or on a distinct square, gives
//   Σ C(6,k)·P(9,k) = 207,775 placements, doubled by the side to move.
import * as E from './engine.js';
const { BLUE, RED, emptyBoard } = E;

export const SIZE = 3;
export const CELLS = SIZE * SIZE;

// Piece slots in a fixed order. Index i of a placement records where piece i stands.
export const PIECES = [
  { color: BLUE, type: 'rock' }, { color: BLUE, type: 'paper' }, { color: BLUE, type: 'scissors' },
  { color: RED, type: 'rock' }, { color: RED, type: 'paper' }, { color: RED, type: 'scissors' },
];

// A placement addresses itself: base-10 over the six pieces, digit 0 meaning captured and
// 1..9 a square. That spans 10^6 keys for 207,775 live placements — a 4 MB direct-lookup
// table. Addressing by board contents instead would need 7^9 = 40.3M slots for the same data.
export const KEY_SPACE = 1e6;
export const PLACEMENTS = 207775;
export const STATES = PLACEMENTS * 2;

export const keyOf = (positions) => {
  let key = 0, mul = 1;
  for (let i = 0; i < 6; i++) { key += (positions[i] + 1) * mul; mul *= 10; }
  return key;
};

// Where each labelled piece stands, or -1. Returns null if the board cannot be a placement of
// this tablebase — a wrong size, a piece off the roster, or a second copy of one.
export function positionsOf(board) {
  if (!board || board.length !== SIZE) return null;
  const positions = [-1, -1, -1, -1, -1, -1];
  for (let row = 0; row < SIZE; row++) {
    if (board[row].length !== SIZE) return null;
    for (let col = 0; col < SIZE; col++) {
      const piece = board[row][col].piece;
      if (!piece) continue;
      const slot = PIECES.findIndex((p) => p.color === piece.color && p.type === piece.type);
      if (slot < 0 || positions[slot] >= 0) return null;
      positions[slot] = row * SIZE + col;
    }
  }
  return positions;
}

export function boardOf(positions) {
  const board = emptyBoard(SIZE);
  for (let i = 0; i < 6; i++) {
    if (positions[i] < 0) continue;
    const cell = board[(positions[i] / SIZE) | 0][positions[i] % SIZE];
    cell.piece = { type: PIECES[i].type, color: PIECES[i].color };
  }
  return board;
}

// Every placement, in the order the artifact stores them. Recursion order fixes the layout of
// the file, so this function — not the caller — defines it.
export function enumeratePlacements() {
  const index = new Int32Array(KEY_SPACE).fill(-1);
  const keys = new Int32Array(PLACEMENTS);
  const positions = [-1, -1, -1, -1, -1, -1];
  let count = 0;
  const walk = (slot, used) => {
    if (slot === 6) {
      const key = keyOf(positions);
      index[key] = count;
      keys[count++] = key;
      return;
    }
    positions[slot] = -1;
    walk(slot + 1, used);
    for (let square = 0; square < CELLS; square++) {
      if (used & (1 << square)) continue;
      positions[slot] = square;
      walk(slot + 1, used | (1 << square));
    }
    positions[slot] = -1;
  };
  walk(0, 0);
  if (count !== PLACEMENTS) throw new Error(`enumerated ${count} placements, expected ${PLACEMENTS}`);
  return { index, keys };
}

// ── symmetry ─────────────────────────────────────────────────────────────────
// D₄, the eight ways a square board maps onto itself. Every movement archetype JANKEN
// offers is built from a direction set closed under these, so they are symmetries of play
// and not merely of the picture.
export const SQUARE_MAPS = (() => {
  const forms = [
    (x, y) => [x, y], (x, y) => [SIZE - 1 - y, x], (x, y) => [SIZE - 1 - x, SIZE - 1 - y],
    (x, y) => [y, SIZE - 1 - x], (x, y) => [SIZE - 1 - x, y], (x, y) => [x, SIZE - 1 - y],
    (x, y) => [y, x], (x, y) => [SIZE - 1 - y, SIZE - 1 - x],
  ];
  return forms.map((form) => {
    const map = new Int8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = form(i % SIZE, (i / SIZE) | 0);
      map[i] = y * SIZE + x;
    }
    return map;
  });
})();

export const SYMMETRY_LABELS = ['identity', 'rotate 90°', 'rotate 180°', 'rotate 270°',
  'mirror ↔', 'mirror ↕', 'transpose', 'anti-transpose'];

// Reflect or rotate the board, and advance every piece rock→paper→scissors together.
// `spin` is only a symmetry while all three types share a movement archetype: relabelling
// is an automorphism of the RPS cycle, but not of a game where rooks and knights differ.
export function transformPositions(positions, map, spin = 0) {
  const moved = [-1, -1, -1, -1, -1, -1];
  for (let slot = 0; slot < 6; slot++) {
    if (positions[slot] < 0) continue;
    const base = slot < 3 ? 0 : 3;
    moved[base + ((slot - base + spin) % 3)] = map[positions[slot]];
  }
  return moved;
}

// The placements that play identically to this one. Its size is what a single stored value
// really stands for, and it varies: a position fixed by a reflection has a smaller orbit.
export function orbitKeys(positions, spins = 3) {
  const found = new Set();
  for (const map of SQUARE_MAPS) {
    for (let spin = 0; spin < spins; spin++) found.add(keyOf(transformPositions(positions, map, spin)));
  }
  return found;
}

export const positionsFromKey = (key) => {
  const positions = [];
  for (let i = 0; i < 6; i++) { positions.push((key % 10) - 1); key = (key / 10) | 0; }
  return positions;
};

export const stateOf = (placement, turn) => placement * 2 + (turn === RED ? 1 : 0);

// One byte a state: the value in the top two bits, distance-to-mate in the low six.
// DTM is meaningless for a draw and zero for a terminal position.
export const LOSS = 0, DRAW = 1, WIN = 2;
export const DTM_MAX = 63;
export const packEntry = (value, dtm) => (value << 6) | Math.min(DTM_MAX, dtm);
export const valueOf = (entry) => (entry >> 6) - 1;   // -1 loss, 0 draw, 1 win
export const dtmOf = (entry) => entry & DTM_MAX;

// ── runtime oracle ───────────────────────────────────────────────────────────
// One path from a live config to a verdict, used by the atlas, the analysis panel and the perfect
// bot. Everything here is lazy: a 9×9 game must never pay for a 3×3 table, and the placement
// index alone is a 4 MB array. `oracleFor()` returning null is the normal answer for most games
// and is not an error — it means the shipped tables say nothing about these rules.
const ROOT = '/tablebase';
const tables = new Map();
let manifestPromise = null;
let placementTable = null;

// The placement index and key list, built once on first use. It is a 4 MB Int32Array, so nothing
// that never probes a 3×3 position should ever construct it.
export const placements = () => (placementTable ||= enumeratePlacements());

export const manifest = () => (manifestPromise ||= fetch(`${ROOT}/manifest.json`)
  .then((response) => {
    if (!response.ok) throw new Error(`could not load the tablebase manifest (${response.status})`);
    return response.json();
  })
  .catch((error) => { manifestPromise = null; throw error; }));

// Artifacts are gzip on the wire and a flat byte array in memory: 406 KB decompressed each, so
// they load on demand and stay cached rather than shipping all seven upfront.
export async function loadTable(id) {
  if (tables.has(id)) return tables.get(id);
  const response = await fetch(`${ROOT}/${id}.tb`);
  if (!response.ok) throw new Error(`could not load the ${id} tablebase`);
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (bytes.length !== STATES) throw new Error(`${id} tablebase is ${bytes.length} bytes, expected ${STATES}`);
  tables.set(id, bytes);
  return bytes;
}

// The manifest carries each solved variant's exact sanitized config, so recognition compares
// fields rather than guessing from an archetype name. Comparing the manifest's keys — not the live
// config's — means a config that grows a new field still matches until the tables are regenerated,
// which is the same tolerance `presetOf()` deliberately does not have.
export function variantForCfg(list, cfg) {
  const live = E.sanitizeCfg(cfg);
  return (list || []).find((variant) => Object.entries(variant.cfg)
    .every(([field, value]) => live[field] === value)) || null;
}

// A loaded oracle for these rules, or null if they are not solved. Callers hold the result.
export async function oracleFor(cfg) {
  const safe = E.sanitizeCfg(cfg);
  if (safe.topology === 'hex') {
    if (safe.size !== HEX_RADIUS || safe.perType !== 1 || safe.capture !== 'rps') return null;
    return loadHexOracle();
  }
  if (safe.size !== SIZE) return null;      // cheap reject before any network
  const list = (await manifest()).variants;
  const variant = variantForCfg(list, cfg);
  if (!variant) return null;
  return { id: variant.id, label: variant.label, table: await loadTable(variant.id), variant };
}

export const placementOf = (board) => {
  const positions = positionsOf(board);
  return positions ? placements().index[keyOf(positions)] : -1;
};

// A verdict from the side to move's point of view: 1 win, 0 draw, -1 loss. DTM is plies to the
// end of the game under best play, and is meaningless for a draw.
export function probe(table, board, turn) {
  const placement = table ? placementOf(board) : -1;
  if (placement < 0) return null;
  const entry = table[stateOf(placement, turn)];
  return { value: valueOf(entry), dtm: dtmOf(entry), placement };
}

const applyOn = (board, move, cfg, turn) => {
  const next = E.cloneBoard(board);
  E.applyMove({
    board: next, cfg, moves: [], repetitions: {}, dry: 0, acts: 0,
    turn, passStreak: 0, gameOver: false, endReason: null,
  }, move);
  return next;
};

// Every legal move with the position it creates already evaluated. A terminal position offers
// none, whatever the geometry allows, which is the judgement the solver made too.
export function movesFrom(table, board, turn, cfg) {
  if (E.terminalReason({ board, cfg, repetitions: {}, dry: 0 })) return [];
  return E.allMoves(board, turn, cfg).map((move) => {
    const piece = board[move.fr][move.fc].piece;
    const captured = E.captureTarget(board, move, cfg)?.piece || null;
    const next = applyOn(board, move, cfg, turn);
    return { ...move, piece, captured, board: next, after: probe(table, next, E.other(turn)) };
  });
}

// The value of a move to the player making it: the opponent's verdict, negated.
export const moverValue = (move) => (move.after ? -move.after.value : 0);

// Best first: win over draw over loss, then finish a win quickly and drag a loss out. Ties keep
// their generated order, so a caller wanting variety picks randomly among the equal leaders
// rather than relying on this being unstable.
export const rankMoves = (list) => list.slice().sort((a, b) => {
  const va = moverValue(a), vb = moverValue(b);
  if (va !== vb) return vb - va;
  if (va === 1) return a.after.dtm - b.after.dtm;
  if (va === -1) return b.after.dtm - a.after.dtm;
  return 0;
});

// Every move that is exactly as good as the best one. Equal value and, when the game is decided,
// equal distance — a slower win is not a top move.
export const topMoves = (ranked) => {
  if (!ranked.length) return [];
  const best = ranked[0], value = moverValue(best);
  return ranked.filter((move) => moverValue(move) === value
    && (value === 0 || move.after.dtm === best.after.dtm));
};

// ── puzzles ──────────────────────────────────────────────────────────────────
// A solved game sets its own exercises and marks them, so a puzzle here is not an engine's
// opinion about a position — it is the table's verdict, and the accepted answers are exactly
// `topMoves`. Lives beside the oracle because the atlas and the home page must pose the same
// puzzle from the same seed, and two copies of this would eventually pose two different ones.
const FNV = 0x01000193;
export const seedFrom = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < String(text).length; i++) hash = Math.imul(hash ^ String(text).charCodeAt(i), FNV) >>> 0;
  return hash || 1;
};
// xorshift32, so the same seed poses the same puzzle in every browser and in the tests.
export const rngFrom = (seed) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
};
// The UTC day, so everyone gets the same daily puzzle regardless of where they are.
export const puzzleDay = (now = new Date()) => now.toISOString().slice(0, 10);

// A won position with a real decision in it. The bounds are the whole design: too shallow and
// there is nothing to see, too deep and it is a lecture; a position where everything wins is not
// a puzzle, and one with a single legal move is not a choice.
export function findPuzzle(table, cfg, random, options = {}) {
  const { minDtm = 3, maxDtm = 11, maxBest = 2, minMoves = 3, tries = 6000 } = options;
  const { keys } = placements();
  if (!table) return null;
  for (let attempt = 0; attempt < tries; attempt++) {
    const placement = (random() * PLACEMENTS) | 0;
    const red = random() < 0.5;
    const entry = table[placement * 2 + (red ? 1 : 0)];
    if (valueOf(entry) !== 1) continue;
    const dtm = dtmOf(entry);
    if (dtm < minDtm || dtm > maxDtm) continue;
    const board = boardOf(positionsFromKey(keys[placement]));
    const turn = red ? RED : BLUE;
    const options_ = rankMoves(movesFrom(table, board, turn, cfg));
    if (options_.length < minMoves) continue;
    const best = topMoves(options_);
    if (best.length > maxBest || best.length === options_.length) continue;
    return { placement, board, turn, dtm, best, legal: options_.length };
  }
  return null;
}

// The one puzzle everybody sees today, for these rules. Same day plus same variant gives the same
// position on the home page and on the atlas, which is what makes the deep link between them work.
export const dailyPuzzle = (table, cfg, variantId, day = puzzleDay()) =>
  findPuzzle(table, cfg, rngFrom(seedFrom(`${day}${variantId}`)));

// ── hex tablebase (radius 2, 7 cells, 1R/1P/1S each) ─────────────────────────
export const HEX_RADIUS = 2;
export const HEX_CELLS = 7;
export const HEX_PLACEMENTS = 37633;
export const HEX_STATES = HEX_PLACEMENTS * 2;
export const HEX_KEY_SPACE = 8 ** 6; // 262,144

export function hexKeyOf(positions) {
  let key = 0, mul = 1;
  for (let i = 0; i < 6; i++) {
    key += (positions[i] + 1) * mul;
    mul *= 8;
  }
  return key;
}

export function hexPositionsFromKey(key) {
  const pos = [-1, -1, -1, -1, -1, -1];
  let k = key;
  for (let i = 0; i < 6; i++) {
    pos[i] = (k % 8) - 1;
    k = Math.floor(k / 8);
  }
  return pos;
}

export function probeHexTable(table, placement, turn = BLUE) {
  if (!table || placement < 0 || placement >= HEX_PLACEMENTS) return null;
  const byte = table[placement];
  const value = (byte & 0x80) ? 1 : ((byte & 0x40) ? -1 : 0);
  const dtm = byte & 0x3f;
  return { value, dtm };
}

export const HEX_CELLS_7 = Object.freeze([
  [0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]);
export const HEX_CELL_INDEX = Object.freeze({
  '0,0': 0, '1,0': 1, '1,-1': 2, '0,-1': 3, '-1,0': 4, '-1,1': 5, '0,1': 6,
});

let hexPlacementTable = null;
export function enumerateHexPlacements() {
  if (hexPlacementTable) return hexPlacementTable;
  const index = new Int32Array(HEX_KEY_SPACE).fill(-1);
  const keys = new Int32Array(HEX_PLACEMENTS);
  let count = 0;
  const pos = [-1, -1, -1, -1, -1, -1];
  function walk(slot, used) {
    if (slot === 6) {
      const k = hexKeyOf(pos);
      index[k] = count;
      keys[count++] = k;
      return;
    }
    pos[slot] = -1;
    walk(slot + 1, used);
    for (let c = 0; c < 7; c++) {
      if (used & (1 << c)) continue;
      pos[slot] = c;
      walk(slot + 1, used | (1 << c));
    }
  }
  walk(0, 0);
  hexPlacementTable = { index, keys };
  return hexPlacementTable;
}

export function hexPlacementOf(pieces) {
  const { index } = enumerateHexPlacements();
  const pos = [-1, -1, -1, -1, -1, -1];
  for (const [coord, p] of Object.entries(pieces || {})) {
    if (!p) continue;
    const cellIdx = HEX_CELL_INDEX[coord];
    if (cellIdx === undefined) continue;
    const base = p.color === BLUE ? 0 : 3;
    const typeOffset = p.type === 'rock' ? 0 : p.type === 'paper' ? 1 : 2;
    pos[base + typeOffset] = cellIdx;
  }
  return index[hexKeyOf(pos)];
}

let hexOraclePromise = null;
export async function loadHexOracle() {
  if (hexOraclePromise) return hexOraclePromise;
  hexOraclePromise = (async () => {
    const [res0, res1] = await Promise.all([
      fetch(`${ROOT}/hex-7-turn0.tb`),
      fetch(`${ROOT}/hex-7-turn1.tb`),
    ]);
    if (!res0.ok || !res1.ok) throw new Error('Could not load hex tablebase');
    const b0 = new Uint8Array(await res0.arrayBuffer());
    const b1 = new Uint8Array(await res1.arrayBuffer());
    const { index, keys } = enumerateHexPlacements();
    return {
      id: 'hex-7',
      label: '7-cell Hex Pocket',
      topology: 'hex',
      turn0: b0,
      turn1: b1,
      index,
      keys,
      variant: { cfg: { topology: 'hex', size: 2, perType: 1, capture: 'rps' } },
    };
  })();
  return hexOraclePromise;
}

export function probeHex(oracle, pieces, turn = BLUE) {
  if (!oracle) return null;
  const placement = hexPlacementOf(pieces);
  if (placement < 0 || placement >= HEX_PLACEMENTS) return null;
  const table = turn === RED ? oracle.turn1 : oracle.turn0;
  const byte = table[placement];
  const value = (byte & 0x80) ? 1 : ((byte & 0x40) ? -1 : 0);
  const dtm = byte & 0x3f;
  return { value, dtm, placement };
}
