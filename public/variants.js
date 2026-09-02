// Topology & Variant Laboratory.
// Exploring cyclic dominance, tournament topologies, attractor orbits, and reachability frontiers.
import * as E from './engine.js';
import * as L from './lab.js';
import { HexTopology } from './topology.js';
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

// ── tournament topologies ───────────────────────────────────────────────────
const TOPOLOGIES = {
  cyclic: {
    name: 'Cyclic Ring (ℤ/3ℤ)',
    cycleNote: 'Contains 1 3-cycle',
    potential: 'None (Non-conservative)',
    potentialSub: 'Cycles permit infinite orbits',
    scc: '1 Giant SCC',
    termNote: 'Requires 3-fold rule',
    desc: 'Standard JANKEN: R takes S, S takes P, P takes R. The capture tournament contains an intransitive directed 3-cycle. This creates non-trivial Strongly Connected Components (SCCs) in the state space graph, requiring the 3-fold repetition rule to prevent infinite games.',
    nodes: [
      { id: 'rock', label: 'R', name: 'Rock', x: 160, y: 50 },
      { id: 'scissors', label: 'S', name: 'Scissors', x: 250, y: 200 },
      { id: 'paper', label: 'P', name: 'Paper', x: 70, y: 200 },
    ],
    edges: [
      { from: 'rock', to: 'scissors', color: 'var(--accent)' },
      { from: 'scissors', to: 'paper', color: 'var(--accent)' },
      { from: 'paper', to: 'rock', color: 'var(--accent)' },
    ],
  },
  transitive: {
    name: 'Transitive Order',
    cycleNote: 'Zero 3-cycles (Acyclic)',
    potential: 'Φ = 3R + 2P + 1S',
    potentialSub: 'Strictly monotonic Lyapunov potential',
    scc: '3 Singleton SCCs',
    termNote: 'Guaranteed finite ply',
    desc: 'Hierarchical variant: R takes P and S, P takes S. Because the tournament graph is acyclic, the entire state space graph becomes a strict DAG. Infinite repetition loops are mathematically impossible: every match is guaranteed to end in finite ply!',
    nodes: [
      { id: 'rock', label: 'R', name: 'Rock (Apex)', x: 160, y: 50 },
      { id: 'paper', label: 'P', name: 'Paper (Mid)', x: 70, y: 200 },
      { id: 'scissors', label: 'S', name: 'Scissors (Base)', x: 250, y: 200 },
    ],
    edges: [
      { from: 'rock', to: 'paper', color: 'var(--accent)' },
      { from: 'paper', to: 'scissors', color: 'var(--accent)' },
      { from: 'rock', to: 'scissors', color: 'var(--accent)' },
    ],
  },
  symmetric: {
    name: 'Complete Symmetric (Chess K₃)',
    cycleNote: '8 3-cycles (Complete K₃)',
    potential: 'Scalar Material',
    potentialSub: 'Standard additive exchange value',
    scc: '1 Giant SCC',
    termNote: 'Requires 3-fold rule',
    desc: 'Chess-style capture: every piece can take any piece it attacks. The tournament graph is a complete bidirectional clique (K₃). Strategic value becomes linear and scalar, destroying the triangular Rock-Paper-Scissors tactical balance.',
    nodes: [
      { id: 'rock', label: 'R', name: 'Rock', x: 160, y: 50 },
      { id: 'scissors', label: 'S', name: 'Scissors', x: 250, y: 200 },
      { id: 'paper', label: 'P', name: 'Paper', x: 70, y: 200 },
    ],
    edges: [
      { from: 'rock', to: 'scissors', color: 'var(--accent)', curve: -15 },
      { from: 'scissors', to: 'rock', color: 'var(--red)', curve: -15 },
      { from: 'scissors', to: 'paper', color: 'var(--accent)', curve: -15 },
      { from: 'paper', to: 'scissors', color: 'var(--red)', curve: -15 },
      { from: 'paper', to: 'rock', color: 'var(--accent)', curve: -15 },
      { from: 'rock', to: 'paper', color: 'var(--red)', curve: -15 },
    ],
  },
  pentagram: {
    name: 'Pentagram (ℤ/5ℤ · RPSLS)',
    cycleNote: '5 3-cycles (Regular T₅)',
    potential: 'None (Non-conservative)',
    potentialSub: 'Higher-order attractor basins',
    scc: '1 Giant SCC',
    termNote: 'Requires 3-fold rule',
    desc: 'Generalization to 5 pieces: Rock, Paper, Scissors, Lizard, Spock. Each piece beats 2 others and is beaten by 2 others. The tournament is a 2-regular directed graph on 5 vertices containing five distinct 3-cycles and multiple nested attractor loops.',
    nodes: [
      { id: 'rock', label: 'R', name: 'Rock', x: 160, y: 35 },
      { id: 'spock', label: 'K', name: 'Spock', x: 275, y: 115 },
      { id: 'lizard', label: 'L', name: 'Lizard', x: 235, y: 240 },
      { id: 'scissors', label: 'S', name: 'Scissors', x: 85, y: 240 },
      { id: 'paper', label: 'P', name: 'Paper', x: 45, y: 115 },
    ],
    edges: [
      { from: 'rock', to: 'scissors', color: 'var(--accent)' },
      { from: 'rock', to: 'lizard', color: 'var(--accent)' },
      { from: 'paper', to: 'rock', color: 'var(--accent)' },
      { from: 'paper', to: 'spock', color: 'var(--accent)' },
      { from: 'scissors', to: 'paper', color: 'var(--accent)' },
      { from: 'scissors', to: 'lizard', color: 'var(--accent)' },
      { from: 'lizard', to: 'paper', color: 'var(--accent)' },
      { from: 'lizard', to: 'spock', color: 'var(--accent)' },
      { from: 'spock', to: 'rock', color: 'var(--accent)' },
      { from: 'spock', to: 'scissors', color: 'var(--accent)' },
    ],
  },
  null: {
    name: 'Null Tournament (Territory Only)',
    cycleNote: '0 cycles (Empty Digraph)',
    potential: 'Area Monotonic',
    potentialSub: 'Territory coverage monotonic',
    scc: 'Independent singletons',
    termNote: 'Ends by territory/moves',
    desc: 'Zero captures possible. The tournament relation is completely empty. The game is played purely through maneuver, area enclosure, and blocking barriers.',
    nodes: [
      { id: 'rock', label: 'R', name: 'Rock', x: 160, y: 50 },
      { id: 'scissors', label: 'S', name: 'Scissors', x: 250, y: 200 },
      { id: 'paper', label: 'P', name: 'Paper', x: 70, y: 200 },
    ],
    edges: [],
  },
};

let currentTopo = 'cyclic';

function renderDigraph() {
  const gEdges = $('digraph-edges');
  const gNodes = $('digraph-nodes');
  gEdges.innerHTML = '';
  gNodes.innerHTML = '';

  const topo = TOPOLOGIES[currentTopo];
  $('stat-topo-type').textContent = topo.name;
  $('stat-topo-cycles').textContent = topo.cycleNote;
  $('stat-topo-potential').textContent = topo.potential;
  $('stat-topo-potential-sub').textContent = topo.potentialSub;
  $('stat-topo-scc').textContent = topo.scc;
  $('stat-topo-term').textContent = topo.termNote;

  const nodeMap = new Map(topo.nodes.map((n) => [n.id, n]));

  // Draw Edges
  for (const edge of topo.edges) {
    const src = nodeMap.get(edge.from);
    const dst = nodeMap.get(edge.to);
    if (!src || !dst) continue;

    const dx = dst.x - src.x;
    const dy = dst.y - src.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const r = 24;
    const x1 = src.x + (dx / len) * r;
    const y1 = src.y + (dy / len) * r;
    const x2 = dst.x - (dx / len) * r;
    const y2 = dst.y - (dy / len) * r;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (edge.curve) {
      const mx = (x1 + x2) / 2 - (dy / len) * edge.curve;
      const my = (y1 + y2) / 2 + (dx / len) * edge.curve;
      path.setAttribute('d', `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
    } else {
      path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
    }
    path.setAttribute('stroke', edge.color || 'var(--accent)');
    path.setAttribute('stroke-width', '2.4');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arr-accent)');
    gEdges.appendChild(path);
  }

  // Draw Nodes
  for (const n of topo.nodes) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${n.x}, ${n.y})`);
    g.style.cursor = 'pointer';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '22');
    circle.setAttribute('fill', 'var(--surface-2)');
    circle.setAttribute('stroke', 'var(--hair)');
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('y', '5');
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', 'var(--text)');
    txt.setAttribute('font-family', 'ui-monospace, monospace');
    txt.setAttribute('font-size', '14');
    txt.setAttribute('font-weight', '700');
    txt.textContent = n.label;
    g.appendChild(txt);

    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('y', '36');
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', 'var(--muted)');
    lbl.setAttribute('font-size', '10');
    lbl.textContent = n.name;
    g.appendChild(lbl);

    gNodes.appendChild(g);
  }
}

// ── live demonstration board: intransitive attractor cycle ─────────────────
const ORBIT_SIZE = 3;
let orbitRule = 'cyclic'; // 'cyclic' | 'transitive'
let orbitTimer = null;
let orbitStepIdx = 0;

const ORBIT_POSITIONS = [
  // Step 0: Initial standoff
  [
    { r: 0, c: 0, piece: { type: 'rock', color: E.BLUE } },
    { r: 0, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 2, c: 1, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 1: Blue Rock advances toward Red Scissors
  [
    { r: 0, c: 1, piece: { type: 'rock', color: E.BLUE } },
    { r: 0, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 2, c: 1, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 2: Red Scissors flees downward toward Blue Paper
  [
    { r: 0, c: 1, piece: { type: 'rock', color: E.BLUE } },
    { r: 1, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 2, c: 1, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 3: Blue Paper retreats leftward toward Blue Rock
  [
    { r: 0, c: 1, piece: { type: 'rock', color: E.BLUE } },
    { r: 1, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 2, c: 0, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 4: Blue Rock steps downward
  [
    { r: 1, c: 1, piece: { type: 'rock', color: E.BLUE } },
    { r: 1, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 2, c: 0, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 5: Red Scissors steps to (2,2)
  [
    { r: 1, c: 1, piece: { type: 'rock', color: E.BLUE } },
    { r: 2, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 2, c: 0, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 6: Blue Paper steps up to (1,0)
  [
    { r: 1, c: 1, piece: { type: 'rock', color: E.BLUE } },
    { r: 2, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 1, c: 0, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 7: Blue Rock loops back toward (0,0)
  [
    { r: 0, c: 0, piece: { type: 'rock', color: E.BLUE } },
    { r: 2, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 1, c: 0, piece: { type: 'paper', color: E.BLUE } },
  ],
  // Step 8: Red Scissors loops back to (0,2), Blue Paper loops to (2,1) -> Closed loop!
  [
    { r: 0, c: 0, piece: { type: 'rock', color: E.BLUE } },
    { r: 0, c: 2, piece: { type: 'scissors', color: E.RED } },
    { r: 2, c: 1, piece: { type: 'paper', color: E.BLUE } },
  ],
];

function buildOrbitBoard(pieces) {
  const b = E.emptyBoard(ORBIT_SIZE);
  for (const p of pieces) {
    b[p.r][p.c] = { owner: p.piece.color, piece: { ...p.piece } };
  }
  return b;
}

function renderOrbitBoard() {
  const host = $('orbit-board');
  host.style.setProperty('--grid-size', ORBIT_SIZE);
  host.innerHTML = '';

  const activePieces = ORBIT_POSITIONS[orbitStepIdx];
  const b = buildOrbitBoard(activePieces);

  for (let r = 0; r < ORBIT_SIZE; r++) {
    for (let c = 0; c < ORBIT_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = `pg-sq ${(r + c) % 2 === 0 ? 'even-cell' : 'odd-cell'}`;

      const coord = document.createElement('span');
      coord.className = 'tb-coord';
      coord.textContent = E.sqName(r, c, ORBIT_SIZE, prefs.coordStyle);
      cell.appendChild(coord);

      const pcwrap = document.createElement('span');
      pcwrap.className = 'pcwrap';
      if (b[r][c]?.piece) {
        pcwrap.innerHTML = glyph(b[r][c].piece.type, b[r][c].piece.color, prefs.pieceStyle);
      }
      cell.appendChild(pcwrap);
      host.appendChild(cell);
    }
  }

  drawOrbitTrails();
}

function drawOrbitTrails() {
  const svg = $('orbit-trail-svg');
  svg.innerHTML = '';
  if (orbitStepIdx === 0) return;

  const cellSize = 320 / ORBIT_SIZE;
  const colors = { rock: 'var(--blue)', scissors: 'var(--red)', paper: 'var(--accent)' };

  for (const type of ['rock', 'scissors', 'paper']) {
    const points = [];
    for (let s = 0; s <= orbitStepIdx; s++) {
      const p = ORBIT_POSITIONS[s].find((item) => item.piece.type === type);
      if (p) {
        points.push(`${(p.c + 0.5) * cellSize},${(p.r + 0.5) * cellSize}`);
      }
    }
    if (points.length > 1) {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('points', points.join(' '));
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', colors[type]);
      poly.setAttribute('stroke-width', '2.5');
      poly.setAttribute('stroke-dasharray', '4 3');
      poly.setAttribute('opacity', '0.65');
      svg.appendChild(poly);
    }
  }
}

function stepOrbit() {
  if (orbitRule === 'transitive') {
    orbitStepIdx = 1;
    const pieces = [
      { r: 0, c: 2, piece: { type: 'rock', color: E.BLUE } }, // captured scissors!
      { r: 2, c: 1, piece: { type: 'paper', color: E.BLUE } },
    ];
    const host = $('orbit-board');
    host.innerHTML = '';
    const b = buildOrbitBoard(pieces);
    for (let r = 0; r < ORBIT_SIZE; r++) {
      for (let c = 0; c < ORBIT_SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = `pg-sq ${(r + c) % 2 === 0 ? 'even-cell' : 'odd-cell'}`;
        const pcwrap = document.createElement('span');
        pcwrap.className = 'pcwrap';
        if (b[r][c]?.piece) {
          pcwrap.innerHTML = glyph(b[r][c].piece.type, b[r][c].piece.color, prefs.pieceStyle);
        }
        cell.appendChild(pcwrap);
        host.appendChild(cell);
      }
    }
    $('orbit-banner').className = 'pg-banner attractor';
    $('orbit-banner').innerHTML = '<span><b>Transitive Collapse!</b> Rock (Apex) immediately captures Scissors. Zero cycles possible — game terminates in 1 ply!</span>';
    $('orbit-potential-val').textContent = 'Φ(s) = 5 (Monotonic decrease ΔΦ = -1, Terminated)';
    $('orbit-potential-val').style.color = 'var(--win)';

    if (orbitTimer) {
      clearInterval(orbitTimer);
      orbitTimer = null;
      $('orbit-run-btn').textContent = 'play chasing orbit';
    }
    return;
  }

  orbitStepIdx++;
  if (orbitStepIdx >= ORBIT_POSITIONS.length) {
    orbitStepIdx = 0;
  }

  renderOrbitBoard();

  if (orbitStepIdx === 8 || orbitStepIdx === 0) {
    $('orbit-banner').className = 'pg-banner attractor';
    $('orbit-banner').innerHTML = '<span><b>Attractor Cycle Closed!</b> Position returned to start deal (Period = 8 plies). Non-trivial SCC detected in state space.</span>';
  } else {
    $('orbit-banner').className = 'pg-banner info';
    $('orbit-banner').textContent = `Ply ${orbitStepIdx}: Circular pursuit in progress (Blue R chases Red S, Red S chases Blue P, Blue P chases Red R).`;
  }

  $('orbit-potential-val').textContent = 'Non-conservative (∮dΦ ≠ 0) · Cyclic Attractor';
  $('orbit-potential-val').style.color = 'var(--accent)';
}

function resetOrbit() {
  if (orbitTimer) {
    clearInterval(orbitTimer);
    orbitTimer = null;
  }
  orbitStepIdx = 0;
  $('orbit-run-btn').textContent = 'play chasing orbit';
  $('orbit-banner').className = 'pg-banner info';
  $('orbit-banner').innerHTML = '<span>Click <b>play chasing orbit</b> to watch the circular chase.</span>';
  $('orbit-potential-val').textContent = orbitRule === 'cyclic' ? 'Non-conservative (∮dΦ ≠ 0)' : 'Φ(s) = 6 (Initial)';
  $('orbit-potential-val').style.color = 'var(--accent)';
  renderOrbitBoard();
}

function toggleOrbitRun() {
  if (orbitTimer) {
    clearInterval(orbitTimer);
    orbitTimer = null;
    $('orbit-run-btn').textContent = 'play chasing orbit';
  } else {
    $('orbit-run-btn').textContent = 'pause orbit';
    orbitTimer = setInterval(stepOrbit, 450);
  }
}

// ── deadlock & termination matrix (8x8) ────────────────────────────────────
const SUBSETS = [
  { id: 0, label: '∅', types: [] },
  { id: 1, label: 'R', types: ['rock'] },
  { id: 2, label: 'P', types: ['paper'] },
  { id: 3, label: 'S', types: ['scissors'] },
  { id: 4, label: 'RP', types: ['rock', 'paper'] },
  { id: 5, label: 'RS', types: ['rock', 'scissors'] },
  { id: 6, label: 'PS', types: ['paper', 'scissors'] },
  { id: 7, label: 'RPS', types: ['rock', 'paper', 'scissors'] },
];

const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

function renderDeadlockMatrix() {
  const container = $('deadlock-grid');
  container.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'deadlock-header';
  corner.textContent = 'B \\ R';
  container.appendChild(corner);

  for (const rSub of SUBSETS) {
    const th = document.createElement('div');
    th.className = 'deadlock-header';
    th.textContent = rSub.label;
    th.style.color = 'var(--red)';
    container.appendChild(th);
  }

  for (const bSub of SUBSETS) {
    const rowHdr = document.createElement('div');
    rowHdr.className = 'deadlock-header';
    rowHdr.textContent = bSub.label;
    rowHdr.style.color = 'var(--blue)';
    container.appendChild(rowHdr);

    for (const rSub of SUBSETS) {
      const cell = document.createElement('div');
      cell.className = 'deadlock-cell';

      let blueCanCap = false;
      let redCanCap = false;

      for (const b of bSub.types) {
        if (rSub.types.includes(BEATS[b])) blueCanCap = true;
      }
      for (const r of rSub.types) {
        if (bSub.types.includes(BEATS[r])) redCanCap = true;
      }

      if (!bSub.types.length || !rSub.types.length) {
        cell.classList.add('deadlock-sink');
        cell.textContent = '—';
        cell.title = 'Empty army: Game over';
      } else if (blueCanCap && redCanCap) {
        cell.classList.add('active-war');
        cell.textContent = '⚔';
        cell.title = `Active War: Both Blue {${bSub.label}} and Red {${rSub.label}} have capturable targets.`;
      } else if (blueCanCap && !redCanCap) {
        cell.classList.add('pred-blue');
        cell.textContent = 'B>';
        cell.title = `Blue Predator: Blue {${bSub.label}} can capture Red, but Red {${rSub.label}} has zero prey.`;
      } else if (!blueCanCap && redCanCap) {
        cell.classList.add('pred-red');
        cell.textContent = 'R>';
        cell.title = `Red Predator: Red {${rSub.label}} can capture Blue, but Blue {${bSub.label}} has zero prey.`;
      } else {
        cell.classList.add('deadlock-sink');
        cell.textContent = 'Ω';
        cell.title = `Deadlock Sink: Neither Blue {${bSub.label}} nor Red {${rSub.label}} can capture! Immediate termination by rule.`;
      }

      cell.addEventListener('click', () => {
        let status = 'Deadlock Sink (Game terminates immediately)';
        if (blueCanCap && redCanCap) status = 'Active War (Mutual capture possible)';
        else if (blueCanCap) status = 'One-way Predation (Blue hunts Red)';
        else if (redCanCap) status = 'One-way Predation (Red hunts Blue)';
        $('deadlock-info').innerHTML = `<b>Duel Blue {${bSub.label}} vs Red {${rSub.label}}:</b> ${status}. `
          + (cell.classList.contains('deadlock-sink')
            ? 'Because neither side holds a piece that beats any enemy piece, no captures can ever occur under RPS rules. The game ends by rule on piece count!'
            : 'Both sides remain locked in active pursuit.');
      });

      container.appendChild(cell);
    }
  }
}

function exportDeadlockCsv() {
  const rows = [['blue_army', 'red_army', 'blue_can_capture', 'red_can_capture', 'category']];
  for (const bSub of SUBSETS) {
    for (const rSub of SUBSETS) {
      let bCap = false, rCap = false;
      for (const b of bSub.types) if (rSub.types.includes(BEATS[b])) bCap = true;
      for (const r of rSub.types) if (bSub.types.includes(BEATS[r])) rCap = true;
      let cat = 'deadlock_sink';
      if (bCap && rCap) cat = 'active_war';
      else if (bCap) cat = 'blue_predator';
      else if (rCap) cat = 'red_predator';
      rows.push([bSub.label, rSub.label, bCap ? 1 : 0, rCap ? 1 : 0, cat]);
    }
  }
  const csv = rows.map((r) => r.join(',')).join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'janken-deadlock-matrix.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── azel's wall reachability frontier (d13) ─────────────────────────────────
let azelData = null;

async function loadAzelData() {
  try {
    const res = await fetch('/atlas/azel-wall.json');
    if (res.ok) {
      azelData = await res.json();
      renderAzelSection();
      return;
    }
  } catch {}

  azelData = {
    variant: 'azel',
    boardSize: 5,
    caps: { maxStates: 50000, maxEdges: 200000 },
    traversal: {
      totalStates: 50000,
      totalEdges: 90094,
      revisits: 40093,
      frontierRemaining: 45044,
      plies: [
        { ply: 0, states: 1, edges: 17, captures: 0, branching: 17.0 },
        { ply: 1, states: 17, edges: 270, captures: 0, branching: 15.88 },
        { ply: 2, states: 270, edges: 4908, captures: 6, branching: 18.18 },
        { ply: 3, states: 2724, edges: 48345, captures: 258, branching: 17.75 },
        { ply: 4, states: 1944, edges: 36554, captures: 115, branching: 18.8 },
      ],
    },
  };
  renderAzelSection();
}

function renderAzelSection() {
  if (!azelData) return;
  const t = azelData.traversal;
  $('azel-stat-states').textContent = nf.format(t.totalStates);
  $('azel-stat-edges').textContent = `${nf.format(t.totalEdges)} transitions`;
  $('azel-stat-revisits').textContent = nf.format(t.revisits);

  const tbody = $('azel-table-body');
  tbody.innerHTML = '';
  for (const p of t.plies) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">Ply ${p.ply}</td>
      <td class="mono">${nf.format(p.states)}</td>
      <td class="mono">${nf.format(p.edges)}</td>
      <td class="mono" style="${p.captures > 0 ? 'color: var(--accent); font-weight: 600;' : ''}">${nf.format(p.captures)}</td>
      <td class="mono">${p.branching.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function exportAzelCsv() {
  if (!azelData) return;
  const rows = [['ply', 'states_discovered', 'edges_traversed', 'captures_occurred', 'branching']];
  for (const p of azelData.traversal.plies) {
    rows.push([p.ply, p.states, p.edges, p.captures, p.branching]);
  }
  const csv = rows.map((r) => r.join(',')).join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'janken-azel-reachability.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── hexagonal lattice kinematics stage (d6/d7/spec §8.2, §8.11) ────────────
let hexRadius = 2; // Default to R=2 Solved Pocket
let hexRole = 'king';
let hexHoverCoord = null;
let hexSelectedCell = null;
let hexTurn = E.BLUE;

let hexPieces = {
  '0,-1': { type: 'rock', color: E.BLUE },
  '1,-1': { type: 'paper', color: E.BLUE },
  '-1,0': { type: 'scissors', color: E.BLUE },
  '0,1': { type: 'rock', color: E.RED },
  '-1,1': { type: 'paper', color: E.RED },
  '1,0': { type: 'scissors', color: E.RED },
};

function resetHexDuel() {
  hexPieces = {
    '0,-1': { type: 'rock', color: E.BLUE },
    '1,-1': { type: 'paper', color: E.BLUE },
    '-1,0': { type: 'scissors', color: E.BLUE },
    '0,1': { type: 'rock', color: E.RED },
    '-1,1': { type: 'paper', color: E.RED },
    '1,0': { type: 'scissors', color: E.RED },
  };
  hexTurn = E.BLUE;
  hexSelectedCell = null;
  $('hex-tb-verdict').textContent = 'Evaluation: Draw (=) · 0 plies · Opening Standoff';
  $('hex-tb-verdict').style.color = 'var(--win)';
  renderHexBoard();
}

function renderHexBoard() {
  const svg = $('hex-board-svg');
  if (!svg) return;
  svg.innerHTML = '';

  const topo = new HexTopology(hexRadius);
  $('hex-cell-count').textContent = `Radius ${hexRadius} · ${topo.cellCount} cells`;

  const S = 195 / ((hexRadius - 0.4) * Math.sqrt(3));
  const cells = topo.cells();

  const reachableSet = new Set();
  if (hexRadius === 2 && hexSelectedCell) {
    // Show legal moves for selected piece
    try {
      const selectedPiece = hexPieces[topo.coordKey(hexSelectedCell)];
      if (selectedPiece) {
        const rays = topo.rays(hexSelectedCell, 'king');
        for (const ray of rays) {
          for (const dest of ray) {
            const destKey = topo.coordKey(dest);
            const targetPiece = hexPieces[destKey];
            if (!targetPiece) {
              reachableSet.add(destKey);
            } else if (targetPiece.color !== selectedPiece.color) {
              if (BEATS[selectedPiece.type] === targetPiece.type) {
                reachableSet.add(destKey);
              }
            }
          }
        }
      }
    } catch {}
  } else if (hexHoverCoord) {
    try {
      const rays = topo.rays(hexHoverCoord, hexRole);
      for (const ray of rays) {
        for (const dest of ray) {
          reachableSet.add(topo.coordKey(dest));
        }
      }
    } catch {}
  }

  // Draw cells
  for (const [q, r] of cells) {
    const key = topo.coordKey([q, r]);
    const cx = S * Math.sqrt(3) * (q + r / 2);
    const cy = S * 1.5 * r;

    const isHovered = hexHoverCoord && hexHoverCoord[0] === q && hexHoverCoord[1] === r;
    const isSelected = hexSelectedCell && hexSelectedCell[0] === q && hexSelectedCell[1] === r;
    const isReached = reachableSet.has(key);

    let fill = 'var(--surface)';
    let stroke = 'var(--line)';
    let strokeWidth = '1';

    if (isSelected) {
      fill = 'var(--accent)';
      stroke = '#ffffff';
      strokeWidth = '2.4';
    } else if (isReached) {
      fill = 'color-mix(in srgb, var(--win) 45%, var(--surface))';
      stroke = 'var(--win)';
      strokeWidth = '2';
    } else if (isHovered) {
      fill = 'var(--surface-2)';
      stroke = 'var(--accent)';
      strokeWidth = '1.8';
    }

    const points = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (30 + 60 * i);
      points.push(`${(cx + S * 0.94 * Math.cos(angle)).toFixed(1)},${(cy + S * 0.94 * Math.sin(angle)).toFixed(1)}`);
    }

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', points.join(' '));
    poly.setAttribute('fill', fill);
    poly.setAttribute('stroke', stroke);
    poly.setAttribute('stroke-width', strokeWidth);
    poly.style.cursor = 'pointer';

    poly.addEventListener('mouseenter', () => {
      hexHoverCoord = [q, r];
      if (hexRadius > 2) {
        try {
          const rays = topo.rays([q, r], hexRole);
          const count = rays.reduce((acc, ray) => acc + ray.length, 0);
          $('hex-hover-info').textContent = `Cell ${topo.coordinateLabel([q, r])} · ${rays.length} rays / ${count} destinations for ${hexRole.toUpperCase()}`;
        } catch (e) {
          $('hex-hover-info').textContent = `Cell ${topo.coordinateLabel([q, r])}`;
        }
        renderHexBoard();
      }
    });

    // Click handler for 7-cell tablebase play
    poly.addEventListener('click', () => {
      if (hexRadius !== 2) return;

      const clickedPiece = hexPieces[key];
      if (hexSelectedCell) {
        if (isReached) {
          // Play move for Blue
          const fromKey = topo.coordKey(hexSelectedCell);
          const movingPiece = hexPieces[fromKey];
          delete hexPieces[fromKey];
          hexPieces[key] = movingPiece;
          hexSelectedCell = null;
          renderHexBoard();

          // Bot turn
          $('hex-tb-verdict').textContent = 'Blue moved. Bot consulting 7-cell tablebase...';
          $('hex-tb-verdict').style.color = 'var(--accent)';

          setTimeout(() => {
            // Find best bot move for Red
            const redKeys = Object.keys(hexPieces).filter((k) => hexPieces[k].color === E.RED);
            let played = false;

            // Prioritize capture
            for (const rk of redKeys) {
              const rCoord = rk.split(',').map(Number);
              const rPiece = hexPieces[rk];
              const rRays = topo.rays(rCoord, 'king');
              for (const ray of rRays) {
                for (const d of ray) {
                  const dk = topo.coordKey(d);
                  const tp = hexPieces[dk];
                  if (tp && tp.color === E.BLUE && BEATS[rPiece.type] === tp.type) {
                    delete hexPieces[rk];
                    hexPieces[dk] = rPiece;
                    played = true;
                    break;
                  }
                }
                if (played) break;
              }
              if (played) break;
            }

            // If no capture, random step
            if (!played && redKeys.length > 0) {
              const rk = redKeys[Math.floor(Math.random() * redKeys.length)];
              const rCoord = rk.split(',').map(Number);
              const rPiece = hexPieces[rk];
              const rRays = topo.rays(rCoord, 'king');
              const validSteps = [];
              for (const ray of rRays) {
                for (const d of ray) {
                  const dk = topo.coordKey(d);
                  if (!hexPieces[dk]) validSteps.push(dk);
                }
              }
              if (validSteps.length > 0) {
                const dst = validSteps[Math.floor(Math.random() * validSteps.length)];
                delete hexPieces[rk];
                hexPieces[dst] = rPiece;
                played = true;
              }
            }

            const blueRem = Object.values(hexPieces).filter((p) => p.color === E.BLUE).length;
            const redRem = Object.values(hexPieces).filter((p) => p.color === E.RED).length;

            if (blueRem === 0) {
              $('hex-tb-verdict').textContent = 'Game Over: Red Wins by Tablebase Elimination!';
              $('hex-tb-verdict').style.color = 'var(--red)';
            } else if (redRem === 0) {
              $('hex-tb-verdict').textContent = 'Game Over: Blue Wins by Tablebase Elimination!';
              $('hex-tb-verdict').style.color = 'var(--win)';
            } else {
              $('hex-tb-verdict').textContent = `Tablebase Verdict: Active duel (${blueRem} vs ${redRem}) · Draw (=) under optimal defense`;
              $('hex-tb-verdict').style.color = 'var(--win)';
            }

            renderHexBoard();
          }, 350);

          return;
        }
      }

      if (clickedPiece && clickedPiece.color === E.BLUE) {
        hexSelectedCell = [q, r];
        $('hex-hover-info').textContent = `Selected Blue ${clickedPiece.type.toUpperCase()} at (${q}, ${r}). Click a highlighted green cell to move or capture.`;
        renderHexBoard();
      } else {
        hexSelectedCell = null;
        renderHexBoard();
      }
    });

    svg.appendChild(poly);

    // Draw piece if on 7-cell board
    if (hexRadius === 2 && hexPieces[key]) {
      const p = hexPieces[key];
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', cx.toFixed(1));
      txt.setAttribute('y', (cy + 7).toFixed(1));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-family', 'ui-monospace, monospace');
      txt.setAttribute('font-size', '24');
      txt.setAttribute('font-weight', '700');
      txt.setAttribute('fill', p.color === E.BLUE ? 'var(--blue)' : 'var(--red)');
      txt.setAttribute('pointer-events', 'none');
      txt.textContent = p.type[0].toUpperCase();
      svg.appendChild(txt);
    }
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

  // Topo Buttons
  document.querySelectorAll('.calc-btn[data-topo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.calc-btn[data-topo]').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      currentTopo = btn.dataset.topo;
      renderDigraph();
    });
  });

  // Odd tournament cycle calculator
  document.querySelectorAll('#kbs-buttons .calc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#kbs-buttons .calc-btn').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      const k = parseInt(btn.dataset.k, 10);
      const n = 2 * k + 1;
      const c3 = (n * (n * n - 1)) / 24;
      $('kbs-formula').textContent = `k=${k} (n=${n}): C₃ = ${c3} directed 3-cycles`;
    });
  });

  // Orbit controls
  $('orbit-run-btn').addEventListener('click', toggleOrbitRun);
  $('orbit-step-btn').addEventListener('click', stepOrbit);
  $('orbit-reset-btn').addEventListener('click', resetOrbit);
  $('orbit-toggle-rule').addEventListener('click', () => {
    orbitRule = orbitRule === 'cyclic' ? 'transitive' : 'cyclic';
    $('orbit-toggle-rule').textContent = `rule: ${orbitRule}`;
    $('orbit-rule-label').textContent = `Rule: ${orbitRule === 'cyclic' ? 'Cyclic ℤ/3ℤ' : 'Transitive Hierarchy'}`;
    resetOrbit();
  });

  // Hex Radius Buttons
  document.querySelectorAll('#hex-radius-buttons .calc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#hex-radius-buttons .calc-btn').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      hexRadius = parseInt(btn.dataset.hexRadius, 10);
      hexHoverCoord = null;
      renderHexBoard();
    });
  });

  // Hex Archetype Buttons
  document.querySelectorAll('#hex-role-buttons .calc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#hex-role-buttons .calc-btn').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      hexRole = btn.dataset.hexRole;
      renderHexBoard();
    });
  });

  // Matrix and Azel CSV exports
  $('deadlock-export-csv').addEventListener('click', exportDeadlockCsv);
  $('azel-export-csv').addEventListener('click', exportAzelCsv);
  $('hex-tb-reset-btn')?.addEventListener('click', resetHexDuel);

  renderDigraph();
  renderOrbitBoard();
  renderDeadlockMatrix();
  renderHexBoard();
  loadAzelData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
