// Retrograde solver for the 7-cell Hexagonal Tablebase (Radius 2, 1R/1P/1S each).
// Solves all 75,266 directed states and outputs public/tablebase/hex-7.tb and hex-manifest.json.
// Run with: node scripts/solve-hex.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HexTopology } from '../public/topology.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'tablebase');
mkdirSync(OUT, { recursive: true });

const topo = new HexTopology(2);
const CELLS = topo.cells(); // 7 cells: [q, r]
const CELL_COUNT = CELLS.length; // 7

const BLUE = 0, RED = 1;
const PIECES = [
  { color: BLUE, type: 'rock' },
  { color: BLUE, type: 'paper' },
  { color: BLUE, type: 'scissors' },
  { color: RED, type: 'rock' },
  { color: RED, type: 'paper' },
  { color: RED, type: 'scissors' },
];

const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

// Base 8 addressing over 6 pieces: digit 0 = captured (-1), digit 1..7 = cell index 0..6
const KEY_SPACE = 8 ** 6; // 262,144

function keyOf(pos) {
  let key = 0, mul = 1;
  for (let i = 0; i < 6; i++) {
    key += (pos[i] + 1) * mul;
    mul *= 8;
  }
  return key;
}

function posOfKey(key) {
  const pos = [-1, -1, -1, -1, -1, -1];
  let k = key;
  for (let i = 0; i < 6; i++) {
    pos[i] = (k % 8) - 1;
    k = Math.floor(k / 8);
  }
  return pos;
}

// ── 1. Enumerate distinguishable placements ──────────────────────────────────
console.log('Enumerating 7-cell hex placements...');
const PLACEMENTS = 37633;
const STATES = PLACEMENTS * 2;
const index = new Int32Array(KEY_SPACE).fill(-1);
const keys = new Int32Array(PLACEMENTS);
let count = 0;

const pos = [-1, -1, -1, -1, -1, -1];
function walk(slot, used) {
  if (slot === 6) {
    const k = keyOf(pos);
    index[k] = count;
    keys[count++] = k;
    return;
  }
  // Option 1: piece is captured
  pos[slot] = -1;
  walk(slot + 1, used);

  // Option 2: piece stands on an empty cell
  for (let c = 0; c < CELL_COUNT; c++) {
    if (used & (1 << c)) continue;
    pos[slot] = c;
    walk(slot + 1, used | (1 << c));
  }
}
walk(0, 0);

console.log(`Discovered ${count} placements -> ${count * 2} directed states.`);

// Precompute cell neighbours under King moves (edge + diagonal rays)
const destsOf = Array.from({ length: CELL_COUNT }, (_, c) => {
  const cell = CELLS[c];
  const rays = topo.rays(cell, 'king');
  const list = [];
  for (const ray of rays) {
    for (const d of ray) {
      const idx = CELLS.findIndex(([q, r]) => q === d[0] && r === d[1]);
      if (idx >= 0) list.push(idx);
    }
  }
  return Int32Array.from(list);
});

// ── 2. Graph Construction & Terminal Classification ──────────────────────────
console.log('Building transition graph and classifying terminals...');
const isTerminal = new Uint8Array(PLACEMENTS);
const terminalVal = new Int8Array(STATES); // 1 = Win for mover, -1 = Loss for mover, 0 = Draw

for (let p = 0; p < PLACEMENTS; p++) {
  const pPos = posOfKey(keys[p]);
  let bCount = 0, rCount = 0;
  const bTypes = [], rTypes = [];
  for (let i = 0; i < 3; i++) {
    if (pPos[i] >= 0) { bCount++; bTypes.push(PIECES[i].type); }
  }
  for (let i = 3; i < 6; i++) {
    if (pPos[i] >= 0) { rCount++; rTypes.push(PIECES[i].type); }
  }

  // Elimination check
  if (bCount === 0 || rCount === 0) {
    isTerminal[p] = 1;
    for (const turn of [BLUE, RED]) {
      const s = p * 2 + turn;
      if (bCount === 0 && rCount === 0) terminalVal[s] = 0;
      else if (bCount === 0) terminalVal[s] = turn === BLUE ? -1 : 1;
      else terminalVal[s] = turn === RED ? -1 : 1;
    }
    continue;
  }

  // Deadlock check: can any capture happen?
  let canCap = false;
  for (const bt of bTypes) {
    if (rTypes.includes(BEATS[bt])) { canCap = true; break; }
  }
  if (!canCap) {
    for (const rt of rTypes) {
      if (bTypes.includes(BEATS[rt])) { canCap = true; break; }
    }
  }

  if (!canCap) {
    isTerminal[p] = 1;
    for (const turn of [BLUE, RED]) {
      const s = p * 2 + turn;
      if (bCount > rCount) terminalVal[s] = turn === BLUE ? 1 : -1;
      else if (rCount > bCount) terminalVal[s] = turn === RED ? 1 : -1;
      else terminalVal[s] = 0; // draw
    }
  }
}

// Generate transitions
const offsets = new Int32Array(STATES + 1);
const edges = [];

for (let s = 0; s < STATES; s++) {
  offsets[s] = edges.length;
  const placement = s >> 1;
  if (isTerminal[placement]) continue;

  const turn = s & 1; // 0 = BLUE, 1 = RED
  const pPos = posOfKey(keys[placement]);

  const startSlot = turn === BLUE ? 0 : 3;
  const endSlot = turn === BLUE ? 3 : 6;
  const oppStart = turn === BLUE ? 3 : 0;
  const oppEnd = turn === BLUE ? 6 : 3;

  // Board occupancy map: cell index -> piece slot
  const cellOccupant = new Int8Array(CELL_COUNT).fill(-1);
  for (let i = 0; i < 6; i++) {
    if (pPos[i] >= 0) cellOccupant[pPos[i]] = i;
  }

  let movesFound = 0;
  for (let slot = startSlot; slot < endSlot; slot++) {
    const srcCell = pPos[slot];
    if (srcCell < 0) continue; // captured

    const myType = PIECES[slot].type;
    const dests = destsOf[srcCell];

    for (let d = 0; d < dests.length; d++) {
      const dstCell = dests[d];
      const occ = cellOccupant[dstCell];

      if (occ >= startSlot && occ < endSlot) {
        // Friendly piece -> blocked
        continue;
      }

      if (occ >= oppStart && occ < oppEnd) {
        // Enemy piece -> check if we beat it
        const enemyType = PIECES[occ].type;
        if (BEATS[myType] !== enemyType) {
          // Cannot capture -> blocked
          continue;
        }
        // Capture! Enemy is removed
        const nextPos = pPos.slice();
        nextPos[slot] = dstCell;
        nextPos[occ] = -1; // captured
        const childP = index[keyOf(nextPos)];
        edges.push(childP * 2 + (turn ^ 1));
        movesFound++;
      } else {
        // Empty destination -> legal step
        const nextPos = pPos.slice();
        nextPos[slot] = dstCell;
        const childP = index[keyOf(nextPos)];
        edges.push(childP * 2 + (turn ^ 1));
        movesFound++;
      }
    }
  }

  // If no legal moves exist -> immobilization loss
  if (movesFound === 0) {
    terminalVal[s] = -1;
  }
}
offsets[STATES] = edges.length;
const succ = Int32Array.from(edges);
console.log(`Generated ${edges.length} total transitions.`);

// ── 3. Retrograde Solving (Minimax Attractor Analysis) ───────────────────────
console.log('Running retrograde solve with bucket queue DTM...');
const value = new Int8Array(STATES).fill(2); // 2 = unassigned, 1 = Win, -1 = Loss, 0 = Draw
const dtm = new Uint8Array(STATES);
const remaining = new Int32Array(STATES);
const longest = new Int32Array(STATES);

for (let s = 0; s < STATES; s++) remaining[s] = offsets[s + 1] - offsets[s];

// Build predecessor graph
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
const pushBucket = (depth, s) => {
  while (buckets.length <= depth) buckets.push([]);
  buckets[depth].push(s);
};

// Seed terminal states
let resolvedCount = 0;
for (let s = 0; s < STATES; s++) {
  const p = s >> 1;
  if (isTerminal[p] || remaining[s] === 0) {
    const v = terminalVal[s];
    if (v === -1) {
      value[s] = -1;
      dtm[s] = 0;
      pushBucket(0, s);
      resolvedCount++;
    } else if (v === 1) {
      value[s] = 1;
      dtm[s] = 0;
      // Immediate win terminal
      resolvedCount++;
    } else if (v === 0) {
      value[s] = 0;
      dtm[s] = 0;
      resolvedCount++;
    }
  }
}

let currentDtm = 0;
while (currentDtm < buckets.length) {
  const q = buckets[currentDtm];
  if (!q || !q.length) {
    currentDtm++;
    continue;
  }
  const s = q.pop();
  const v = value[s];
  const d = dtm[s];

  if (v === -1) {
    // Loss for mover in s -> ANY predecessor that can reach s wins in d + 1!
    for (let pIdx = predOffsets[s]; pIdx < predOffsets[s + 1]; pIdx++) {
      const p = pred[pIdx];
      if (value[p] === 2) {
        value[p] = 1;
        dtm[p] = d + 1;
        pushBucket(d + 1, p);
        resolvedCount++;
      }
    }
  } else if (v === 1) {
    // Win for mover in s -> ALL successors of predecessor must be wins for it to lose
    for (let pIdx = predOffsets[s]; pIdx < predOffsets[s + 1]; pIdx++) {
      const p = pred[pIdx];
      if (value[p] === 2) {
        if (d > longest[p]) longest[p] = d;
        remaining[p]--;
        if (remaining[p] === 0) {
          value[p] = -1;
          dtm[p] = longest[p] + 1;
          pushBucket(longest[p] + 1, p);
          resolvedCount++;
        }
      }
    }
  }
}

// Any state still unassigned (value === 2) is a draw by threefold repetition attractor cycle!
let wins = 0, losses = 0, draws = 0;
for (let s = 0; s < STATES; s++) {
  if (value[s] === 2) {
    value[s] = 0;
    dtm[s] = 0;
  }
  if (value[s] === 1) wins++;
  else if (value[s] === -1) losses++;
  else draws++;
}

console.log(`Solved complete 7-cell tablebase:`);
console.log(`  Wins:   ${wins} (${((wins / STATES) * 100).toFixed(2)}%)`);
console.log(`  Losses: ${losses} (${((losses / STATES) * 100).toFixed(2)}%)`);
console.log(`  Draws:  ${draws} (${((draws / STATES) * 100).toFixed(2)}%)`);

// Max DTM
let maxDtm = 0;
for (let s = 0; s < STATES; s++) {
  if (dtm[s] > maxDtm) maxDtm = dtm[s];
}
console.log(`  Max DTM: ${maxDtm} plies`);

// ── 4. Pack and Write Artifacts ──────────────────────────────────────────────
// Entry packing: value (-1, 0, 1) + DTM (0..127)
// Win: 0x80 | DTM, Loss: 0x40 | DTM, Draw: 0x00
function packEntry(v, d) {
  if (v === 1) return 0x80 | (d & 0x3f);
  if (v === -1) return 0x40 | (d & 0x3f);
  return 0;
}

const packed0 = new Uint8Array(PLACEMENTS);
const packed1 = new Uint8Array(PLACEMENTS);
for (let p = 0; p < PLACEMENTS; p++) {
  packed0[p] = packEntry(value[p * 2 + BLUE], dtm[p * 2 + BLUE]);
  packed1[p] = packEntry(value[p * 2 + RED], dtm[p * 2 + RED]);
}

const file0 = join(OUT, 'hex-7-turn0.tb');
const file1 = join(OUT, 'hex-7-turn1.tb');
writeFileSync(file0, packed0);
writeFileSync(file1, packed1);
console.log(`Wrote ${file0} (${packed0.length} bytes)`);
console.log(`Wrote ${file1} (${packed1.length} bytes)`);

// Write Manifest
const manifest = {
  topology: 'hex',
  radius: 2,
  cellCount: 7,
  cells: CELLS,
  pieces: PIECES,
  keySpace: KEY_SPACE,
  placements: PLACEMENTS,
  states: STATES,
  results: {
    wins,
    losses,
    draws,
    maxDtm,
    winPct: ((wins / STATES) * 100).toFixed(2),
    drawPct: ((draws / STATES) * 100).toFixed(2),
    lossPct: ((losses / STATES) * 100).toFixed(2),
  },
  files: {
    turn0: 'hex-7-turn0.tb',
    turn1: 'hex-7-turn1.tb',
  },
};
const manifestFile = join(OUT, 'hex-manifest.json');
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifestFile}`);
