// Solves the 3×3 Skirmish board exactly and writes the artifacts the analysis page reads.
//
// The rules come from public/engine.js — the same module the browser and the Durable Object
// play by — so a solved position cannot describe a game JANKEN does not offer. Nothing here
// re-implements movement, capture, or termination; it only enumerates, walks, and counts.
//
//   node scripts/tablebase.mjs            # every variant
//   node scripts/tablebase.mjs king rook  # only the named ones
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as E from '../public/engine.js';
import {
  PLACEMENTS, STATES, CELLS, SIZE,
  enumeratePlacements, positionsFromKey, positionsOf, boardOf, keyOf, packEntry,
} from '../public/tablebase.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'tablebase');

// One variant per movement archetype, every other rule held at the shipped Skirmish preset.
// A uniform archetype is what makes the RPS relabelling C₃ a symmetry of the solved game.
const VARIANTS = E.MOVEMENT_TYPES.map((move) => ({
  id: move,
  label: E.MOVEMENT_LABELS[move],
  cfg: E.sanitizeCfg({
    ...E.PRESETS.skirmish, rockMove: move, paperMove: move, scissorsMove: move,
  }),
}));

// D₄ on the nine squares: the eight ways a 3×3 board maps onto itself.
const SQUARE_MAPS = (() => {
  const maps = [];
  const forms = [
    (x, y) => [x, y], (x, y) => [SIZE - 1 - y, x], (x, y) => [SIZE - 1 - x, SIZE - 1 - y],
    (x, y) => [y, SIZE - 1 - x], (x, y) => [SIZE - 1 - x, y], (x, y) => [x, SIZE - 1 - y],
    (x, y) => [y, x], (x, y) => [SIZE - 1 - y, SIZE - 1 - x],
  ];
  for (const form of forms) {
    const map = new Int8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const [x, y] = form(i % SIZE, (i / SIZE) | 0);
      map[i] = y * SIZE + x;
    }
    maps.push(map);
  }
  return maps;
})();

const { index, keys } = enumeratePlacements();
const placementOf = (board) => {
  const positions = positionsOf(board);
  return positions ? index[keyOf(positions)] : -1;
};

// ── graph ────────────────────────────────────────────────────────────────────
function buildGraph(cfg) {
  const pieceB = new Uint8Array(PLACEMENTS), pieceR = new Uint8Array(PLACEMENTS);
  const isTerminal = new Uint8Array(PLACEMENTS);
  for (let p = 0; p < PLACEMENTS; p++) {
    const board = boardOf(positionsFromKey(keys[p]));
    const counts = E.pieceCounts(board);
    pieceB[p] = counts.B; pieceR[p] = counts.R;
    // terminalReason owns the ordering of the ending conditions. Repetition and the
    // no-progress guard are history-dependent, so a fresh clock keeps them from firing:
    // this is the positional table, exactly as a chess tablebase ignores the 50-move rule.
    isTerminal[p] = E.terminalReason({ board, cfg, repetitions: {}, dry: 0 }) ? 1 : 0;
  }

  // applyMove's repetition bookkeeping only ever writes game.repetitions, never the board,
  // so switching it off here changes the cost of the walk and not a single transition.
  const walkCfg = { ...cfg, threefold: false };
  const offsets = new Int32Array(STATES + 1);
  const edges = [];
  for (let state = 0; state < STATES; state++) {
    offsets[state] = edges.length;
    const placement = state >> 1;
    if (isTerminal[placement]) continue;
    const color = (state & 1) ? E.RED : E.BLUE;
    const board = boardOf(positionsFromKey(keys[placement]));
    for (const move of E.allMoves(board, color, walkCfg)) {
      const next = E.cloneBoard(board);
      E.applyMove({
        board: next, cfg: walkCfg, moves: [], repetitions: {},
        dry: 0, acts: 0, turn: color, passStreak: 0, gameOver: false, endReason: null,
      }, move);
      const child = placementOf(next);
      if (child < 0) throw new Error('a legal move left the enumerated placement set');
      edges.push(child * 2 + ((state & 1) ^ 1));
    }
  }
  offsets[STATES] = edges.length;
  return { pieceB, pieceR, isTerminal, offsets, succ: Int32Array.from(edges) };
}

// ── retrograde solve ─────────────────────────────────────────────────────────
// Standard attractor analysis. A state is won when some move reaches a lost state, lost when
// every move reaches a won one, and drawn when it never resolves — a cycle the winning side
// cannot escape. Distance-to-mate is a bucket queue: wins take the shortest child plus one,
// losses the longest, so the keys only ever move forward and small integer buckets suffice.
function solve({ pieceB, pieceR, offsets, succ }) {
  const value = new Int8Array(STATES).fill(2);
  const dtm = new Uint8Array(STATES);
  const remaining = new Int32Array(STATES);
  const longest = new Int32Array(STATES);
  for (let s = 0; s < STATES; s++) remaining[s] = offsets[s + 1] - offsets[s];

  const inDegree = new Int32Array(STATES);
  for (let e = 0; e < succ.length; e++) inDegree[succ[e]]++;
  const predOffsets = new Int32Array(STATES + 1);
  for (let s = 0; s < STATES; s++) predOffsets[s + 1] = predOffsets[s] + inDegree[s];
  const pred = new Int32Array(succ.length);
  const cursor = predOffsets.slice();
  for (let s = 0; s < STATES; s++) {
    for (let e = offsets[s]; e < offsets[s + 1]; e++) pred[cursor[succ[e]]++] = s;
  }

  const buckets = [];
  const push = (d, s) => { (buckets[d] || (buckets[d] = [])).push(s); };
  let terminals = 0;
  for (let s = 0; s < STATES; s++) {
    if (remaining[s] !== 0) continue;
    terminals++;
    const p = s >> 1, red = s & 1;
    const own = red ? pieceR[p] : pieceB[p], opponent = red ? pieceB[p] : pieceR[p];
    value[s] = own > opponent ? 1 : own < opponent ? -1 : 0;
    if (value[s] !== 0) push(0, s);
  }
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let k = 0; k < bucket.length; k++) {
      const child = bucket[k];
      if (dtm[child] !== d) continue;
      const childValue = value[child];
      for (let i = predOffsets[child]; i < predOffsets[child + 1]; i++) {
        const parent = pred[i];
        if (value[parent] !== 2) continue;
        if (childValue === -1) {
          value[parent] = 1; dtm[parent] = d + 1; push(d + 1, parent);
        } else if (childValue === 1) {
          remaining[parent]--;
          if (d > longest[parent]) longest[parent] = d;
          if (remaining[parent] === 0) {
            value[parent] = -1; dtm[parent] = longest[parent] + 1; push(dtm[parent], parent);
          }
        }
      }
    }
  }
  for (let s = 0; s < STATES; s++) if (value[s] === 2) value[s] = 0;
  return { value, dtm, terminals };
}

// ── audits ───────────────────────────────────────────────────────────────────
// The solve is only worth shipping if it agrees with the engine it came from, so check the
// whole table rather than a sample: every non-terminal value must be the best reply available,
// and the answer must not depend on how the board happens to be oriented or labelled.
function audit({ offsets, succ }, { value, dtm }, cfg) {
  for (let s = 0; s < STATES; s++) {
    if (offsets[s + 1] === offsets[s]) continue;
    let best = -1, bestDtm = 0;
    for (let e = offsets[s]; e < offsets[s + 1]; e++) {
      const reply = -value[succ[e]];
      if (reply > best) { best = reply; bestDtm = dtm[succ[e]]; }
      else if (reply === best && best === 1 && dtm[succ[e]] < bestDtm) bestDtm = dtm[succ[e]];
      else if (reply === best && best === -1 && dtm[succ[e]] > bestDtm) bestDtm = dtm[succ[e]];
    }
    if (best !== value[s]) throw new Error(`state ${s}: value ${value[s]} but best reply is ${best}`);
    if (best !== 0 && dtm[s] !== bestDtm + 1) {
      throw new Error(`state ${s}: dtm ${dtm[s]} but best line is ${bestDtm + 1}`);
    }
  }

  // D₄ × C₃: reflecting or rotating the board, and relabelling rock→paper→scissors on both
  // sides at once, are automorphisms of a uniform-movement game. Values must be blind to them.
  let orbitTotal = 0;
  for (let p = 0; p < PLACEMENTS; p += 37) {
    const positions = positionsFromKey(keys[p]);
    const seen = new Set();
    for (const map of SQUARE_MAPS) {
      for (let spin = 0; spin < 3; spin++) {
        const moved = [-1, -1, -1, -1, -1, -1];
        for (let slot = 0; slot < 6; slot++) {
          if (positions[slot] < 0) continue;
          const base = slot < 3 ? 0 : 3, type = (slot - base + spin) % 3;
          moved[base + type] = map[positions[slot]];
        }
        const twin = index[keyOf(moved)];
        seen.add(twin);
        for (const turn of [0, 1]) {
          if (value[twin * 2 + turn] !== value[p * 2 + turn] || dtm[twin * 2 + turn] !== dtm[p * 2 + turn]) {
            throw new Error(`symmetry broken for placement ${p} under D4×C3 (${cfg.rockMove})`);
          }
        }
      }
    }
    orbitTotal += seen.size;
  }
  return orbitTotal;
}

// ── report data ──────────────────────────────────────────────────────────────
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const PERM_LABELS = PERMS.map((p) => p.map((t) => 'RPS'[t]).join(''));

// The 36 full-material openings: Blue's column against Red's, which on a 3×3 is the whole
// opening book. The shipped Skirmish start is one cell of this table.
function lineups(value) {
  return PERMS.map((blue) => PERMS.map((red) => {
    const positions = [-1, -1, -1, -1, -1, -1];
    for (let row = 0; row < SIZE; row++) {
      positions[blue[row]] = row * SIZE;
      positions[3 + red[row]] = row * SIZE + SIZE - 1;
    }
    return value[index[keyOf(positions)] * 2];
  }));
}

// Every layout JANKEN can deal has 180° rotational symmetry, so Red's army is exactly Blue's
// antipode. That makes these 192 placements the only positions a game can legally begin from —
// a much smaller and more honest family than all 60,480 full-material placements, most of which
// pit armies against each other that no layout would ever produce.
const FAIR_STARTS = (() => {
  const fair = [];
  for (let p = 0; p < PLACEMENTS; p++) {
    const positions = positionsFromKey(keys[p]);
    if (positions.some((square) => square < 0)) continue;
    if ([0, 1, 2].every((slot) => positions[slot + 3] === CELLS - 1 - positions[slot])) fair.push(p);
  }
  return fair;
})();

function startCensus(value) {
  const census = { count: FAIR_STARTS.length, W: 0, D: 0, L: 0 };
  for (const placement of FAIR_STARTS) {
    census[value[placement * 2] === 1 ? 'W' : value[placement * 2] === -1 ? 'L' : 'D']++;
  }
  return census;
}

function layerStats({ pieceB, pieceR }, value) {
  const layers = Array.from({ length: 7 }, (_, m) => ({ m, states: 0, W: 0, D: 0, L: 0 }));
  for (let s = 0; s < STATES; s++) {
    const layer = layers[pieceB[s >> 1] + pieceR[s >> 1]];
    layer.states++;
    layer[value[s] === 1 ? 'W' : value[s] === -1 ? 'L' : 'D']++;
  }
  return layers;
}

// ── run ──────────────────────────────────────────────────────────────────────
const wanted = process.argv.slice(2);
const selected = wanted.length ? VARIANTS.filter((v) => wanted.includes(v.id)) : VARIANTS;
if (!selected.length) {
  console.error(`no such variant. known: ${VARIANTS.map((v) => v.id).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const startBoard = E.blocksBoard(SIZE, 1, 'rows');
const startPlacement = placementOf(startBoard);
const manifest = { size: SIZE, placements: PLACEMENTS, states: STATES, variants: [] };

for (const variant of selected) {
  const started = Date.now();
  process.stdout.write(`${variant.id.padEnd(9)} `);
  const graph = buildGraph(variant.cfg);
  const solved = solve(graph);
  audit(graph, solved, variant.cfg);

  const bytes = new Uint8Array(STATES);
  let W = 0, D = 0, L = 0, maxDtm = 0;
  for (let s = 0; s < STATES; s++) {
    const v = solved.value[s];
    if (v === 1) W++; else if (v === -1) L++; else D++;
    if (v !== 0 && solved.dtm[s] > maxDtm) maxDtm = solved.dtm[s];
    bytes[s] = packEntry(v + 1, solved.dtm[s]);
  }
  const packed = gzipSync(bytes, { level: 9 });
  writeFileSync(join(OUT, `${variant.id}.tb`), packed);

  // A cheap drift guard for the suite: the moves available in the small material layers are
  // fast to rebuild, so a test can recount them and catch generated data that no longer
  // matches the engine it claims to describe.
  let edgesUpToThreePieces = 0;
  for (let s = 0; s < STATES; s++) {
    if (graph.pieceB[s >> 1] + graph.pieceR[s >> 1] <= 3) {
      edgesUpToThreePieces += graph.offsets[s + 1] - graph.offsets[s];
    }
  }

  const start = { value: solved.value[startPlacement * 2], dtm: solved.dtm[startPlacement * 2] };
  manifest.variants.push({
    id: variant.id,
    label: variant.label,
    cfg: variant.cfg,
    rules: E.variantLabel(variant.cfg),
    bytes: packed.length,
    edges: graph.succ.length,
    edgesUpToThreePieces,
    terminals: solved.terminals,
    maxDtm,
    wdl: { W, D, L },
    start,
    fairStarts: startCensus(solved.value),
    layers: layerStats(graph, solved.value),
    lineups: lineups(solved.value),
  });
  const fair = startCensus(solved.value);
  console.log(
    `${(graph.succ.length / 1e6).toFixed(2)}M moves · W ${W} D ${D} L ${L} · dtm≤${maxDtm} · `
    + `fair starts ${fair.W}/${fair.D}/${fair.L} · ${(packed.length / 1024).toFixed(0)} KB · `
    + `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

manifest.permutations = PERM_LABELS;
// Which cell of the 6×6 opening grid the shipped Skirmish layout actually deals.
manifest.startLineup = (() => {
  for (let bi = 0; bi < 6; bi++) for (let ri = 0; ri < 6; ri++) {
    const positions = [-1, -1, -1, -1, -1, -1];
    for (let row = 0; row < SIZE; row++) {
      positions[PERMS[bi][row]] = row * SIZE;
      positions[3 + PERMS[ri][row]] = row * SIZE + SIZE - 1;
    }
    if (index[keyOf(positions)] === startPlacement) return [bi, ri];
  }
  throw new Error('the shipped starting layout is not a column line-up');
})();
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nwrote ${selected.length} variant(s) + manifest.json to public/tablebase/`);
