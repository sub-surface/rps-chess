// Combinatorics & State Space Playground.
// Pure BigInt integer arithmetic exploring multiset arrangements, layout geometry,
// strata cascades, 3B1B powers-of-ten scale, and Shannon game tree complexity.
import * as E from './engine.js';
import * as L from './lab.js';
import { glyph, PIECE_STYLE_IDS } from './pieces.js';
import { mountFact } from './facts.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-GB');

const prefs = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('janken-cfg') || '{}') || {}; } catch { /* optional */ }
  return {
    pieceStyle: PIECE_STYLE_IDS.includes(saved.pieceStyle) ? saved.pieceStyle : 'sprite',
    coordStyle: E.COORD_STYLES.includes(saved.coordStyle) ? saved.coordStyle : 'chess',
  };
})();

const square = (row, col, size) => E.sqName(row, col, size, prefs.coordStyle);

// ── benchmarks ───────────────────────────────────────────────────────────────
const BENCHMARKS = [
  { name: 'Tic-Tac-Toe', states: 5478n, treeExp: 5, solved: true, note: 'solved by hand' },
  { name: 'Hex Pocket (R=2)', states: 75266n, treeExp: 12, solved: true, note: 'solved tablebase' },
  { name: '3×3 JANKEN', states: 415550n, treeExp: 31, solved: true, note: 'solved tablebase' },
  { name: 'Connect Four', states: 4531985219092n, treeExp: 21, solved: true, note: 'Allis 1988' },
  { name: 'Checkers', states: 500995484682338672639n, treeExp: 31, solved: true, note: 'Schaeffer 2007' },
  { name: 'Chess', states: 10n ** 43n, treeExp: 123, solved: false, note: 'Shannon estimate' },
  { name: 'Go (19×19)', states: 10n ** 170n, treeExp: 360, solved: false, note: 'Tromp 2016' },
];

const PRESETS = {
  '3-skirmish': { size: 3, r: 1, p: 1, s: 1, layout: 'rows' },
  '5-azel': { size: 5, r: 2, p: 1, s: 3, layout: 'azel' },
  '5-standard': { size: 5, r: 2, p: 2, s: 2, layout: 'rows' },
  '7-classic': { size: 7, r: 3, p: 3, s: 3, layout: 'rows' },
  '9-grand': { size: 9, r: 4, p: 4, s: 4, layout: 'rows' },
  '13-campaign': { size: 13, r: 6, p: 6, s: 6, layout: 'rows' },
};

let current = { size: 3, r: 1, p: 1, s: 1, layout: 'rows' };
let liveBoard = null;
let currentStrata = [];
let selectedStratum = null;
let selectedSquare = null;
let showSymmetryRays = false;
let compMode = 'states'; // 'states' | 'tree'

// Playout State
let playoutTimer = null;
let playoutGame = null;
let playoutPlies = 0;
let playoutCaptures = 0;
let playoutFast = false;

function formatBig(n) {
  if (n < 100_000_000n) return nf.format(n);
  const exp = L.decimalExponent(n);
  return `${exp.mantissa.toFixed(2)} × 10${superscript(exp.exponent)}`;
}

function superscript(num) {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(num).split('').map((d) => digits[d] || d).join('');
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let b = Number(bytes);
  let u = 0;
  if (bytes > 10n ** 24n) {
    const exp = L.decimalExponent(bytes);
    return `${exp.mantissa.toFixed(1)} × 10${superscript(exp.exponent)} B`;
  }
  while (b >= 1024 && u < units.length - 1) {
    b /= 1024;
    u++;
  }
  return `${b.toFixed(b < 10 ? 2 : 1)} ${units[u]}`;
}

function formatTime(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} minutes`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  if (seconds < 86400 * 365) return `${(seconds / 86400).toFixed(1)} days`;
  const years = seconds / (86400 * 365.25);
  if (years < 1e6) return `${nf.format(Math.round(years))} years`;
  const exp = Math.floor(Math.log10(years));
  const man = years / 10 ** exp;
  return `${man.toFixed(2)} × 10${superscript(exp)} years`;
}

// ── hero board rendering & direct interaction ──────────────────────────────
function renderBoard() {
  const host = $('pg-board');
  const size = current.size;
  host.style.setProperty('--grid-size', size);
  host.innerHTML = '';

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      const isEven = (r + c) % 2 === 0;
      cell.className = `pg-sq ${isEven ? 'even-cell' : 'odd-cell'}`;

      // Check if selected or antipodal
      if (selectedSquare) {
        if (selectedSquare.r === r && selectedSquare.c === c) {
          cell.style.outline = '2px solid var(--accent)';
          cell.style.boxShadow = 'inset 0 0 10px var(--accent)';
        } else if (selectedSquare.r === size - 1 - r && selectedSquare.c === size - 1 - c) {
          cell.style.outline = '2px dashed var(--red)';
        }
      }

      const coord = document.createElement('span');
      coord.className = 'tb-coord';
      coord.textContent = square(r, c, size);
      cell.appendChild(coord);

      const pcwrap = document.createElement('span');
      pcwrap.className = 'pcwrap';
      if (liveBoard[r][c]?.piece) {
        pcwrap.innerHTML = glyph(liveBoard[r][c].piece.type, liveBoard[r][c].piece.color, prefs.pieceStyle);
      }
      cell.appendChild(pcwrap);

      // Interactive Click on square
      cell.addEventListener('click', () => {
        selectedSquare = { r, c };
        const p = liveBoard[r][c]?.piece;
        const oppR = size - 1 - r;
        const oppC = size - 1 - c;
        const oppCell = liveBoard[oppR]?.[oppC];
        const oppDesc = oppCell?.piece
          ? `${oppCell.piece.color === E.BLUE ? 'Blue' : 'Red'} ${oppCell.piece.type.toUpperCase()}`
          : 'empty cell';

        if (p) {
          $('hero-inspect-banner').innerHTML = `Selected <b>${p.color === E.BLUE ? 'Blue' : 'Red'} ${p.type.toUpperCase()}</b> at ${square(r, c, size)} · 180° Antipodal Partner: <b>${oppDesc}</b> at ${square(oppR, oppC, size)}.`;
        } else {
          $('hero-inspect-banner').innerHTML = `Selected <b>Empty cell</b> at ${square(r, c, size)} · 180° Antipodal Partner: <b>${oppDesc}</b> at ${square(oppR, oppC, size)}.`;
        }
        renderBoard();
        drawSymmetryRays();
      });

      host.appendChild(cell);
    }
  }

  $('board-desc').textContent = `${size}×${size} · ${current.layout}`;
  drawSymmetryRays();
}

function drawSymmetryRays() {
  const svg = $('symmetry-ray-svg');
  if (!svg) return;
  svg.innerHTML = '';
  if (!showSymmetryRays) return;

  const size = current.size;
  const cellSize = 320 / size;
  const cx = 160, cy = 160;

  // Center beacon
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', cx);
  circle.setAttribute('cy', cy);
  circle.setAttribute('r', '5');
  circle.setAttribute('fill', 'var(--accent)');
  circle.setAttribute('stroke', '#ffffff');
  circle.setAttribute('stroke-width', '1.5');
  svg.appendChild(circle);

  // Draw rays from Blue pieces through center to Red pieces
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (liveBoard[r][c]?.piece?.color === E.BLUE) {
        const x1 = (c + 0.5) * cellSize;
        const y1 = (r + 0.5) * cellSize;
        const x2 = (size - 1 - c + 0.5) * cellSize;
        const y2 = (size - 1 - r + 0.5) * cellSize;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'var(--accent)');
        line.setAttribute('stroke-width', '1.8');
        line.setAttribute('stroke-dasharray', '4 3');
        line.setAttribute('opacity', '0.7');
        svg.appendChild(line);
      }
    }
  }
}

// ── deal generator ──────────────────────────────────────────────────────────
function sampleFairDeal() {
  const size = current.size;
  const armyPieces = current.r + current.p + current.s;
  const halfCells = Math.floor((size * size) / 2);

  if (armyPieces > halfCells) {
    current.r = 1;
    current.p = 1;
    current.s = 1;
    $('rock-input').value = 1;
    $('paper-input').value = 1;
    $('scissors-input').value = 1;
    $('rock-val').textContent = 1;
    $('paper-val').textContent = 1;
    $('scissors-val').textContent = 1;
  }

  const cfg = E.sanitizeCfg({
    size,
    perType: Math.max(current.r, current.p, current.s),
    layout: current.layout,
  });

  const b = E.emptyBoard(size);

  if (current.layout === 'azel' && size === 5) {
    // Exact Azel screen
    b[0][0] = { piece: { type: 'rock', color: E.BLUE } };
    b[0][1] = { piece: { type: 'paper', color: E.BLUE } };
    b[0][2] = { piece: { type: 'rock', color: E.BLUE } };
    b[1][0] = { piece: { type: 'scissors', color: E.BLUE } };
    b[1][1] = { piece: { type: 'scissors', color: E.BLUE } };
    b[1][2] = { piece: { type: 'scissors', color: E.BLUE } };
  } else if (current.layout === 'rows') {
    let slot = 0;
    const kinds = [
      ...Array(current.r).fill('rock'),
      ...Array(current.p).fill('paper'),
      ...Array(current.s).fill('scissors'),
    ];
    for (let r = 0; r < Math.ceil(size / 2) && slot < kinds.length; r++) {
      for (let c = 0; c < size && slot < kinds.length; c++) {
        b[r][c] = { piece: { type: kinds[slot++], color: E.BLUE } };
      }
    }
  } else if (current.layout === 'corners') {
    let slot = 0;
    const kinds = [
      ...Array(current.r).fill('rock'),
      ...Array(current.p).fill('paper'),
      ...Array(current.s).fill('scissors'),
    ];
    for (let d = 0; d < size && slot < kinds.length; d++) {
      for (let r = 0; r <= d && slot < kinds.length; r++) {
        const c = d - r;
        if (r < size && c < size) {
          b[r][c] = { piece: { type: kinds[slot++], color: E.BLUE } };
        }
      }
    }
  } else {
    // Scattered symmetric
    const pairs = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const oppR = size - 1 - r;
        const oppC = size - 1 - c;
        if (r < oppR || (r === oppR && c < oppC)) pairs.push([r, c]);
      }
    }
    // Shuffle pairs
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    const kinds = [
      ...Array(current.r).fill('rock'),
      ...Array(current.p).fill('paper'),
      ...Array(current.s).fill('scissors'),
    ];
    for (let i = 0; i < kinds.length && i < pairs.length; i++) {
      const [r, c] = pairs[i];
      b[r][c] = { piece: { type: kinds[i], color: E.BLUE } };
    }
  }

  // Reflect Blue to Red under 180° antipodal symmetry
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (b[r][c]?.piece?.color === E.BLUE) {
        const oppR = size - 1 - r;
        const oppC = size - 1 - c;
        b[oppR][oppC] = {
          piece: { type: b[r][c].piece.type, color: E.RED },
        };
      }
    }
  }

  liveBoard = b;
  renderBoard();
  resetPlayoutGame();
}

// ── strata waterfall ────────────────────────────────────────────────────────
function renderStrataWaterfall() {
  const host = $('strata-waterfall');
  host.innerHTML = '';

  const cfg = {
    size: current.size,
    perType: Math.max(current.r, current.p, current.s),
    customMaterial: { rock: current.r, paper: current.p, scissors: current.s },
  };

  currentStrata = L.materialLayers(cfg);
  const totalStates = currentStrata.reduce((sum, s) => sum + s.states, 0n);

  for (const s of currentStrata) {
    const row = document.createElement('div');
    row.className = `stratum-row ${selectedStratum === s.m ? 'selected' : ''}`;

    const label = document.createElement('div');
    label.className = 'stratum-label mono';
    label.textContent = `M = ${s.m} pieces`;

    const barwrap = document.createElement('div');
    barwrap.className = 'stratum-barwrap';

    const bar = document.createElement('div');
    bar.className = 'stratum-bar';
    const pct = totalStates > 0n ? Number((s.states * 10000n) / totalStates) / 100 : 0;
    bar.style.width = `${Math.max(pct, 0.5)}%`;
    barwrap.appendChild(bar);

    const count = document.createElement('div');
    count.className = 'stratum-count mono';
    count.textContent = `${formatBig(s.states)} (${pct.toFixed(1)}%)`;

    row.appendChild(label);
    row.appendChild(barwrap);
    row.appendChild(count);

    row.addEventListener('click', () => {
      selectedStratum = s.m;
      $('strata-inspect').textContent = `Stratum M = ${s.m}: ${formatBig(s.states)} states (${pct.toFixed(2)}% of universe)`;
      document.querySelectorAll('.stratum-row').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
    });

    host.appendChild(row);
  }
}

// ── comparative ladder ──────────────────────────────────────────────────────
function renderCompLadder() {
  const host = $('comp-ladder');
  host.innerHTML = '';

  const cfg = {
    size: current.size,
    perType: Math.max(current.r, current.p, current.s),
    customMaterial: { rock: current.r, paper: current.p, scissors: current.s },
  };
  const exact = L.exactCombinatorics(cfg);
  const jankenExp = compMode === 'states' ? L.decimalExponent(exact.states).exponent : current.size * current.size;

  const items = [...BENCHMARKS];
  items.push({
    name: `JANKEN (${current.size}×${current.size})`,
    states: exact.states,
    treeExp: current.size * current.size,
    isCurrent: true,
  });

  items.sort((a, b) => {
    const expA = compMode === 'states' ? (a.states ? L.decimalExponent(a.states).exponent : 0) : a.treeExp;
    const expB = compMode === 'states' ? (b.states ? L.decimalExponent(b.states).exponent : 0) : b.treeExp;
    return expA - expB;
  });

  const maxExp = Math.max(...items.map((i) => (compMode === 'states' ? (i.states ? L.decimalExponent(i.states).exponent : 0) : i.treeExp)), 1);

  for (const item of items) {
    const row = document.createElement('div');
    row.className = `comp-row ${item.isCurrent ? 'highlight' : ''}`;

    const exp = compMode === 'states' ? (item.states ? L.decimalExponent(item.states).exponent : 0) : item.treeExp;
    const valText = compMode === 'states' ? (item.states ? formatBig(item.states) : '—') : `10${superscript(item.treeExp)}`;

    row.innerHTML = `
      <div class="comp-name"><b>${item.name}</b> ${item.note ? `<span style="font-size:10px; color:var(--muted)">(${item.note})</span>` : ''}</div>
      <div class="comp-barwrap">
        <div class="comp-bar" style="width: ${Math.max((exp / maxExp) * 100, 2)}%;"></div>
      </div>
      <div class="comp-val mono">${valText}</div>
    `;
    host.appendChild(row);
  }
}

// ── 3B1B "powers of ten" cosmic scale explorer ──────────────────────────────
const SCALE_MILESTONES = [
  { exp: 1, title: 'Tic-Tac-Toe: 9 Openings (10¹)', icon: '✏️', desc: 'A game solved by children on paper. 255,168 total game tree leaf nodes.' },
  { exp: 4, title: 'Hex Pocket: 10,080 States (10⁴)', icon: '⬡', desc: 'The 7-cell hexagonal RPS pocket universe (R=2). Solved completely by retrograde minimax in 200 milliseconds.' },
  { exp: 5, title: '3×3 Skirmish: 415,550 States (10⁵)', icon: '⏳', desc: 'A pocket universe comparable to the grains of sand in a single teaspoon. 406 KB raw table, solved in 1.8 seconds.' },
  { exp: 14, title: '5×5 Azel: 3.58 × 10¹⁴ States (10¹⁴)', icon: '🏖️', desc: 'Comparable to the grains of sand on an entire 10-mile beach. Would require 179 Terabytes of RAM to store raw.' },
  { exp: 47, title: '9×9 Standard: 1.2 × 10⁴⁷ States (10⁴⁷)', icon: '🌍', desc: 'Exceeds the total estimated number of atoms in the entire planet Earth (~10⁵⁰ atoms).' },
  { exp: 80, title: 'Observable Universe Atoms (10⁸⁰)', icon: '🌌', desc: 'The total number of fundamental hydrogen atoms in the entire observable universe (Eddington-Dirac estimate).' },
  { exp: 123, title: 'Chess Shannon Number (10¹²³)', icon: '♟️', desc: 'Claude Shannon\'s famous estimate for the game tree complexity of classical chess.' },
  { exp: 170, title: '13×13 Expanse: 10¹⁷⁰ States (10¹⁷⁰)', icon: '🪐', desc: 'A monumental campaign whose state space exceeds the atoms in a googol universes.' },
];

function updateScaleStory(targetExp) {
  let closest = SCALE_MILESTONES[0];
  let minDiff = Math.abs(targetExp - closest.exp);
  for (const m of SCALE_MILESTONES) {
    const diff = Math.abs(targetExp - m.exp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = m;
    }
  }

  $('scale-exp-badge').textContent = `10${superscript(targetExp)} · ${closest.title.split(':')[0]}`;
  $('scale-icon').textContent = closest.icon;
  $('scale-title').textContent = closest.title;
  $('scale-desc').textContent = closest.desc;
}

// ── update all metrics ──────────────────────────────────────────────────────
function updateAll() {
  const size = current.size;
  const armyPieces = current.r + current.p + current.s;
  const totalPieces = armyPieces * 2;
  const cells = size * size;

  $('deal-density').textContent = `${((totalPieces / cells) * 100).toFixed(1)}% (${totalPieces}/${cells} cells)`;

  const cfg = {
    size,
    perType: Math.max(current.r, current.p, current.s),
    customMaterial: { rock: current.r, paper: current.p, scissors: current.s },
  };

  const exact = L.exactCombinatorics(cfg);
  $('stat-placements').textContent = formatBig(exact.placements);
  const pExp = L.decimalExponent(exact.placements);
  $('stat-placements-sci').textContent = `${pExp.mantissa.toFixed(2)} × 10${superscript(pExp.exponent)}`;

  $('stat-states').textContent = formatBig(exact.states);
  const sExp = L.decimalExponent(exact.states);
  $('stat-states-sci').textContent = `${sExp.mantissa.toFixed(2)} × 10${superscript(sExp.exponent)}`;

  $('stat-storage').textContent = formatBytes(exact.states);

  const ramBytes = exact.states * 26n;
  $('stat-ram').textContent = formatBytes(ramBytes);

  const sec = Number(exact.states) / 1_000_000;
  $('stat-time').textContent = formatTime(sec);

  // Azel button availability
  if (size === 5) {
    $('layout-azel-btn').style.display = 'inline-block';
  } else {
    $('layout-azel-btn').style.display = 'none';
    if (current.layout === 'azel') {
      current.layout = 'rows';
      document.querySelectorAll('#layout-buttons .calc-btn').forEach((b) => b.classList.remove('on'));
      document.querySelector('#layout-buttons .calc-btn[data-layout="rows"]').classList.add('on');
    }
  }

  // Update scale slider to match current state space exponent
  $('scale-slider').value = Math.min(Math.max(sExp.exponent, 1), 170);
  updateScaleStory(sExp.exponent);

  sampleFairDeal();
  renderStrataWaterfall();
  renderCompLadder();
}

// ── realtime playout engine ─────────────────────────────────────────────────
function resetPlayoutGame() {
  if (playoutTimer) {
    clearInterval(playoutTimer);
    playoutTimer = null;
    $('playout-run-btn').textContent = 'run realtime playout';
  }

  playoutPlies = 0;
  playoutCaptures = 0;

  const cfg = E.sanitizeCfg({
    size: current.size,
    perType: Math.max(current.r, current.p, current.s),
    capture: 'rps',
    threefold: true,
  });

  const boardCopy = E.emptyBoard(current.size);
  let livePieces = 0;
  for (let r = 0; r < current.size; r++) {
    for (let c = 0; c < current.size; c++) {
      if (liveBoard[r][c]?.piece) {
        boardCopy[r][c] = {
          owner: liveBoard[r][c].piece.color,
          piece: { ...liveBoard[r][c].piece },
        };
        livePieces++;
      }
    }
  }

  playoutGame = {
    board: boardCopy,
    cfg,
    turn: E.BLUE,
    moves: [],
    repetitions: {},
    dry: 0,
    acts: 0,
    passStreak: 0,
    gameOver: false,
    endReason: null,
  };

  $('ticker-ply').textContent = '0';
  $('ticker-mat').textContent = livePieces;
  $('ticker-caps').textContent = '0';
  const initialMoves = E.allMoves(playoutGame.board, playoutGame.turn, cfg);
  $('ticker-branch').textContent = initialMoves.length.toFixed(1);
  $('ticker-status').textContent = 'Ready';
  $('ticker-status').style.color = 'var(--accent)';
}

function stepPlayout() {
  if (!playoutGame || playoutGame.gameOver) {
    resetPlayoutGame();
  }

  const moves = E.allMoves(playoutGame.board, playoutGame.turn, playoutGame.cfg);
  if (!moves.length) {
    playoutGame.gameOver = true;
    playoutGame.endReason = 'no_moves';
    $('ticker-status').textContent = 'Immobilized';
    $('ticker-status').style.color = 'var(--red)';
    if (playoutTimer) {
      clearInterval(playoutTimer);
      playoutTimer = null;
      $('playout-run-btn').textContent = 'run realtime playout';
    }
    return;
  }

  // Pick capture if available, else random legal
  const caps = moves.filter((m) => m.captured);
  const picked = caps.length > 0
    ? caps[Math.floor(Math.random() * caps.length)]
    : moves[Math.floor(Math.random() * moves.length)];

  if (picked.captured) playoutCaptures++;
  E.applyMove(playoutGame, picked);
  playoutPlies++;

  // Update live board
  liveBoard = playoutGame.board;
  renderBoard();

  let surviving = 0;
  for (let r = 0; r < current.size; r++) {
    for (let c = 0; c < current.size; c++) {
      if (liveBoard[r][c]?.piece) surviving++;
    }
  }

  $('ticker-ply').textContent = playoutPlies;
  $('ticker-mat').textContent = surviving;
  $('ticker-caps').textContent = playoutCaptures;
  const nextMoves = E.allMoves(playoutGame.board, playoutGame.turn, playoutGame.cfg);
  $('ticker-branch').textContent = nextMoves.length.toFixed(1);

  if (playoutGame.gameOver) {
    $('ticker-status').textContent = `Game Over (${playoutGame.endReason})`;
    $('ticker-status').style.color = 'var(--win)';
    if (playoutTimer) {
      clearInterval(playoutTimer);
      playoutTimer = null;
      $('playout-run-btn').textContent = 'run realtime playout';
    }
  } else {
    $('ticker-status').textContent = `${playoutGame.turn === E.BLUE ? 'Blue' : 'Red'} to move`;
    $('ticker-status').style.color = playoutGame.turn === E.BLUE ? 'var(--blue)' : 'var(--red)';
  }
}

function togglePlayoutRun() {
  if (playoutTimer) {
    clearInterval(playoutTimer);
    playoutTimer = null;
    $('playout-run-btn').textContent = 'run realtime playout';
  } else {
    $('playout-run-btn').textContent = 'pause playout';
    const interval = playoutFast ? 120 : 380;
    playoutTimer = setInterval(stepPlayout, interval);
  }
}

// ── initialization ──────────────────────────────────────────────────────────
function init() {
  try {
    const savedTheme = localStorage.getItem('janken-theme');
    if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  } catch {}

  $('theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('janken-theme', next); } catch {}
  });

  mountFact($('dyk'));

  // Preset Buttons
  document.querySelectorAll('.calc-btn[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.calc-btn[data-preset]').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      const p = PRESETS[btn.dataset.preset];
      if (p) {
        current = { ...p };
        $('size-slider').value = current.size;
        $('size-dim').textContent = `${current.size}×${current.size}`;
        $('size-cells').textContent = `${current.size * current.size} cells`;
        $('rock-input').value = current.r;
        $('paper-input').value = current.p;
        $('scissors-input').value = current.s;
        $('rock-val').textContent = current.r;
        $('paper-val').textContent = current.p;
        $('scissors-val').textContent = current.s;
        updateAll();
      }
    });
  });

  // Size Slider (Debounced for instant responsiveness)
  let sizeDebounce = null;
  $('size-slider').addEventListener('input', (e) => {
    const size = parseInt(e.target.value, 10);
    $('size-dim').textContent = `${size}×${size}`;
    $('size-cells').textContent = `${size * size} cells`;
    clearTimeout(sizeDebounce);
    sizeDebounce = setTimeout(() => {
      current.size = size;
      updateAll();
    }, 40);
  });

  // Layout Buttons
  document.querySelectorAll('#layout-buttons .calc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#layout-buttons .calc-btn').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      current.layout = btn.dataset.layout;
      sampleFairDeal();
    });
  });

  // Material Sliders
  $('rock-input').addEventListener('input', (e) => {
    current.r = parseInt(e.target.value, 10);
    $('rock-val').textContent = current.r;
    updateAll();
  });
  $('paper-input').addEventListener('input', (e) => {
    current.p = parseInt(e.target.value, 10);
    $('paper-val').textContent = current.p;
    updateAll();
  });
  $('scissors-input').addEventListener('input', (e) => {
    current.s = parseInt(e.target.value, 10);
    $('scissors-val').textContent = current.s;
    updateAll();
  });

  // Playout buttons
  $('playout-run-btn').addEventListener('click', togglePlayoutRun);
  $('playout-step-btn').addEventListener('click', stepPlayout);
  $('playout-reset-btn').addEventListener('click', () => {
    resetPlayoutGame();
    renderBoard();
  });
  $('playout-speed-btn').addEventListener('click', () => {
    playoutFast = !playoutFast;
    $('playout-speed-btn').textContent = `speed: ${playoutFast ? 'fast' : 'normal'}`;
    if (playoutTimer) {
      clearInterval(playoutTimer);
      playoutTimer = setInterval(stepPlayout, playoutFast ? 120 : 380);
    }
  });

  // Symmetry rays toggle
  $('toggle-symmetry-rays').addEventListener('click', () => {
    showSymmetryRays = !showSymmetryRays;
    $('toggle-symmetry-rays').textContent = `180° rays: ${showSymmetryRays ? 'on' : 'off'}`;
    $('toggle-symmetry-rays').classList.toggle('on', showSymmetryRays);
    drawSymmetryRays();
  });

  // Sample deal button
  $('sample-deal-btn').addEventListener('click', sampleFairDeal);

  // 3B1B Powers of Ten Slider
  $('scale-slider').addEventListener('input', (e) => {
    const exp = parseInt(e.target.value, 10);
    updateScaleStory(exp);
  });

  // Comp mode buttons
  $('comp-mode-states').addEventListener('click', () => {
    compMode = 'states';
    $('comp-mode-states').classList.add('on');
    $('comp-mode-tree').classList.remove('on');
    renderCompLadder();
  });
  $('comp-mode-tree').addEventListener('click', () => {
    compMode = 'tree';
    $('comp-mode-tree').classList.add('on');
    $('comp-mode-states').classList.remove('on');
    renderCompLadder();
  });

  updateAll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
