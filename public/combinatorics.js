// Combinatorics & State Space Playground.
// Pure BigInt integer arithmetic exploring multiset arrangements, layout geometry,
// strata cascades, and Shannon game tree complexity.
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

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} minutes`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  if (seconds < 86400 * 365) return `${(seconds / 86400).toFixed(1)} days`;
  const years = seconds / (86400 * 365.25);
  if (years < 1000) return `${years.toFixed(1)} years`;
  if (years < 1e9) return `${nf.format(Math.round(years))} years`;
  return `${years.toExponential(2)} years`;
}

function buildCfg() {
  return E.sanitizeCfg({
    size: current.size,
    perType: Math.max(current.r, current.p, current.s),
    layout: current.layout,
    rockMove: 'king',
    paperMove: 'king',
    scissorsMove: 'king',
    capture: 'rps',
    territory: false,
    threefold: true,
  });
}

// ── layout deal generation ──────────────────────────────────────────────────
function buildStartBoard() {
  const size = current.size;
  const b = E.emptyBoard(size);
  const put = (r, c, type) => {
    b[r][c] = { owner: E.BLUE, piece: { type, color: E.BLUE } };
    b[size - 1 - r][size - 1 - c] = { owner: E.RED, piece: { type, color: E.RED } };
  };

  const list = [
    ...Array(current.r).fill('rock'),
    ...Array(current.p).fill('paper'),
    ...Array(current.s).fill('scissors'),
  ];

  if (current.layout === 'azel' && size >= 4 && current.r === 2 && current.p === 1 && current.s === 3) {
    const top = Math.floor((size - 3) / 2);
    const back = ['rock', 'paper', 'rock'];
    for (let i = 0; i < 3; i++) {
      put(top + i, 0, back[i]);
      put(top + i, 1, 'scissors');
    }
    return b;
  }

  if (current.layout === 'corners') {
    let idx = 0;
    for (let r = 0; r < size && idx < list.length; r++) {
      for (let c = 0; c < size && idx < list.length; c++) {
        if (r + c < Math.floor(size / 1.4) && r < Math.floor(size / 2)) {
          put(r, c, list[idx++]);
        }
      }
    }
    // fallback if couldn't fit
    while (idx < list.length) {
      put(Math.floor(idx / size), idx % Math.floor(size / 2), list[idx++]);
    }
    return b;
  }

  if (current.layout === 'scattered') {
    const cells = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < Math.floor(size / 2); c++) {
        cells.push([r, c]);
      }
    }
    // deterministic shuffle
    for (let i = cells.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (let i = 0; i < list.length && i < cells.length; i++) {
      put(cells[i][0], cells[i][1], list[i]);
    }
    return b;
  }

  // default 'rows'
  const half = Math.floor(size / 2);
  const width = Math.max(1, Math.min(Math.ceil(list.length / size), half));
  const height = Math.min(size, Math.ceil(list.length / width));
  const r0 = Math.floor((size - height) / 2);
  const c0 = Math.floor((half - width) / 2);
  let idx = 0;
  for (let c = c0; c < c0 + width && idx < list.length; c++) {
    for (let r = r0; r < r0 + height && idx < list.length; r++) {
      put(r, c, list[idx++]);
    }
  }
  return b;
}

// ── hero board rendering ────────────────────────────────────────────────────
function renderBoard(boardToRender = liveBoard) {
  const host = $('pg-board');
  host.style.setProperty('--grid-size', current.size);
  host.innerHTML = '';

  const size = current.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `pg-sq ${(r + c) % 2 === 0 ? 'even-cell' : 'odd-cell'}`;
      cell.dataset.r = r;
      cell.dataset.c = c;

      const coord = document.createElement('span');
      coord.className = 'tb-coord';
      coord.textContent = square(r, c, size);
      cell.appendChild(coord);

      const pcwrap = document.createElement('span');
      pcwrap.className = 'pcwrap';
      const cellData = boardToRender[r][c];
      if (cellData?.piece) {
        pcwrap.innerHTML = glyph(cellData.piece.type, cellData.piece.color, prefs.pieceStyle);
      }
      cell.appendChild(pcwrap);

      // Antipodal symmetry hover
      cell.addEventListener('mouseenter', () => {
        const mr = size - 1 - r;
        const mc = size - 1 - c;
        cell.classList.add('sym-hover');
        const mirror = host.querySelector(`.pg-sq[data-r="${mr}"][data-c="${mc}"]`);
        if (mirror) mirror.classList.add('sym-hover');
      });

      cell.addEventListener('mouseleave', () => {
        host.querySelectorAll('.pg-sq.sym-hover').forEach((el) => el.classList.remove('sym-hover'));
      });

      host.appendChild(cell);
    }
  }
}

// ── material strata waterfall ───────────────────────────────────────────────
function countLivingPieces(b) {
  let count = 0;
  for (let r = 0; r < current.size; r++) {
    for (let c = 0; c < current.size; c++) {
      if (b[r][c].piece) count++;
    }
  }
  return count;
}

function renderStrataWaterfall(totalStates) {
  const container = $('strata-waterfall');
  container.innerHTML = '';
  if (!currentStrata.length) return;

  const maxStratum = currentStrata.reduce((max, s) => (s.states > max ? s.states : max), 1n);
  const currentLiving = liveBoard ? countLivingPieces(liveBoard) : null;

  // Render top-down (M = max down to 0)
  for (let i = currentStrata.length - 1; i >= 0; i--) {
    const s = currentStrata[i];
    const row = document.createElement('div');
    row.className = `layer-row ${selectedStratum === s.m ? 'active' : ''}`;
    if (currentLiving === s.m) row.style.boxShadow = 'inset 0 0 0 1.5px var(--accent)';

    const lbl = document.createElement('div');
    lbl.style.fontWeight = '600';
    lbl.textContent = `M = ${s.m} (${s.m} pcs)`;

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    const pct = totalStates > 0n ? Number((s.states * 10000n) / totalStates) / 100 : 0;
    const barWidth = maxStratum > 0n ? Number((s.states * 10000n) / maxStratum) / 100 : 0;
    fill.style.width = `${Math.max(1, barWidth)}%`;
    barWrap.appendChild(fill);

    const val = document.createElement('div');
    val.style.fontFamily = 'ui-monospace, monospace';
    val.style.textAlign = 'right';
    val.style.color = 'var(--muted)';
    val.textContent = `${pct.toFixed(1)}%`;

    row.appendChild(lbl);
    row.appendChild(barWrap);
    row.appendChild(val);

    row.addEventListener('click', () => {
      selectedStratum = s.m;
      $('strata-inspect').textContent = `Stratum M=${s.m}: ${formatBig(s.states)} states (${pct.toFixed(2)}% of total)`;
      renderStrataWaterfall(totalStates);
    });

    container.appendChild(row);
  }
}

// ── comparative complexity ladder ───────────────────────────────────────────
function renderComplexityLadder(currentStates, currentBranching) {
  const container = $('comp-ladder');
  container.innerHTML = '';

  const cfg = buildCfg();
  const medianDepth = Math.round(20 + current.size * 3.5);
  const currentTreeLog = medianDepth * Math.log10(Math.max(2, currentBranching));

  const entries = [
    ...BENCHMARKS.map((b) => ({
      name: b.name,
      valLog: compMode === 'states'
        ? L.decimalExponent(b.states).exponent + Math.log10(Math.max(1, L.decimalExponent(b.states).mantissa))
        : b.treeExp,
      displayVal: compMode === 'states' ? formatBig(b.states) : `10${superscript(b.treeExp)}`,
      solved: b.solved,
      isCurrent: false,
      note: b.note,
    })),
    {
      name: `${current.size}×${current.size} Current`,
      valLog: compMode === 'states'
        ? L.decimalExponent(currentStates).exponent + Math.log10(Math.max(1, L.decimalExponent(currentStates).mantissa))
        : currentTreeLog,
      displayVal: compMode === 'states' ? formatBig(currentStates) : `10${superscript(Math.round(currentTreeLog))}`,
      solved: current.size === 3,
      isCurrent: true,
      note: compMode === 'states' ? (current.size === 3 ? 'solved' : 'current state space') : `b=${currentBranching.toFixed(1)}, d≈${medianDepth}`,
    },
  ].sort((a, b) => a.valLog - b.valLog);

  const maxLog = compMode === 'states' ? 175 : 365;

  for (const entry of entries) {
    const pct = Math.max(1, Math.min(100, (entry.valLog / maxLog) * 100));

    const row = document.createElement('div');
    row.className = `comp-row ${entry.isCurrent ? 'current' : ''} ${entry.solved ? 'solved' : ''}`;

    const name = document.createElement('div');
    name.className = 'name';
    name.innerHTML = `${entry.name}<em>${entry.note}</em>`;

    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${pct}%`;
    track.appendChild(fill);

    const val = document.createElement('div');
    val.className = 'val';
    val.textContent = entry.displayVal;

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    container.appendChild(row);
  }
}

// ── playout engine & strata plunge ──────────────────────────────────────────
function resetPlayout() {
  if (playoutTimer) {
    clearInterval(playoutTimer);
    playoutTimer = null;
  }
  liveBoard = buildStartBoard();
  const cfg = buildCfg();
  playoutGame = E.newGame(cfg, liveBoard);
  playoutPlies = 0;
  playoutCaptures = 0;

  $('ticker-ply').textContent = '0';
  $('ticker-mat').textContent = String(countLivingPieces(liveBoard));
  $('ticker-caps').textContent = '0';
  const initialMoves = E.allMoves(playoutGame.board, playoutGame.turn, cfg);
  $('ticker-branch').textContent = initialMoves.length.toFixed(1);
  $('ticker-status').textContent = 'Ready';
  $('ticker-status').style.color = 'var(--accent)';
  $('playout-run-btn').textContent = 'run realtime playout';

  renderBoard(liveBoard);
  if (currentStrata.length) {
    const totalStates = currentStrata.reduce((sum, s) => sum + s.states, 0n);
    renderStrataWaterfall(totalStates);
  }
}

function stepPlayout() {
  if (!playoutGame || playoutGame.gameOver) {
    resetPlayout();
  }
  const cfg = buildCfg();
  const moves = E.allMoves(playoutGame.board, playoutGame.turn, cfg);
  if (!moves.length || playoutGame.gameOver) {
    endPlayout(playoutGame.endReason || 'immobilization');
    return;
  }

  // Realistic policy: prefer captures and central advances
  const centre = (cfg.size - 1) / 2;
  const scored = moves.map((move) => {
    const isCap = !!E.captureTarget(playoutGame.board, move, cfg);
    const dist = Math.abs(move.tr - centre) + Math.abs(move.tc - centre);
    return { move, isCap, score: (isCap ? 50 : 0) + (cfg.size - dist) + Math.random() * 8 };
  }).sort((a, b) => b.score - a.score);

  const choice = scored[0].move;
  if (scored[0].isCap) playoutCaptures++;

  E.applyMove(playoutGame, choice);
  playoutPlies++;
  liveBoard = playoutGame.board;

  $('ticker-ply').textContent = String(playoutPlies);
  const mat = countLivingPieces(liveBoard);
  $('ticker-mat').textContent = String(mat);
  $('ticker-caps').textContent = String(playoutCaptures);
  const nextMoves = E.allMoves(playoutGame.board, playoutGame.turn, cfg);
  $('ticker-branch').textContent = nextMoves.length.toFixed(1);

  renderBoard(liveBoard);
  if (currentStrata.length) {
    const totalStates = currentStrata.reduce((sum, s) => sum + s.states, 0n);
    renderStrataWaterfall(totalStates);
  }

  if (playoutGame.gameOver) {
    endPlayout(playoutGame.endReason || 'elimination');
  }
}

function endPlayout(reason) {
  if (playoutTimer) {
    clearInterval(playoutTimer);
    playoutTimer = null;
  }
  $('playout-run-btn').textContent = 'run realtime playout';
  $('ticker-status').textContent = `Finished (${reason})`;
  $('ticker-status').style.color = reason === 'repetition' ? 'var(--draw)' : 'var(--win)';
}

function togglePlayoutRun() {
  if (playoutTimer) {
    clearInterval(playoutTimer);
    playoutTimer = null;
    $('playout-run-btn').textContent = 'run realtime playout';
    $('ticker-status').textContent = 'Paused';
  } else {
    if (!playoutGame || playoutGame.gameOver) resetPlayout();
    $('playout-run-btn').textContent = 'pause playout';
    $('ticker-status').textContent = 'Simulating…';
    $('ticker-status').style.color = 'var(--win)';
    const delay = playoutFast ? 100 : 380;
    playoutTimer = setInterval(() => {
      stepPlayout();
    }, delay);
  }
}

// ── main render loop ────────────────────────────────────────────────────────
function render() {
  $('size-dim').textContent = `${current.size}×${current.size}`;
  $('size-cells').textContent = `${current.size * current.size} cells`;
  $('rock-val').textContent = current.r;
  $('paper-val').textContent = current.p;
  $('scissors-val').textContent = current.s;
  $('board-desc').textContent = `${current.size}×${current.size} · ${current.layout}`;

  // Azel layout button visibility
  const canAzel = current.size >= 4 && current.r === 2 && current.p === 1 && current.s === 3;
  $('layout-azel-btn').style.display = canAzel ? '' : 'none';
  if (current.layout === 'azel' && !canAzel) {
    current.layout = 'rows';
  }

  // Update layout button styles
  document.querySelectorAll('#layout-buttons .calc-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.layout === current.layout);
  });

  const army = current.r + current.p + current.s;
  const cells = current.size * current.size;
  const occupancyPct = ((army * 2 / cells) * 100).toFixed(1);
  $('deal-density').textContent = `${occupancyPct}% (${army * 2}/${cells} cells)`;

  if (army * 2 > cells) {
    $('stat-placements').textContent = 'Material exceeds board capacity';
    $('stat-states').textContent = '—';
    $('stat-openings').textContent = '—';
    $('deal-sym').textContent = 'Capacity Exceeded';
    $('deal-sym').style.color = 'var(--loss)';
    return;
  }

  $('deal-sym').textContent = '180° Rotational Antipodal';
  $('deal-sym').style.color = 'var(--win)';

  const cfg = buildCfg();
  const customMaterial = { rock: current.r, paper: current.p, scissors: current.s };

  const space = L.stateSpace({ ...cfg, customMaterial });
  const states = space.states;
  const openings = L.openingCount({ ...cfg, customMaterial });
  const branching = L.branchingFor(current.size, [
    { size: 3, value: 12.8 },
    { size: 5, value: 17.5 },
    { size: 7, value: 25.0 },
    { size: 9, value: 34.0 },
    { size: 13, value: 48.0 },
  ]);
  const cost = L.solveCost(states, branching, 1_000_000);

  $('stat-placements').textContent = nf.format(space.placements);
  $('stat-placements-sci').textContent = formatBig(space.placements);
  $('stat-states').textContent = nf.format(states);
  $('stat-states-sci').textContent = formatBig(states);
  $('stat-openings').textContent = nf.format(openings);
  $('stat-storage').textContent = formatBytes(cost.bytes);
  $('stat-ram').textContent = formatBytes(cost.ram);
  $('stat-time').textContent = formatDuration(cost.seconds);

  currentStrata = L.materialLayers({ ...cfg, customMaterial });
  renderStrataWaterfall(states);
  renderComplexityLadder(states, branching);

  resetPlayout();
}

// ── csv exports ─────────────────────────────────────────────────────────────
function exportCsv() {
  const rows = [
    ['size', 'cells', 'pieces', 'placements', 'states', 'openings', 'solve_ram_bytes', 'solve_duration_sec'],
  ];

  for (const size of L.LADDER) {
    const cfg = E.sanitizeCfg({ ...E.PRESETS.standard, size });
    const space = L.stateSpace(cfg);
    const openings = L.openingCount(cfg);
    const branching = L.branchingFor(size, [
      { size: 3, value: 12.8 }, { size: 5, value: 17.5 }, { size: 9, value: 34.0 },
    ]);
    const cost = L.solveCost(space.states, branching, 1_000_000);

    rows.push([
      size,
      space.cells,
      space.pieces,
      String(space.placements),
      String(space.states),
      String(openings),
      String(cost.ram),
      cost.seconds.toFixed(2),
    ]);
  }

  const csv = rows.map((r) => r.join(',')).join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'janken-complexity-ladder.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function exportStrataCsv() {
  if (!currentStrata.length) return;
  const total = currentStrata.reduce((sum, s) => sum + s.states, 0n);
  const rows = [
    ['material_remaining', 'pieces', 'placements', 'directed_states', 'percent_of_total_space'],
  ];
  for (const s of currentStrata) {
    const pct = total > 0n ? (Number((s.states * 10000n) / total) / 100).toFixed(4) : '0';
    rows.push([s.m, s.m, String(s.placements), String(s.states), `${pct}%`]);
  }

  const csv = rows.map((r) => r.join(',')).join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `janken-${current.size}x${current.size}-material-strata.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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

  // Sliders
  $('size-slider').addEventListener('input', (e) => {
    current.size = parseInt(e.target.value, 10);
    document.querySelectorAll('.calc-btn[data-preset]').forEach((b) => b.classList.remove('on'));
    render();
  });

  $('rock-input').addEventListener('input', (e) => {
    current.r = parseInt(e.target.value, 10);
    document.querySelectorAll('.calc-btn[data-preset]').forEach((b) => b.classList.remove('on'));
    render();
  });

  $('paper-input').addEventListener('input', (e) => {
    current.p = parseInt(e.target.value, 10);
    document.querySelectorAll('.calc-btn[data-preset]').forEach((b) => b.classList.remove('on'));
    render();
  });

  $('scissors-input').addEventListener('input', (e) => {
    current.s = parseInt(e.target.value, 10);
    document.querySelectorAll('.calc-btn[data-preset]').forEach((b) => b.classList.remove('on'));
    render();
  });

  // Presets
  document.querySelectorAll('.calc-btn[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.calc-btn[data-preset]').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      const preset = PRESETS[btn.dataset.preset];
      if (preset) {
        current = { ...preset };
        $('size-slider').value = current.size;
        $('rock-input').value = current.r;
        $('paper-input').value = current.p;
        $('scissors-input').value = current.s;
        render();
      }
    });
  });

  // Layout Buttons
  document.querySelectorAll('#layout-buttons .calc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      current.layout = btn.dataset.layout;
      render();
    });
  });

  // Sample deal
  $('sample-deal-btn').addEventListener('click', () => {
    if (current.layout !== 'scattered') {
      current.layout = 'scattered';
    }
    render();
  });

  // Playout buttons
  $('playout-run-btn').addEventListener('click', togglePlayoutRun);
  $('playout-step-btn').addEventListener('click', stepPlayout);
  $('playout-reset-btn').addEventListener('click', resetPlayout);
  $('playout-speed-btn').addEventListener('click', () => {
    playoutFast = !playoutFast;
    $('playout-speed-btn').textContent = `speed: ${playoutFast ? 'fast' : 'normal'}`;
    $('playout-speed-btn').classList.toggle('on', playoutFast);
    if (playoutTimer) {
      clearInterval(playoutTimer);
      playoutTimer = setInterval(stepPlayout, playoutFast ? 100 : 380);
    }
  });

  // Complexity Mode Buttons
  $('comp-mode-states').addEventListener('click', () => {
    compMode = 'states';
    $('comp-mode-states').classList.add('on');
    $('comp-mode-tree').classList.remove('on');
    const cfg = buildCfg();
    const customMaterial = { rock: current.r, paper: current.p, scissors: current.s };
    const space = L.stateSpace({ ...cfg, customMaterial });
    const branching = L.branchingFor(current.size, [{ size: 3, value: 12.8 }, { size: 9, value: 34.0 }]);
    renderComplexityLadder(space.states, branching);
  });

  $('comp-mode-tree').addEventListener('click', () => {
    compMode = 'tree';
    $('comp-mode-tree').classList.add('on');
    $('comp-mode-states').classList.remove('on');
    const cfg = buildCfg();
    const customMaterial = { rock: current.r, paper: current.p, scissors: current.s };
    const space = L.stateSpace({ ...cfg, customMaterial });
    const branching = L.branchingFor(current.size, [{ size: 3, value: 12.8 }, { size: 9, value: 34.0 }]);
    renderComplexityLadder(space.states, branching);
  });

  $('export-csv').addEventListener('click', exportCsv);
  $('export-strata-csv').addEventListener('click', exportStrataCsv);

  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
