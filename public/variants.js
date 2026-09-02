// Topology & Variant Laboratory.
// Exploring cyclic dominance, material strata DAGs, and tournament topologies.
import * as E from './engine.js';
import * as L from './lab.js';
import { mountFact } from './facts.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-GB');

// ── 3x3 tablebase material strata distribution (exact solved numbers) ────────
const STRATA_3X3 = [
  { m: 6, states: 120960, reached: 76032, note: 'full material (opening layer)' },
  { m: 5, states: 181440, reached: 110592, note: 'first capture stratum' },
  { m: 4, states: 86400, reached: 49536, note: 'midgame simplification' },
  { m: 3, states: 21600, reached: 11232, note: 'endgame threshold' },
  { m: 2, states: 4320, reached: 2016, note: '2-piece duels' },
  { m: 1, states: 720, reached: 288, note: 'lone piece chases' },
  { m: 0, states: 110, reached: 0, note: 'terminal annihilation' },
];

const TOPOLOGIES = {
  cyclic: {
    name: 'Cyclic Ring (ℤ/3ℤ)',
    cycleNote: 'Contains 3-cycle',
    termNote: 'Requires 3-fold rule',
    desc: 'Standard JANKEN: R takes S, S takes P, P takes R. The capture tournament contains an intransitive directed 3-cycle. This creates non-trivial Strongly Connected Components (SCCs) in the state space graph, requiring the 3-fold repetition rule to prevent infinite games.',
    edges: [
      { from: [150, 65], to: [220, 175], label: 'takes' }, // R -> S
      { from: [210, 205], to: [90, 205], label: 'takes' },  // S -> P
      { from: [80, 175], to: [140, 65], label: 'takes' },   // P -> R
    ],
  },
  transitive: {
    name: 'Transitive Order',
    cycleNote: 'Zero cycles (DAG)',
    termNote: 'Guaranteed finite ply',
    desc: 'Hierarchical variant: R takes P, P takes S, R takes S (a strict transitive tournament). Because the capture graph is acyclic, the entire game graph becomes a strict DAG. Infinite repetition loops are mathematically impossible: every match is guaranteed to end in finite ply!',
    edges: [
      { from: [140, 65], to: [80, 175], label: 'takes' },   // R -> P
      { from: [90, 205], to: [210, 205], label: 'takes' },  // P -> S
      { from: [150, 65], to: [220, 175], label: 'takes' },  // R -> S
    ],
  },
  symmetric: {
    name: 'Symmetric (Chess-style)',
    cycleNote: 'Complete bidirectional K₃',
    termNote: 'Scalar material values',
    desc: 'Chess-style capture: every piece can take any piece it attacks. The tournament graph is a complete bidirectional clique (K₃). Strategic value becomes linear/scalar, destroying the triangular Rock-Paper-Scissors tactical balance.',
    edges: [
      { from: [145, 65], to: [215, 175], label: 'takes' },
      { from: [225, 175], to: [155, 65], label: 'takes' },
      { from: [210, 200], to: [90, 200], label: 'takes' },
      { from: [90, 210], to: [210, 210], label: 'takes' },
      { from: [85, 175], to: [145, 65], label: 'takes' },
      { from: [135, 65], to: [75, 175], label: 'takes' },
    ],
  },
};

let currentTopo = 'cyclic';

function renderDigraph() {
  const g = $('digraph-edges');
  g.innerHTML = '';
  const topo = TOPOLOGIES[currentTopo];

  $('stat-topo-type').textContent = topo.name;
  $('stat-topo-cycles').textContent = topo.cycleNote;
  $('stat-topo-term').textContent = topo.termNote;
  $('topo-desc').textContent = topo.desc;

  for (const edge of topo.edges) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', edge.from[0]);
    line.setAttribute('y1', edge.from[1]);
    line.setAttribute('x2', edge.to[0]);
    line.setAttribute('y2', edge.to[1]);
    line.setAttribute('stroke', 'var(--accent)');
    line.setAttribute('marker-end', 'url(#arr-accent)');
    g.appendChild(line);
  }
}

function renderMaterialStrata() {
  const container = $('layer-strata');
  container.innerHTML = '';

  const maxStates = 181440; // stratum 5 is largest

  for (const stratum of STRATA_3X3) {
    const row = document.createElement('div');
    row.className = 'layer-row';

    const lbl = document.createElement('div');
    lbl.style.fontWeight = '600';
    lbl.textContent = `M = ${stratum.m} (${stratum.m} pcs)`;

    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${(stratum.states / maxStates) * 100}%`;
    barWrap.appendChild(fill);

    const val = document.createElement('div');
    val.style.fontFamily = 'ui-monospace, monospace';
    val.style.textAlign = 'right';
    val.style.color = 'var(--muted)';
    val.textContent = `${nf.format(stratum.states)} st`;

    row.appendChild(lbl);
    row.appendChild(barWrap);
    row.appendChild(val);
    container.appendChild(row);
  }
}

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

  document.querySelectorAll('.calc-btn[data-topo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.calc-btn[data-topo]').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      currentTopo = btn.dataset.topo;
      renderDigraph();
    });
  });

  renderDigraph();
  renderMaterialStrata();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
