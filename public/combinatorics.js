// Combinatorics & State Space Playground.
// Pure BigInt integer arithmetic exploring multiset arrangements and retrograde budgets.
import * as E from './engine.js';
import * as L from './lab.js';
import { mountFact } from './facts.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-GB');

// ── benchmarks ───────────────────────────────────────────────────────────────
const BENCHMARKS = [
  { name: 'Tic-Tac-Toe', states: 5478n, solved: true, note: 'solved by hand' },
  { name: '3×3 JANKEN', states: 415550n, solved: true, note: 'solved tablebase' },
  { name: 'Connect Four', states: 4531985219092n, solved: true, note: 'Allis 1988' },
  { name: 'Checkers', states: 500995484682338672639n, solved: true, note: 'Schaeffer 2007' },
  { name: 'Chess', states: 10n ** 43n, solved: false, note: 'Shannon estimate' },
  { name: 'Go (19×19)', states: 10n ** 170n, solved: false, note: 'Tromp 2016' },
];

const PRESETS = {
  '3-skirmish': { size: 3, r: 1, p: 1, s: 1 },
  '5-azel': { size: 5, r: 2, p: 1, s: 3 },
  '5-standard': { size: 5, r: 2, p: 2, s: 2 },
  '7-classic': { size: 7, r: 3, p: 3, s: 3 },
  '9-grand': { size: 9, r: 4, p: 4, s: 4 },
  '13-campaign': { size: 13, r: 6, p: 6, s: 6 },
};

let current = { size: 3, r: 1, p: 1, s: 1 };

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
    boardLayout: 'rows',
    movement: 'king',
  });
}

function render() {
  $('size-dim').textContent = `${current.size}×${current.size}`;
  $('size-cells').textContent = `${current.size * current.size} cells`;
  $('rock-val').textContent = current.r;
  $('paper-val').textContent = current.p;
  $('scissors-val').textContent = current.s;

  const cfg = buildCfg();
  // Override starting material directly for exact custom counts:
  const army = current.r + current.p + current.s;
  const cells = current.size * current.size;

  if (army * 2 > cells) {
    $('stat-placements').textContent = 'Material exceeds board capacity';
    $('stat-states').textContent = '—';
    return;
  }

  const space = L.stateSpace({
    ...cfg,
    // Custom material helper
    customMaterial: { rock: current.r, paper: current.p, scissors: current.s },
  });

  const states = space.states;
  const openings = L.openingCount(cfg);
  const branching = L.branchingEstimate(current.size);
  const cost = L.solveCost(states, branching, 1_000_000);

  $('stat-placements').textContent = nf.format(space.placements);
  $('stat-placements-sci').textContent = formatBig(space.placements);
  $('stat-states').textContent = nf.format(states);
  $('stat-states-sci').textContent = formatBig(states);
  $('stat-openings').textContent = nf.format(openings);
  $('stat-storage').textContent = formatBytes(cost.bytes);
  $('stat-ram').textContent = formatBytes(cost.ram);
  $('stat-time').textContent = formatDuration(cost.seconds);

  renderComplexityLadder(states);
}

function renderComplexityLadder(currentStates) {
  const container = $('comp-ladder');
  container.innerHTML = '';

  const entries = [
    ...BENCHMARKS,
    {
      name: `${current.size}×${current.size} Current`,
      states: currentStates,
      solved: current.size === 3,
      isCurrent: true,
      note: current.size === 3 ? 'solved' : 'current selection',
    },
  ].sort((a, b) => (a.states < b.states ? -1 : a.states > b.states ? 1 : 0));

  const maxLog = 175; // Go scale

  for (const entry of entries) {
    const exp = L.decimalExponent(entry.states);
    const logVal = Math.min(maxLog, exp.exponent + Math.log10(Math.max(1, exp.mantissa)));
    const pct = Math.max(1, (logVal / maxLog) * 100);

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
    val.textContent = formatBig(entry.states);

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    container.appendChild(row);
  }
}

function exportCsv() {
  const rows = [
    ['size', 'cells', 'pieces', 'placements', 'states', 'openings', 'solve_ram_bytes', 'solve_duration_sec'],
  ];

  for (const size of L.LADDER) {
    const cfg = E.sanitizeCfg({ ...E.PRESETS.standard, size });
    const space = L.stateSpace(cfg);
    const openings = L.openingCount(cfg);
    const branching = L.branchingEstimate(size);
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

function init() {
  // Theme initialization
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

  // Slider inputs
  $('size-slider').addEventListener('input', (e) => {
    current.size = parseInt(e.target.value, 10);
    // Uncheck preset buttons if customized
    document.querySelectorAll('.calc-btn').forEach((b) => b.classList.remove('on'));
    render();
  });

  $('rock-input').addEventListener('input', (e) => {
    current.r = parseInt(e.target.value, 10);
    document.querySelectorAll('.calc-btn').forEach((b) => b.classList.remove('on'));
    render();
  });

  $('paper-input').addEventListener('input', (e) => {
    current.p = parseInt(e.target.value, 10);
    document.querySelectorAll('.calc-btn').forEach((b) => b.classList.remove('on'));
    render();
  });

  $('scissors-input').addEventListener('input', (e) => {
    current.s = parseInt(e.target.value, 10);
    document.querySelectorAll('.calc-btn').forEach((b) => b.classList.remove('on'));
    render();
  });

  // Presets
  document.querySelectorAll('.calc-btn[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.calc-btn').forEach((b) => b.classList.remove('on'));
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

  $('export-csv').addEventListener('click', exportCsv);

  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
