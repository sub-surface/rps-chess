// Shared tablebase addressing and artifact decoding, imported unchanged by the browser and by
// scripts/tablebase.mjs. The generator and the page must agree on exactly one thing — which
// slot in the artifact a position occupies — so that agreement lives here and nowhere else.
//
// The solved game is the 3×3 board with one piece of each type a side: the Skirmish preset.
// Six labelled pieces, each either captured or on a distinct square, gives
//   Σ C(6,k)·P(9,k) = 207,775 placements, doubled by the side to move.
import { BLUE, RED, emptyBoard } from './engine.js';

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
