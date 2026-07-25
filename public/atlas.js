// Tablebase atlas. The board is the whole page: every chart, grid and node here is a way of
// putting a position onto it, and every verdict comes from the solved tables rather than from
// any evaluation invented for this screen.
//
// Rules come from engine.js exactly as they do in play, so the moves offered here are the moves
// the game would allow. The tables only supply values — never legality.
import * as E from './engine.js';
import { glyph, PIECE_STYLE_IDS } from './pieces.js';
import * as TB from './tablebase.js';
import * as L from './lab.js';
import { mountFact } from './facts.js';

const $ = (id) => document.getElementById(id);

// The atlas reads the same stored preferences the game writes, so a player's piece artwork and
// coordinate labelling follow them here. It never writes them back: this page is a reader of that
// choice, not a second place to make it.
const prefs = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('janken-cfg') || '{}') || {}; } catch { /* optional */ }
  return {
    pieceStyle: PIECE_STYLE_IDS.includes(saved.pieceStyle) ? saved.pieceStyle : 'sprite',
    coordStyle: E.COORD_STYLES.includes(saved.coordStyle) ? saved.coordStyle : 'chess',
  };
})();
const pieceGlyph = (type, color) => glyph(type, color, prefs.pieceStyle);
const square = (row, col) => E.sqName(row, col, TB.SIZE, prefs.coordStyle);
const nf = new Intl.NumberFormat('en-GB');
const pct = (x) => `${(100 * x).toFixed(x < 0.001 ? 3 : 1)}%`;
const LETTER = { rock: 'R', paper: 'P', scissors: 'S' };
const TYPES = ['rock', 'paper', 'scissors'];
const OUTCOME = ['L', 'D', 'W'];

const { index, keys } = TB.placements();
const tables = new Map();
let manifest = null;

const state = {
  variant: 'king',
  board: E.blocksBoard(TB.SIZE, 1, 'rows'),
  turn: E.BLUE,
  history: [],
  selected: null,
  lastMove: null,
  tool: null,
  lens: 'moves',
  graphDepth: 2,
  graphBest: true,
  puzzle: null,
  pendingPuzzle: false,
  spoilers: (() => {
    try { return localStorage.getItem('janken-spoilers') !== '0'; } catch { return true; }
  })(),
};

const variantOf = (id) => manifest.variants.find((v) => v.id === id);
const activeCfg = () => variantOf(state.variant).cfg;

// ── table access ─────────────────────────────────────────────────────────────
// Loading, addressing, probing and ranking all live in tablebase.js, which the analysis panel and
// the bot use too. This page keeps only its own index of which variants are in memory, because it
// is the one caller that shows several at once.
async function loadTable(id) {
  if (!tables.has(id)) tables.set(id, await TB.loadTable(id));
  return tables.get(id);
}

// A verdict from the side to move's point of view: 1 win, 0 draw, -1 loss.
const probe = (board, turn, id = state.variant) => TB.probe(tables.get(id), board, turn);

const terminalOf = (board, cfg) => E.terminalReason({ board, cfg, repetitions: {}, dry: 0 });

// Legal moves with the position each one creates already evaluated, plus the move text this page
// prints. A terminal position offers none, whatever the geometry allows.
function movesFrom(board, turn, cfg = activeCfg()) {
  return TB.movesFrom(tables.get(state.variant), board, turn, cfg).map((move) => ({
    ...move,
    san: `${LETTER[move.piece.type]}${square(move.fr, move.fc)}`
      + `${move.captured ? '×' : '–'}${square(move.tr, move.tc)}`,
  }));
}

const moverValue = TB.moverValue;
// Best first: win over draw over loss, then finish a win quickly and drag a loss out. Sorting by
// move text first makes the remaining ties read alphabetically, since the shared rank is stable.
const rankMoves = (list) => TB.rankMoves(list.slice().sort((a, b) => a.san.localeCompare(b.san)));
const isBest = (move, ranked) => ranked.length > 0
  && moverValue(move) === moverValue(ranked[0])
  && (moverValue(move) === 0 || move.after.dtm === ranked[0].after.dtm);

// ── data provenance ──────────────────────────────────────────────────────────
// Every chart on this page can hand over exactly the numbers it drew. That is not a convenience
// feature: a page that makes numeric claims and cannot produce the numbers is asking to be trusted
// instead of checked. Each entry returns the rows as drawn, not a recomputation.
const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (header, rows) => [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// The distance-to-mate distribution, counted from the table itself. Shared by the chart and its
// CSV so the two cannot disagree.
function depthCounts(id = state.variant) {
  const table = tables.get(id);
  if (!table) return null;
  const counts = new Array(variantOf(id).maxDtm + 1).fill(0);
  for (let s = 0; s < TB.STATES; s++) {
    const entry = table[s];
    if (TB.valueOf(entry) !== 0) counts[TB.dtmOf(entry)]++;
  }
  return counts;
}

const CSV_SOURCES = {
  moves: () => {
    const ranked = rankMoves(movesFrom(state.board, state.turn));
    return {
      name: `janken-3x3-${state.variant}-moves.csv`,
      header: ['move', 'piece', 'captures', 'result_for_mover', 'dtm_after', 'is_best'],
      rows: ranked.map((move) => [
        move.san, move.piece.type, move.captured ? move.captured.type : '',
        { 1: 'win', 0: 'draw', '-1': 'loss' }[String(moverValue(move))],
        move.after && moverValue(move) !== 0 ? move.after.dtm : '',
        isBest(move, ranked) ? 1 : 0,
      ]),
    };
  },
  variants: () => ({
    name: 'janken-3x3-variants.csv',
    header: ['variant', 'rules', 'win', 'draw', 'loss', 'terminals', 'edges', 'max_dtm',
      'start_value', 'fair_starts', 'fair_drawn', 'table_bytes'],
    rows: manifest.variants.map((v) => [
      v.id, v.rules, v.wdl.W, v.wdl.D, v.wdl.L, v.terminals, v.edges, v.maxDtm,
      { 1: 'win', 0: 'draw', '-1': 'loss' }[String(v.start.value)],
      v.fairStarts.count, v.fairStarts.D, v.bytes,
    ]),
  }),
  layers: () => ({
    name: `janken-3x3-${state.variant}-layers.csv`,
    header: ['pieces_captured', 'states', 'win', 'draw', 'loss'],
    rows: variantOf(state.variant).layers.map((l) => [l.m, l.states, l.W, l.D, l.L]),
  }),
  depth: () => {
    const counts = depthCounts();
    if (!counts) return null;
    return {
      name: `janken-3x3-${state.variant}-depth.csv`,
      header: ['dtm_plies', 'decided_states'],
      rows: counts.map((count, dtm) => [dtm, count]).filter(([dtm]) => dtm > 0),
    };
  },
  // The full 6×6 grid, reachable and unreachable alike. Publishing only the 36 minus 30 that a
  // layout can deal would be the biased half of the picture, and the unreachable cells are exactly
  // where the wins live.
  openings: () => ({
    name: `janken-3x3-${state.variant}-openings.csv`,
    header: ['blue_lineup', 'red_lineup', 'reachable', 'value_for_blue'],
    rows: variantOf(state.variant).lineups.flatMap((row, blue) => row.map((value, red) => [
      manifest.permutations[blue],
      manifest.permutations[red],
      manifest.permutations[red] === reversed(manifest.permutations[blue]) ? 1 : 0,
      { 1: 'win', 0: 'draw', '-1': 'loss' }[String(value)],
    ])),
  }),
  reach: () => {
    const reach = variantOf(state.variant).reachable;
    if (!reach) return null;
    return {
      name: `janken-3x3-${state.variant}-reachable.csv`,
      header: ['pieces_on_board', 'states', 'reachable_states', 'reachable_win', 'reachable_draw', 'reachable_loss'],
      rows: reach.layers.map((layer) => [layer.m, layer.states, layer.reached, layer.W, layer.D, layer.L]),
    };
  },
  simplex: () => {
    const grid = simplexData();
    if (!grid) return null;
    const rows = [];
    for (let blue = 0; blue < 8; blue++) for (let red = 0; red < 8; red++) {
      const cell = grid[blue][red];
      if (cell.states) rows.push([MASK_LABEL(blue), MASK_LABEL(red), cell.states, cell.W, cell.D, cell.L]);
    }
    return {
      name: `janken-3x3-${state.variant}-material.csv`,
      header: ['blue_types', 'red_types', 'states', 'blue_win', 'blue_draw', 'blue_loss'],
      rows,
    };
  },
  squares: () => {
    const maps = heatData();
    if (!maps) return null;
    const rows = [];
    TYPES.forEach((type, slot) => maps[slot].forEach((cell, i) => {
      rows.push([type, square((i / TB.SIZE) | 0, i % TB.SIZE), cell.states, cell.W, cell.D, cell.L]);
    }));
    return { name: `janken-3x3-${state.variant}-squares.csv`, header: ['piece', 'square', 'states', 'blue_win', 'blue_draw', 'blue_loss'], rows };
  },
  tempo: () => {
    const rows = manifest.variants.map((variant) => ({ variant, data: tempoData(variant.id) }))
      .filter((entry) => entry.data);
    if (!rows.length) return null;
    return {
      name: 'janken-3x3-tempo.csv',
      header: ['variant', 'rules', 'live_placements', 'result_independent_of_mover',
        'mover_gains', 'mover_loses', 'whoever_moves_wins', 'whoever_moves_loses'],
      rows: rows.map(({ variant, data }) => [variant.id, variant.rules, data.live, data.settled,
        data.asset, data.burden, data.wins, data.loses]),
    };
  },
  // Two judges, one column, and a `reference` field saying which judged each row — the exact one
  // on the board that is solved, a deep search everywhere else.
  search: () => (bots ? {
    name: 'janken-search-strength.csv',
    header: ['board', 'reference', 'nodes', 'positions', 'branching', 'regret_pieces',
      'regret_lo', 'regret_hi', 'best_move_rate', 'blunder_rate', 'mean_depth'],
    rows: [
      ...(bots.truth?.rows || []).map((row) => ['3x3', 'tablebase', row.nodes, row.graded, '',
        '', '', '', row.best, row.blunder, row.meanDepth]),
      ...bots.ladder.map((row) => [`${row.size}x${row.size}`, `search:${bots.method.referenceNodes}`,
        row.nodes, row.graded, row.branching, row.regret, row.regretLo, row.regretHi,
        row.best, row.blunder, row.meanDepth]),
    ],
  } : null),
  // The two lab sections are about every board size, not about one solved variant, so their
  // exports are named for the game rather than for the archetype on show.
  ladder: () => (lab ? {
    name: 'janken-state-space.csv',
    header: ['board', 'cells', 'pieces', 'placements', 'positions', 'legal_openings', 'table_bytes', 'solve_seconds'],
    rows: lab.ladder.map((rung) => [`${rung.size}x${rung.size}`, rung.cells, rung.pieces,
      rung.placements, rung.states, rung.openings, rung.solvedBytes, Math.round(rung.solveSeconds)]),
  } : null),
  blocking: () => (lab ? {
    name: 'janken-mobility.csv',
    header: ['board', 'cells', 'king_destinations_total', 'mean_per_cell', 'measured_takeable_share', 'random_games'],
    rows: lab.blocking.ceiling.map((entry) => {
      const measured = runsShown().find((run) => run.size === entry.size && run.policy === 'random');
      return [`${entry.size}x${entry.size}`, entry.cells, entry.total, entry.mean.toFixed(4),
        measured ? measured.contactRatio.toFixed(4) : '', measured ? measured.games : ''];
    }),
  } : null),
  measured: () => (lab ? {
    name: 'janken-selfplay.csv',
    header: ['board', 'policy', 'games', 'blue_wins', 'red_wins', 'draws', 'first_player_rate',
      'ci_low', 'ci_high', 'mean_plies', 'median_plies', 'mean_branching', 'capture_rate',
      'takeable_contact_share'],
    // median_plies is blank on a pooled run, because a median cannot be recovered from two
    // summaries. Blank is the honest cell; a weighted average of medians would not be.
    rows: runsShown().map((run) => [`${run.size}x${run.size}`, run.policy, run.games,
      run.blue, run.red, run.draws, run.firstPlayer.p.toFixed(4), run.firstPlayer.lo.toFixed(4),
      run.firstPlayer.hi.toFixed(4), run.meanPlies.toFixed(2), run.medianPlies ?? '',
      run.meanBranching.toFixed(3), run.captureRate.toFixed(4), run.contactRatio.toFixed(4)]),
  } : null),
};

// One button per section that has data behind it, injected rather than written into the markup so
// a chart and its export cannot drift apart in the HTML.
function wireCsvButtons() {
  for (const [key, source] of Object.entries(CSV_SOURCES)) {
    const section = document.querySelector(`.atlas-section[data-csv="${key}"]`);
    if (!section) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'csv-btn';
    button.textContent = 'csv';
    button.title = 'Download exactly the numbers this chart draws';
    button.addEventListener('click', () => {
      const data = source();
      if (!data) { button.textContent = 'not loaded'; setTimeout(() => { button.textContent = 'csv'; }, 1200); return; }
      download(data.name, new Blob([toCsv(data.header, data.rows)], { type: 'text/csv' }));
      button.textContent = 'downloaded';
      setTimeout(() => { button.textContent = 'csv'; }, 1200);
    });
    section.querySelector('.eyebrow').appendChild(button);
  }
}

// The whole thing: every table, the manifest, every chart's CSV, and the format note.
async function downloadDataPack(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'building…';
  try {
    const { zip, FORMAT_NOTE } = await import('./datapack.js');
    const members = [{ name: 'FORMAT.md', bytes: new TextEncoder().encode(FORMAT_NOTE) }];
    const manifestText = JSON.stringify(manifest, null, 2);
    members.push({ name: 'manifest.json', bytes: new TextEncoder().encode(manifestText) });
    for (const variant of manifest.variants) {
      const response = await fetch(`/tablebase/${variant.id}.tb`);
      // The gzipped artifact goes in as it is served, so a member is byte-identical to the file the
      // page itself reads.
      members.push({ name: `${variant.id}.tb`, bytes: new Uint8Array(await response.arrayBuffer()) });
    }
    if (lab) members.push({ name: 'lab.json', bytes: new TextEncoder().encode(`${JSON.stringify(lab, null, 2)}\n`) });
    if (bots) members.push({ name: 'bots.json', bytes: new TextEncoder().encode(`${JSON.stringify(bots, null, 2)}\n`) });
    for (const [key, source] of Object.entries(CSV_SOURCES)) {
      if (key === 'moves') continue;                 // position-specific, not an aggregate
      const data = source();
      if (data) members.push({ name: data.name, bytes: new TextEncoder().encode(toCsv(data.header, data.rows)) });
    }
    download('janken-3x3-data.zip', zip(members));
    button.textContent = 'downloaded';
  } catch {
    button.textContent = 'failed — try again';
  }
  setTimeout(() => { button.textContent = original; button.disabled = false; }, 1600);
}

// ── position changes ─────────────────────────────────────────────────────────
function setPosition(board, turn, { push = true, reason = '' } = {}) {
  if (push) state.history.push({ board: E.cloneBoard(state.board), turn: state.turn });
  state.board = board;
  state.turn = turn;
  state.selected = null;
  if (reason !== 'move') state.lastMove = null;
  syncHash();
  renderPosition();
}

function playMove(move) {
  judgePuzzle(move);
  state.history.push({ board: E.cloneBoard(state.board), turn: state.turn });
  state.board = move.board;
  state.turn = E.other(state.turn);
  state.lastMove = { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc };
  state.selected = null;
  syncHash();
  renderPosition();
}

function syncHash() {
  const positions = TB.positionsOf(state.board);
  if (!positions) return;
  const next = `#v=${state.variant}&p=${TB.keyOf(positions)}&t=${state.turn === E.RED ? 1 : 0}`;
  if (window.location.hash !== next) history.replaceState(null, '', next);
}

function readHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const variant = params.get('v');
  if (variant && manifest.variants.some((v) => v.id === variant)) state.variant = variant;
  // `#puzzle=daily` carries no position: the seed is the day and the variant, so the home page
  // and this one derive the same puzzle rather than passing one between them and risking drift.
  if (params.get('puzzle') === 'daily') { state.pendingPuzzle = true; return; }
  // An absent parameter must not read as placement zero — that is the empty board.
  const raw = params.get('p');
  if (raw === null) return;
  const key = Number(raw);
  if (Number.isInteger(key) && key >= 0 && key < TB.KEY_SPACE && index[key] >= 0) {
    state.board = TB.boardOf(TB.positionsFromKey(key));
    state.turn = params.get('t') === '1' ? E.RED : E.BLUE;
  }
}

// ── board ────────────────────────────────────────────────────────────────────
const cells = [];
function buildBoard() {
  const host = $('tb-board');
  host.innerHTML = '';
  for (let i = 0; i < TB.CELLS; i++) {
    const row = (i / TB.SIZE) | 0, col = i % TB.SIZE;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'tb-sq';
    cell.innerHTML = `<span class="tb-coord">${square(row, col)}</span>`
      + '<span class="pcwrap"></span><span class="dotwrap"></span>';
    cell.pieceHost = cell.querySelector('.pcwrap');
    cell.dotHost = cell.querySelector('.dotwrap');
    cell.addEventListener('click', () => clickSquare(row, col));
    host.appendChild(cell);
    cells.push(cell);
  }
}

function clickSquare(row, col) {
  if (state.tool) {
    const board = E.cloneBoard(state.board);
    if (state.tool === 'erase') board[row][col].piece = null;
    else {
      // Each side holds at most one of each type, so placing a piece moves it.
      for (const line of board) {
        for (const cell of line) {
          if (cell.piece?.type === state.tool.type && cell.piece?.color === state.tool.color) cell.piece = null;
        }
      }
      board[row][col].piece = { ...state.tool };
    }
    setPosition(board, state.turn);
    return;
  }
  const moves = movesFrom(state.board, state.turn);
  if (state.selected) {
    const move = moves.find((m) => m.fr === state.selected.r && m.fc === state.selected.c
      && m.tr === row && m.tc === col);
    if (move) { playMove(move); return; }
  }
  const piece = state.board[row][col].piece;
  state.selected = piece && piece.color === state.turn && moves.some((m) => m.fr === row && m.fc === col)
    ? { r: row, c: col }
    : null;
  renderSelection();
}

function renderBoard(ranked) {
  const selectedMoves = state.selected
    ? ranked.filter((m) => m.fr === state.selected.r && m.fc === state.selected.c)
    : [];
  for (let i = 0; i < TB.CELLS; i++) {
    const row = (i / TB.SIZE) | 0, col = i % TB.SIZE;
    const cell = cells[i];
    const piece = state.board[row][col].piece;

    const pieceKey = piece ? `${piece.type}${piece.color}` : '';
    if (cell.dataset.piece !== pieceKey) {
      cell.dataset.piece = pieceKey;
      cell.pieceHost.innerHTML = piece ? pieceGlyph(piece.type, piece.color) : '';
    }

    const move = selectedMoves.find((m) => m.tr === row && m.tc === col);
    // With answers hidden a destination is still a destination — it just stops saying how it ends.
    const tone = move ? (state.spoilers ? OUTCOME[moverValue(move) + 1] : 'N') : '';
    const dotKey = move ? `${tone}${move.captured ? 'c' : ''}` : '';
    if (cell.dataset.dot !== dotKey) {
      cell.dataset.dot = dotKey;
      cell.dotHost.innerHTML = move
        ? `<span class="dest ${tone}${move.captured ? ' cap' : ''}"></span>`
        : '';
    }

    cell.classList.toggle('sel', !!state.selected && state.selected.r === row && state.selected.c === col);
    cell.classList.toggle('from', !!state.lastMove
      && ((state.lastMove.fr === row && state.lastMove.fc === col)
        || (state.lastMove.tr === row && state.lastMove.tc === col)));
    cell.setAttribute('aria-label', `${square(row, col)} `
      + (piece ? `${piece.color === E.BLUE ? 'Blue' : 'Red'} ${piece.type}` : 'empty'));
  }
  renderArrows(ranked);
}

// A tapered shaft into a solid head, in board units where a square is 100 across. Drawn as one
// closed path so the outline can be painted behind the fill — that halo is what keeps an arrow
// legible where it crosses a piece.
function arrowShape(move) {
  const ax = move.fc * 100 + 50, ay = move.fr * 100 + 50;
  const bx = move.tc * 100 + 50, by = move.tr * 100 + 50;
  const length = Math.hypot(bx - ax, by - ay);
  if (!length) return null;
  const ux = (bx - ax) / length, uy = (by - ay) / length;
  const nx = -uy, ny = ux;
  // Clear the piece it leaves and stop short of the square it enters, so both stay readable.
  const start = Math.min(32, length * 0.3), end = Math.min(20, length * 0.2);
  const head = Math.min(22, (length - start - end) * 0.6);
  const sx = ax + ux * start, sy = ay + uy * start;
  const tx = bx - ux * end, ty = by - uy * end;
  const hx = tx - ux * head, hy = ty - uy * head;
  const at = (x, y, along, across) => `${(x + nx * across).toFixed(1)} ${(y + ny * across).toFixed(1)}`;
  return `M${at(sx, sy, 0, 3.6)}L${at(hx, hy, 0, 5.4)}L${at(hx, hy, 0, 13)}`
    + `L${tx.toFixed(1)} ${ty.toFixed(1)}`
    + `L${at(hx, hy, 0, -13)}L${at(hx, hy, 0, -5.4)}L${at(sx, sy, 0, -3.6)}Z`;
}

// With nothing selected the board shows what to play: an arrow for every move that keeps the
// best result available. Selecting a piece swaps that for its own destinations.
function renderArrows(list) {
  const group = $('arrow-group');
  const note = $('tb-key-note');
  group.innerHTML = '';
  if (!state.spoilers) {
    note.textContent = list.length
      ? 'Answers hidden: destinations are shown, but not which of them wins. Turn them back on beside the board.'
      : '';
    return;
  }
  if (state.selected || !list.length) {
    note.textContent = state.selected
      ? 'Dots mark this piece\'s legal squares, coloured the same way. A ring means a capture.'
      : '';
    return;
  }
  const best = list.filter((move) => isBest(move, list));
  // A crowd of equally good moves is information, not decoration — but it should not shout.
  const weight = best.length > 4 ? 0.5 : best.length > 2 ? 0.66 : 0.82;
  group.innerHTML = best.map((move) => {
    const shape = arrowShape(move);
    return shape
      ? `<path class="garrow ${OUTCOME[moverValue(move) + 1]}" d="${shape}" opacity="${weight}"/>`
      : '';
  }).join('');
  // The colour is the result for the side to move, and the fade counts how many moves tie for
  // best. Both are stated rather than left to be inferred from the picture.
  const word = { W: 'win', D: 'draw', L: 'loss' }[OUTCOME[moverValue(best[0]) + 1]];
  const mover = state.turn === E.BLUE ? 'Blue' : 'Red';
  note.textContent = `Shown: every move that ties for best here, ${best.length} of ${list.length} legal.`
    + ` Each is a ${word} for ${mover}, and they fade as more of them tie.`;
}

// ── verdict ──────────────────────────────────────────────────────────────────
function renderVerdict(ranked) {
  const card = $('verdict');
  const cfg = activeCfg();
  const positions = TB.positionsOf(state.board);
  const value = probe(state.board, state.turn);
  const mover = state.turn === E.BLUE ? 'Blue' : 'Red';
  const other = state.turn === E.BLUE ? 'Red' : 'Blue';
  const counts = E.pieceCounts(state.board);
  const ending = terminalOf(state.board, cfg);

  if (!positions) {
    card.className = 'verdict void';
    $('verdict-word').textContent = 'Not a position';
    $('verdict-detail').textContent = 'Each side holds at most one rock, one paper and one scissors.';
    $('verdict-facts').innerHTML = '';
    return;
  }
  if (!value) {
    card.className = 'verdict void';
    $('verdict-word').textContent = 'Loading';
    $('verdict-detail').textContent = `fetching the ${state.variant} tablebase`;
    return;
  }

  card.className = `verdict ${value.value === 1 ? 'win' : value.value === -1 ? 'loss' : 'draw'}`;
  $('verdict-word').textContent = value.value === 0 ? 'Draw'
    : value.value === 1 ? `${mover} wins` : `${other} wins`;
  $('verdict-word').style.color = value.value === 0 ? '' : `var(--${(value.value === 1 ? mover : other) === 'Blue' ? 'blue' : 'red'})`;

  $('verdict-detail').textContent = ending
    ? `Over — ${ENDINGS[ending] || ending}. ${counts.B} Blue, ${counts.R} Red.`
    : value.value === 0
      ? 'Neither side can force a result from here.'
      : `Forced in ${value.dtm} ${value.dtm === 1 ? 'ply' : 'plies'} with best play from both sides.`;

  const orbit = TB.orbitKeys(positions).size;
  $('verdict-facts').innerHTML = [
    ['to move', mover.toLowerCase()],
    ['legal moves', ranked.length],
    ['material', `${counts.B}–${counts.R}`],
    ['distance', value.value === 0 ? '—' : `${value.dtm}`],
    ['equivalents', orbit],
    ['placement', nf.format(value.placement)],
  ].map(([label, figure]) => `<div><dt>${label}</dt><dd>${figure}</dd></div>`).join('');
}

const ENDINGS = {
  elimination: 'a side has no pieces left',
  nocaptures: 'no capture is possible any more',
  immobilization: 'a side cannot move',
  territory: 'the board is full',
  majority: 'a side holds more than half the board',
};

// ── 01 move list ─────────────────────────────────────────────────────────────
function renderMoveList(ranked) {
  const host = $('movelist');
  host.innerHTML = '';
  const ending = terminalOf(state.board, activeCfg());
  if (!tables.has(state.variant)) {
    host.innerHTML = '<p class="loading">reading the tablebase</p>';
    $('movelist-note').textContent = '';
    return;
  }
  if (!ranked.length) {
    $('movelist-note').textContent = ending
      ? `This position is already over: ${ENDINGS[ending] || ending}.`
      : 'No legal moves from here.';
    return;
  }
  const listed = state.spoilers ? ranked : [...ranked].sort((a, b) => a.san.localeCompare(b.san));
  for (const move of listed) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `move-row${state.spoilers && isBest(move, ranked) ? ' best' : ''}`;
    const letter = OUTCOME[moverValue(move) + 1];
    const word = { W: 'WIN', D: 'DRAW', L: 'LOSS' }[letter];
    row.innerHTML = `${pieceGlyph(move.piece.type, move.piece.color)}`
      + `<span class="san">${move.san}</span>`
      + `<span class="tag">${move.captured ? `takes ${move.captured.type}` : 'quiet'}</span>`
      + (state.spoilers
        ? `<span class="out ${letter}">${word}${letter === 'D' ? '' : ` · ${move.after.dtm}`}</span>`
        : '<span class="out N">·</span>');
    const highlight = () => { state.selected = { r: move.fr, c: move.fc }; renderSelection(); };
    row.addEventListener('mouseenter', highlight);
    row.addEventListener('focus', highlight);
    row.addEventListener('click', () => playMove(move));
    host.appendChild(row);
  }
  const best = ranked.filter((m) => isBest(m, ranked)).length;
  $('movelist-note').textContent = state.spoilers
    ? `${best} of ${ranked.length} ${best === 1 ? 'move keeps' : 'moves keep'} `
      + 'the best result available; the rest give something away.'
    : `${ranked.length} legal moves. Answers are hidden, so the order here is alphabetical rather `
      + 'than ranked — nothing on this page is telling you which one is right.';
}

// ── mini boards, used by every gallery on the page ──────────────────────────
function miniBoard(positions, className = '') {
  const cellsHtml = new Array(TB.CELLS).fill('<i></i>');
  for (let slot = 0; slot < 6; slot++) {
    if (positions[slot] < 0) continue;
    cellsHtml[positions[slot]] = `<i class="${slot < 3 ? 'b' : 'r'}">${'RPS'[slot % 3]}</i>`;
  }
  return `<button type="button" class="mini-board ${className}">${cellsHtml.join('')}</button>`;
}

// ── 02 openings ──────────────────────────────────────────────────────────────
// Layouts are 180°-rotationally symmetric, so Red always mirrors Blue. These are the only
// positions a game can begin from.
const FAIR_STARTS = (() => {
  const found = [];
  for (let p = 0; p < TB.PLACEMENTS; p++) {
    const positions = TB.positionsFromKey(keys[p]);
    if (positions.some((square) => square < 0)) continue;
    if ([0, 1, 2].every((slot) => positions[slot + 3] === TB.CELLS - 1 - positions[slot])) found.push(positions);
  }
  return found;
})();

function renderGallery() {
  const host = $('fair-gallery');
  if (host.childElementCount) return;                       // static; build once
  host.innerHTML = FAIR_STARTS.map((positions) => miniBoard(positions)).join('');
  [...host.children].forEach((button, i) => {
    button.title = 'load this opening';
    button.addEventListener('click', () => setPosition(TB.boardOf(FAIR_STARTS[i]), E.BLUE));
  });
}

const reversed = (label) => [...label].reverse().join('');

function renderOpeningGrid() {
  const variant = variantOf(state.variant);
  const host = $('opening-grid');
  const [shippedBlue, shippedRed] = manifest.startLineup;
  const reachable = [], unreachable = { W: 0, D: 0, L: 0 };
  let html = '<div class="oh"></div>';
  for (const label of manifest.permutations) html += `<div class="oh">${label}</div>`;
  for (let blue = 0; blue < 6; blue++) {
    html += `<div class="oh">${manifest.permutations[blue]}</div>`;
    for (let red = 0; red < 6; red++) {
      const value = variant.lineups[blue][red];
      // Reachable exactly when Red's column is Blue's reversed — that is what a 180° turn does.
      const legal = manifest.permutations[red] === reversed(manifest.permutations[blue]);
      if (legal) reachable.push(value); else unreachable[OUTCOME[value + 1]]++;
      const shipped = blue === shippedBlue && red === shippedRed;
      html += `<button type="button" class="opening-cell ${OUTCOME[value + 1]}`
        + `${legal ? ' legal' : ''}${shipped ? ' shipped' : ''}" data-b="${blue}" data-r="${red}"`
        + ` title="Blue ${manifest.permutations[blue]} vs Red ${manifest.permutations[red]}`
        + `${legal ? ' — reachable' : ' — no layout deals this'}">${OUTCOME[value + 1]}</button>`;
    }
  }
  host.innerHTML = html;
  // State the resolution in figures, so the grid's wins never have to be taken on trust.
  const drawn = reachable.filter((value) => value === 0).length;
  $('opening-note').textContent = `${reachable.length} of 36 pairings are ones a layout can deal, `
    + `and ${drawn === reachable.length ? 'every one is drawn' : `${drawn} of them are drawn`}. `
    + `The unreachable 30 split ${unreachable.W} won, ${unreachable.D} drawn, ${unreachable.L} lost — `
    + 'those are the wins and losses you can see. The ringed cell is the layout Skirmish deals.';
  for (const button of host.querySelectorAll('.opening-cell')) {
    button.addEventListener('click', () => {
      const positions = [-1, -1, -1, -1, -1, -1];
      const blue = PERMS[+button.dataset.b], red = PERMS[+button.dataset.r];
      for (let row = 0; row < TB.SIZE; row++) {
        positions[blue[row]] = row * TB.SIZE;
        positions[3 + red[row]] = row * TB.SIZE + TB.SIZE - 1;
      }
      setPosition(TB.boardOf(positions), E.BLUE);
    });
  }
}
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// ── 03 variants ──────────────────────────────────────────────────────────────
function renderVariantList() {
  const host = $('variant-list');
  host.innerHTML = manifest.variants.map((variant) => {
    const { W, D, L } = variant.wdl;
    const total = W + D + L;
    return `<button type="button" class="variant-row${variant.id === state.variant ? ' on' : ''}" data-v="${variant.id}">
      <span class="name">${variant.label}<small>${E.MOVEMENT_DESCRIPTIONS?.[variant.id] || variant.rules.split(' · ')[1]}</small></span>
      <span class="track"><span class="tb-bar"><i class="w" style="width:${100 * W / total}%"></i><i class="d" style="width:${100 * D / total}%"></i><i class="l" style="width:${100 * L / total}%"></i></span></span>
      <span class="figs">${pct(W / total)} · ${pct(D / total)} · ${pct(L / total)}<br>deepest ${variant.maxDtm}</span>
    </button>`;
  }).join('') + '<div class="tb-legend" style="padding:8px 13px;background:var(--bg)">'
    + '<span><i class="w"></i>mover wins</span><span><i class="d"></i>draw</span><span><i class="l"></i>mover loses</span></div>';
  for (const button of host.querySelectorAll('[data-v]')) {
    button.addEventListener('click', () => selectVariant(button.dataset.v));
  }
}

async function selectVariant(id) {
  if (id === state.variant) return;
  state.variant = id;
  state.selected = null;
  $('stage-rules').textContent = variantOf(id).rules;
  renderVariantList();
  syncHash();
  renderPosition();
  await ensureTable(id);
  renderPosition();
  renderOpeningGrid();
  renderHistogram();
  renderReach();
  // These two are per-variant and cached, so re-rendering is a lookup unless this is the first
  // time the archetype has been looked at through them.
  if (simplexCache.has(id) || $('simplex-grid').childElementCount) renderSimplex();
  if (heatCache.has(id) || $('heatgrid').childElementCount) renderHeatmap();
  if (tempoCache.size) renderTempo();
}

let crossLoading = null;
function renderCrossCheck() {
  const host = $('crosscheck');
  host.innerHTML = manifest.variants.map((variant) => {
    const value = probe(state.board, state.turn, variant.id);
    const letter = value ? OUTCOME[value.value + 1] : '';
    return `<div class="cc-cell${value ? '' : ' pending'}">
      <span class="cc-name">${variant.label}</span>
      <span class="cc-out ${letter}">${value ? { W: 'WIN', D: 'DRAW', L: 'LOSS' }[letter] : '—'}</span>
      <span class="cc-name mono">${value && value.value ? `${value.dtm} plies` : value ? 'unforced' : 'loading'}</span>
    </div>`;
  }).join('');
  const mover = state.turn === E.BLUE ? 'Blue' : 'Red';
  $('crosscheck-lede').textContent = `The position on the board, ${mover} to move, evaluated by all `
    + 'seven tablebases at once. Same pieces, same squares — only the movement rule differs.';
}

// The cross-check is the one view that needs every table, so it fetches them the first time
// the section is reached rather than making the page pay for them upfront.
function loadAllTables() {
  if (crossLoading) return crossLoading;
  crossLoading = (async () => {
    for (const variant of manifest.variants) {
      if (tables.has(variant.id)) continue;
      try { await loadTable(variant.id); } catch { /* a missing variant just stays blank */ }
      renderCrossCheck();
      renderTempo();                  // one more table is one more row in the tempo census
    }
    renderDeepest();
  })();
  return crossLoading;
}

// ── 04 material ──────────────────────────────────────────────────────────────
function renderWaterfall() {
  const variant = variantOf(state.variant);
  const host = $('waterfall');
  host.innerHTML = variant.layers.slice().reverse().map((layer) => {
    const total = layer.states || 1;
    return `<button type="button" class="layer-row" data-m="${layer.m}">
      <span class="lname">${layer.m} ${layer.m === 1 ? 'piece' : 'pieces'}</span>
      <span class="track"><span class="tb-bar"><i class="w" style="width:${100 * layer.W / total}%"></i><i class="d" style="width:${100 * layer.D / total}%"></i><i class="l" style="width:${100 * layer.L / total}%"></i></span></span>
      <span class="lcount">${nf.format(layer.states)}</span>
    </button>`;
  }).join('');
  for (const button of host.querySelectorAll('[data-m]')) {
    button.addEventListener('click', () => loadRandomFromLayer(+button.dataset.m));
  }
}

// Reservoir sampling over the whole layer. Collecting the first N matches instead would only
// ever offer positions from the front of the enumeration, which is far from a random one.
function loadRandomFromLayer(material) {
  let chosen = null, seen = 0;
  for (let p = 0; p < TB.PLACEMENTS; p++) {
    const positions = TB.positionsFromKey(keys[p]);
    if (positions.filter((square) => square >= 0).length !== material) continue;
    seen++;
    if (Math.random() * seen < 1) chosen = positions;
  }
  if (chosen) setPosition(TB.boardOf(chosen), state.turn);
}

// ── 05 depth ─────────────────────────────────────────────────────────────────
function renderHistogram() {
  const host = $('histogram');
  const counts = depthCounts();
  if (!counts) { host.innerHTML = '<p class="loading">reading the table</p>'; return; }
  const variant = variantOf(state.variant);
  const peak = Math.max(...counts, 1);
  host.innerHTML = counts.map((count, dtm) => (dtm === 0 ? '' : `<button type="button" class="hbar${dtm === variant.maxDtm ? ' tall' : ''}" data-d="${dtm}"
      title="${nf.format(count)} positions forced in ${dtm}"><i style="height:${Math.max(1, 100 * count / peak)}%"></i>${dtm % 4 === 0 || dtm === variant.maxDtm ? `<span>${dtm}</span>` : ''}</button>`)).join('');
  for (const button of host.querySelectorAll('[data-d]')) {
    button.addEventListener('click', () => loadByDepth(+button.dataset.d));
  }
}

function loadByDepth(dtm, id = state.variant) {
  const table = tables.get(id);
  if (!table) return;
  let chosen = -1, seen = 0;
  for (let s = 0; s < TB.STATES; s++) {
    if (TB.valueOf(table[s]) === 0 || TB.dtmOf(table[s]) !== dtm) continue;
    seen++;
    if (Math.random() * seen < 1) chosen = s;
  }
  if (chosen < 0) return;
  setPosition(TB.boardOf(TB.positionsFromKey(keys[chosen >> 1])), (chosen & 1) ? E.RED : E.BLUE);
}

function renderDeepest() {
  const host = $('deepest');
  host.innerHTML = manifest.variants.slice().sort((a, b) => b.maxDtm - a.maxDtm).map((variant) => `
    <button type="button" class="deep-row" data-v="${variant.id}" data-d="${variant.maxDtm}">
      <span class="dname">${variant.label}<small>${E.MOVEMENT_DESCRIPTIONS[variant.id]}</small></span>
      <span class="dply">${variant.maxDtm} plies</span>
    </button>`).join('');
  for (const button of host.querySelectorAll('[data-v]')) {
    button.addEventListener('click', async () => {
      await selectVariant(button.dataset.v);
      await ensureTable(button.dataset.v);
      loadByDepth(+button.dataset.d, button.dataset.v);
    });
  }
}

// ── 06 symmetry ──────────────────────────────────────────────────────────────
function renderSymmetry() {
  const positions = TB.positionsOf(state.board);
  const host = $('sym-strip');
  if (!positions) { host.innerHTML = '<p class="note">Place a legal position to see its orbit.</p>'; return; }
  const original = TB.keyOf(positions);
  const seen = new Set();
  const shown = [];
  for (let map = 0; map < TB.SQUARE_MAPS.length; map++) {
    for (let spin = 0; spin < 3; spin++) {
      const moved = TB.transformPositions(positions, TB.SQUARE_MAPS[map], spin);
      const key = TB.keyOf(moved);
      if (seen.has(key)) continue;
      seen.add(key);
      shown.push({ moved, key, label: `${TB.SYMMETRY_LABELS[map]}${spin ? ` +${spin}` : ''}` });
    }
  }
  host.innerHTML = shown.map(({ moved, key, label }) => `<div class="sym-cell${key === original ? ' same' : ''}">`
    + `${miniBoard(moved)}<span class="sym-label">${label}</span></div>`).join('');
  [...host.querySelectorAll('.mini-board')].forEach((button, i) => {
    button.addEventListener('click', () => setPosition(TB.boardOf(shown[i].moved), state.turn));
  });

  const value = probe(state.board, state.turn);
  $('sym-facts').innerHTML = [
    ['Positions in this orbit', shown.length],
    ['Symmetries that fix it', 24 / shown.length],
    ['Verdict across the orbit', value ? { W: 'win', D: 'draw', L: 'loss' }[OUTCOME[value.value + 1]] : '—'],
    ['Placement orbits in total', nf.format(8697)],
  ].map(([label, figure]) => `<div class="fact"><span>${label}</span><b>${figure}</b></div>`).join('');
}

// ── 07 graph ─────────────────────────────────────────────────────────────────
const NODE = 38, COL_GAP = 108, ROW_GAP = 50, MAX_NODES = 240;
const view = { x: 0, y: 0, k: 1 };

// Two lines that reach the same position up to symmetry are the same line, so nodes merge on
// the canonical key. The picture keeps whichever orientation was reached first, so a node still
// looks like the board it came from.
function canonicalKey(positions) {
  let best = Infinity;
  for (const map of TB.SQUARE_MAPS) {
    for (let spin = 0; spin < 3; spin++) {
      const key = TB.keyOf(TB.transformPositions(positions, map, spin));
      if (key < best) best = key;
    }
  }
  return best;
}

function buildCone() {
  const cfg = activeCfg();
  const root = TB.positionsOf(state.board);
  if (!root || !tables.has(state.variant)) return null;
  const nodes = new Map();
  const edges = [];
  const keyFor = (positions, turn) => `${canonicalKey(positions)}:${turn}`;

  const add = (positions, turn, depth) => {
    const key = keyFor(positions, turn);
    if (nodes.has(key)) return nodes.get(key);
    const board = TB.boardOf(positions);
    const value = probe(board, turn);
    const node = { key, positions, turn, depth, board, value, x: 0, y: 0 };
    nodes.set(key, node);
    return node;
  };

  let frontier = [add(root, state.turn, 0)];
  for (let depth = 0; depth < state.graphDepth; depth++) {
    const next = [];
    for (const node of frontier) {
      if (nodes.size >= MAX_NODES) break;
      const moves = movesFrom(node.board, node.turn, cfg);
      const ranked = rankMoves(moves);
      const chosen = state.graphBest ? ranked.filter((m) => isBest(m, ranked)) : ranked;
      for (const move of chosen) {
        if (nodes.size >= MAX_NODES) break;
        const positions = TB.positionsOf(move.board);
        const child = add(positions, E.other(node.turn), depth + 1);
        if (child.depth === depth + 1 && !edges.some((e) => e.from === node.key && e.to === child.key)) {
          edges.push({ from: node.key, to: child.key, capture: !!move.captured, san: move.san });
          if (!next.includes(child)) next.push(child);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  // Layout: one column per depth, spaced evenly, then a few passes that reorder each column by
  // the average height of its parents. Deterministic — no physics, so it never jitters or
  // settles differently on a redraw.
  const byDepth = [];
  for (const node of nodes.values()) (byDepth[node.depth] ||= []).push(node);
  const spread = (column) => column.forEach((node, i) => {
    node.y = (i - (column.length - 1) / 2) * ROW_GAP;
  });
  byDepth.forEach(spread);

  const parentYs = new Map();
  for (const edge of edges) {
    if (!parentYs.has(edge.to)) parentYs.set(edge.to, []);
    parentYs.get(edge.to).push(edge.from);
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let depth = 1; depth < byDepth.length; depth++) {
      const centre = (node) => {
        const list = parentYs.get(node.key);
        if (!list || !list.length) return node.y;
        return list.reduce((sum, key) => sum + nodes.get(key).y, 0) / list.length;
      };
      byDepth[depth].sort((a, b) => centre(a) - centre(b));
      spread(byDepth[depth]);
    }
  }
  for (const node of nodes.values()) node.x = node.depth * COL_GAP;

  return { nodes, edges, depth: byDepth.length };
}

let cone = null;
function renderGraph() {
  cone = buildCone();
  const nodesHost = $('graph-nodes'), edgesHost = $('graph-edges');
  const empty = $('graph-empty');
  if (!cone || cone.nodes.size <= 1) {
    nodesHost.innerHTML = ''; edgesHost.innerHTML = '';
    empty.hidden = false;
    empty.textContent = cone ? 'This position is over — nothing follows from it.' : 'Loading the tablebase…';
    $('graph-note').textContent = '';
    return;
  }
  empty.hidden = true;

  edgesHost.innerHTML = [...cone.edges].map((edge) => {
    const from = cone.nodes.get(edge.from), to = cone.nodes.get(edge.to);
    const x1 = from.x + NODE, y1 = from.y + NODE / 2, x2 = to.x, y2 = to.y + NODE / 2;
    const mid = (x1 + x2) / 2;
    return `<path class="gedge${edge.capture ? ' cap' : ''}" data-from="${edge.from}" data-to="${edge.to}"
      d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}"><title>${edge.san}</title></path>`;
  }).join('');

  nodesHost.innerHTML = [...cone.nodes.values()].map((node) => {
    const letter = node.value ? OUTCOME[node.value.value + 1] : 'D';
    const squares = [];
    for (let i = 0; i < TB.CELLS; i++) {
      const x = 4 + (i % 3) * 10, y = 4 + (((i / 3) | 0)) * 10;
      squares.push(`<rect class="grid" x="${x}" y="${y}" width="9" height="9"/>`);
    }
    for (let slot = 0; slot < 6; slot++) {
      const square = node.positions[slot];
      if (square < 0) continue;
      const x = 4 + (square % 3) * 10, y = 4 + (((square / 3) | 0)) * 10;
      squares.push(`<rect class="cell${slot < 3 ? 'b' : 'r'}" x="${x + 1.5}" y="${y + 1.5}" width="6" height="6" rx="1"/>`);
    }
    return `<g class="gnode ${letter}${node.depth === 0 ? ' root' : ''}" data-key="${node.key}"
      transform="translate(${node.x} ${node.y})">
      <rect class="plate" x="0" y="0" width="${NODE}" height="${NODE}" rx="3"/>
      ${squares.join('')}
      <rect class="rim" x="4" y="34.5" width="30" height="3" rx="1.5"/>
      <title>${{ W: 'win', D: 'draw', L: 'loss' }[letter]} for ${node.turn === E.BLUE ? 'Blue' : 'Red'}${node.value && node.value.value ? ` in ${node.value.dtm}` : ''}</title>
    </g>`;
  }).join('');

  for (const element of nodesHost.querySelectorAll('.gnode')) {
    const node = cone.nodes.get(element.dataset.key);
    element.addEventListener('click', () => setPosition(TB.boardOf(node.positions), node.turn));
    element.addEventListener('mouseenter', () => litPath(node.key));
    element.addEventListener('mouseleave', () => litPath(null));
  }

  $('graph-note').textContent = `${cone.nodes.size} distinct positions, ${cone.edges.length} moves`
    + `${cone.nodes.size >= MAX_NODES ? ` (capped at ${MAX_NODES} — reduce the depth)` : ''}`
    + `, merged where symmetry makes two lines the same.`;
  fitGraph();
}

function litPath(key) {
  const wanted = new Set();
  if (key) {
    let frontier = [key];
    while (frontier.length) {
      const next = [];
      for (const edge of cone.edges) {
        if (!frontier.includes(edge.to)) continue;
        wanted.add(`${edge.from}>${edge.to}`);
        next.push(edge.from);
      }
      frontier = next;
    }
  }
  for (const path of $('graph-edges').children) {
    path.classList.toggle('lit', wanted.has(`${path.dataset.from}>${path.dataset.to}`));
  }
}

function applyView() {
  $('graph-view').setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
}

function fitGraph() {
  if (!cone || !cone.nodes.size) return;
  const list = [...cone.nodes.values()];
  const minX = Math.min(...list.map((n) => n.x)) - 14;
  const maxX = Math.max(...list.map((n) => n.x)) + NODE + 14;
  const minY = Math.min(...list.map((n) => n.y)) - 14;
  const maxY = Math.max(...list.map((n) => n.y)) + NODE + 14;
  const frame = $('graph-svg').getBoundingClientRect();
  if (!frame.width || !frame.height) return;               // not laid out yet
  view.k = Math.min(frame.width / (maxX - minX), frame.height / (maxY - minY), 2.4);
  view.x = (frame.width - (maxX - minX) * view.k) / 2 - minX * view.k;
  view.y = (frame.height - (maxY - minY) * view.k) / 2 - minY * view.k;
  applyView();
}

function wireGraphViewport() {
  const svg = $('graph-svg');
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = Math.min(4, Math.max(0.25, view.k * factor));
    // Keep whatever is under the pointer under the pointer.
    view.x = px - (px - view.x) * (next / view.k);
    view.y = py - (py - view.y) * (next / view.k);
    view.k = next;
    applyView();
  }, { passive: false });

  let dragging = null;
  svg.addEventListener('pointerdown', (event) => {
    dragging = { x: event.clientX - view.x, y: event.clientY - view.y, id: event.pointerId, moved: false };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    view.x = event.clientX - dragging.x;
    view.y = event.clientY - dragging.y;
    if (!dragging.moved) { dragging.moved = true; svg.classList.add('dragging'); }
    applyView();
  });
  const stop = () => {
    if (!dragging) return;
    svg.releasePointerCapture(dragging.id);
    // A pan that ends over a node must not also load that node.
    if (dragging.moved) svg.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });
    dragging = null;
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
}

// ── 08 puzzles ───────────────────────────────────────────────────────────────
// A solved game can set its own exercises, and mark them. Nothing here evaluates anything: the
// question comes from a won entry in the table and the answer is whatever `topMoves` says, so a
// puzzle cannot be wrong in the way a generated-by-an-engine puzzle can.
const puzzleStore = () => {
  try { return JSON.parse(localStorage.getItem('janken-puzzle') || '{}') || {}; } catch { return {}; }
};
const savePuzzle = (data) => {
  try { localStorage.setItem('janken-puzzle', JSON.stringify(data)); } catch { /* optional */ }
};
const todayKey = () => TB.puzzleDay();

// The board tells you the answer: destinations are tinted by result and the arrows point at the
// best move. That is the whole point of the page and exactly wrong while a puzzle is open, so it
// is a toggle rather than a special case — a reader can also just turn it off and try any position.
function setSpoilers(on) {
  state.spoilers = !!on;
  try { localStorage.setItem('janken-spoilers', on ? '1' : '0'); } catch { /* optional */ }
  const button = $('spoiler-btn');
  if (button) {
    button.classList.toggle('on', state.spoilers);
    button.textContent = state.spoilers ? 'answers shown' : 'answers hidden';
    button.setAttribute('aria-pressed', String(state.spoilers));
    button.title = state.spoilers
      ? 'Hide the result colouring, the best-move arrows and the ranking'
      : 'Show which moves win, lose and draw';
  }
  if (manifest) renderPosition();
}

function loadPuzzle(kind, { scroll = true } = {}) {
  const table = tables.get(state.variant);
  const cfg = activeCfg();
  const puzzle = kind === 'daily'
    ? TB.dailyPuzzle(table, cfg, state.variant)
    : TB.findPuzzle(table, cfg, TB.rngFrom((Math.random() * 0xffffffff) >>> 0));
  if (!puzzle) { $('puzzle-state').textContent = 'No puzzle in this variant yet — pick another rule set.'; return; }
  state.puzzle = {
    kind, dtm: puzzle.dtm, turn: puzzle.turn, moves: puzzle.best.length, done: false, failed: false,
  };
  // Answers off while a puzzle is live, or the board is already pointing at the solution.
  setSpoilers(false);
  setPosition(puzzle.board, puzzle.turn);
  renderPuzzle();
  if (scroll) document.getElementById('puzzles').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Marking happens on the way through playMove, so a puzzle move and an exploring move are the
// same action — you are never asked to press "submit".
function judgePuzzle(move) {
  const puzzle = state.puzzle;
  if (!puzzle || puzzle.done || state.turn !== puzzle.turn) return;
  const correct = isBest(move, ranked);
  puzzle.done = true;
  puzzle.failed = !correct;
  setSpoilers(true);                              // the answer is no longer worth hiding
  if (puzzle.kind !== 'daily') return;
  const store = puzzleStore();
  if (store.day === todayKey()) return;                 // today already counted
  const streak = correct ? (store.streak || 0) + 1 : 0;
  savePuzzle({ day: todayKey(), streak, best: Math.max(streak, store.best || 0) });
}

function renderPuzzle() {
  const puzzle = state.puzzle;
  const store = puzzleStore();
  $('puzzle-tag').textContent = puzzle?.kind === 'daily' ? `daily · ${todayKey()}` : 'random';
  if (!puzzle) {
    $('puzzle-ask').textContent = 'Pick a puzzle';
    $('puzzle-state').textContent = 'The board holds whatever you left on it.';
  } else {
    const side = puzzle.turn === E.BLUE ? 'Blue' : 'Red';
    $('puzzle-ask').textContent = `${side} to play and win in ${puzzle.dtm}`;
    $('puzzle-state').textContent = !puzzle.done
      ? `${puzzle.moves === 1 ? 'One move' : `${puzzle.moves} moves`} keeps the win. Play it on the board.`
      : puzzle.failed
        ? 'That move gives the win away. The board has moved on — undo to try again.'
        : 'Correct: the win survives.';
  }
  $('puzzle-state').className = `puzzle-state${puzzle?.done ? (puzzle.failed ? ' wrong' : ' right') : ''}`;
  $('puzzle-streak').textContent = store.streak
    ? `daily streak ${store.streak}${store.best > store.streak ? ` · best ${store.best}` : ''}`
    : '';
}

// ── 09 reachable play ────────────────────────────────────────────────────────
function renderReach() {
  const variant = variantOf(state.variant);
  const reach = variant.reachable;
  if (!reach) return;
  const share = reach.states / TB.STATES;
  $('reach-headline').textContent = `${nf.format(reach.states)}, ${pct(share)}`;
  $('reach-deals').textContent = nf.format(variant.fairStarts.count);

  const whole = variant.wdl;
  const decided = (set) => (set.W + set.L) / (set.W + set.D + set.L);
  // The spread across archetypes is the real finding here, and it is not subtle: a king can walk
  // its army anywhere, so almost every arrangement is reachable, while a bishop never leaves its
  // colour complex and a knight never leaves its parity. Same board, same pieces, and one game
  // can enter twenty times as much of it as another.
  const ranked = manifest.variants
    .filter((entry) => entry.reachable)
    .sort((a, b) => b.reachable.states - a.reachable.states);
  const spread = ranked.length > 1
    ? ` Across the seven archetypes this ranges from ${pct(ranked[0].reachable.states / TB.STATES)} `
      + `(${ranked[0].label.toLowerCase()}) down to ${pct(ranked.at(-1).reachable.states / TB.STATES)} `
      + `(${ranked.at(-1).label.toLowerCase()}), which is what movement geometry costs: a piece bound `
      + `to one colour complex or one parity can never assemble most of the positions the board allows.`
    : '';
  $('reach-verdicts').textContent = `Across the whole table ${pct(decided(whole))} of positions are `
    + `decided; across the reachable ones ${pct(decided(reach.wdl))}. `
    + (decided(reach.wdl) < decided(whole)
      ? 'The wins concentrate in positions no deal can produce.'
      : 'Reachable play is the more decisive half of the table.')
    + spread;

  const widest = Math.max(...reach.layers.map((layer) => layer.states)) || 1;
  $('reachbars').innerHTML = reach.layers.map((layer) => {
    const total = layer.states;
    const hit = total ? layer.reached / total : 0;
    return `<div class="reachrow">
      <span class="rr-label">${layer.m} piece${layer.m === 1 ? '' : 's'}</span>
      <span class="rr-track" style="--w:${(100 * total / widest).toFixed(2)}%">
        <span class="rr-total"></span>
        <span class="rr-hit" style="--h:${(100 * hit).toFixed(2)}%"></span>
      </span>
      <span class="rr-figure">${pct(hit)}</span>
      <span class="rr-count mono">${nf.format(layer.reached)} / ${nf.format(total)}</span>
    </div>`;
  }).join('');
}

// ── material census, shared by 10 and 11 ─────────────────────────────────────
// Which types each side still holds, per placement. Built once and reused: the two sections that
// need it both walk the whole table, and rebuilding a 200k-entry index twice would be felt.
let censusCache = null;
function census() {
  if (censusCache) return censusCache;
  const blue = new Uint8Array(TB.PLACEMENTS), red = new Uint8Array(TB.PLACEMENTS);
  for (let p = 0; p < TB.PLACEMENTS; p++) {
    const positions = TB.positionsFromKey(keys[p]);
    let b = 0, r = 0;
    for (let slot = 0; slot < 6; slot++) {
      if (positions[slot] < 0) continue;
      if (slot < 3) b |= 1 << slot; else r |= 1 << (slot - 3);
    }
    blue[p] = b; red[p] = r;
  }
  return (censusCache = { blue, red });
}
const MASK_LABEL = (mask) => (mask ? TYPES.filter((_, i) => mask & (1 << i)).map((t) => LETTER[t]).join('') : '—');

// ── 10 the shape of material ─────────────────────────────────────────────────
const simplexCache = new Map();
function simplexData(id = state.variant) {
  if (simplexCache.has(id)) return simplexCache.get(id);
  const table = tables.get(id);
  if (!table) return null;
  const { blue, red } = census();
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ states: 0, W: 0, D: 0, L: 0, sample: -1 })));
  for (let p = 0; p < TB.PLACEMENTS; p++) {
    const cell = grid[blue[p]][red[p]];
    const value = TB.valueOf(table[p * 2]);                 // always Blue to move, so the grid reads one way
    cell.states++;
    cell[value === 1 ? 'W' : value === -1 ? 'L' : 'D']++;
    if (cell.sample < 0 || (p % 977) === 0) cell.sample = p;
  }
  simplexCache.set(id, grid);
  return grid;
}

function renderSimplex() {
  const grid = simplexData();
  if (!grid) return;
  const masks = [7, 3, 5, 6, 1, 2, 4, 0];                   // richest first, so the live game sits top-left
  const head = `<span class="sx-corner">Blue \\ Red</span>`
    + masks.map((mask) => `<span class="sx-head">${MASK_LABEL(mask)}</span>`).join('');
  const body = masks.map((blueMask) => `<span class="sx-head row">${MASK_LABEL(blueMask)}</span>`
    + masks.map((redMask) => {
      const cell = grid[blueMask][redMask];
      if (!cell.states) return '<span class="sx-cell empty"></span>';
      const edge = (cell.W - cell.L) / cell.states;
      const tone = edge >= 0 ? 'win' : 'loss';
      return `<button type="button" class="sx-cell ${tone}" data-placement="${cell.sample}"
        style="--k:${Math.abs(edge).toFixed(3)}"
        title="Blue ${MASK_LABEL(blueMask)} vs Red ${MASK_LABEL(redMask)} — ${nf.format(cell.states)} positions, Blue wins ${pct(cell.W / cell.states)}, draws ${pct(cell.D / cell.states)}, loses ${pct(cell.L / cell.states)}"
        >${(100 * edge).toFixed(0)}</button>`;
    }).join('')).join('');
  $('simplex-grid').innerHTML = head + body;
  for (const button of $('simplex-grid').querySelectorAll('[data-placement]')) {
    button.addEventListener('click', () => {
      setPosition(TB.boardOf(TB.positionsFromKey(keys[+button.dataset.placement])), E.BLUE);
    });
  }
  const dead = grid[1][1].states + grid[2][2].states + grid[4][4].states;
  $('simplex-note').textContent = `Each cell is Blue's win share minus its loss share, over every position `
    + `with that material and Blue to move. The three cells on the diagonal where both sides hold one `
    + `matching type — R vs R, P vs P, S vs S — are ${nf.format(dead)} positions in which no capture is `
    + `possible at all, and the game is over before it starts.`;
}

// ── 11 what a square is worth ────────────────────────────────────────────────
const heatCache = new Map();
function heatData(id = state.variant) {
  if (heatCache.has(id)) return heatCache.get(id);
  const table = tables.get(id);
  if (!table) return null;
  const maps = TYPES.map(() => Array.from({ length: TB.CELLS }, () => ({ states: 0, W: 0, D: 0, L: 0 })));
  for (let p = 0; p < TB.PLACEMENTS; p++) {
    const positions = TB.positionsFromKey(keys[p]);
    const value = TB.valueOf(table[p * 2]);
    for (let slot = 0; slot < 3; slot++) {
      if (positions[slot] < 0) continue;
      const cell = maps[slot][positions[slot]];
      cell.states++;
      cell[value === 1 ? 'W' : value === -1 ? 'L' : 'D']++;
    }
  }
  heatCache.set(id, maps);
  return maps;
}

function renderHeatmap() {
  const maps = heatData();
  if (!maps) return;
  const all = maps.flat();
  const edges = all.map((cell) => (cell.states ? (cell.W - cell.L) / cell.states : 0));
  const span = Math.max(...edges.map(Math.abs)) || 1;
  $('heatgrid').innerHTML = TYPES.map((type, slot) => {
    const squares = maps[slot].map((cell, i) => {
      const edge = cell.states ? (cell.W - cell.L) / cell.states : 0;
      return `<button type="button" class="ht-sq ${edge >= 0 ? 'win' : 'loss'}"
        style="--k:${(Math.abs(edge) / span).toFixed(3)}"
        title="${PIECE_WORD[type]} on ${square((i / TB.SIZE) | 0, i % TB.SIZE)} — ${nf.format(cell.states)} positions, Blue wins ${pct(cell.W / (cell.states || 1))}"
        >${(100 * edge).toFixed(0)}</button>`;
    }).join('');
    return `<figure class="heat"><figcaption>${pieceGlyph(type, E.BLUE)}<span>${PIECE_WORD[type]}</span></figcaption>
      <div class="ht-board">${squares}</div></figure>`;
  }).join('');
  const best = edges.indexOf(Math.max(...edges));
  const type = TYPES[(best / TB.CELLS) | 0], at = best % TB.CELLS;
  const nine = lab?.ladder.find((rung) => rung.size === 9);
  $('heat-note').textContent = `Blue's win share minus its loss share, over every position with that `
    + `piece on that square and Blue to move. The strongest square in these rules is `
    + `${PIECE_WORD[type].toLowerCase()} on ${square((at / TB.SIZE) | 0, at % TB.SIZE)}, and the `
    + `spread across the whole board is ${(100 * (Math.max(...edges) - Math.min(...edges))).toFixed(0)} `
    + `points. A value map this small is complete rather than estimated`
    + (nine ? `: the same picture on a 9×9 needs the table from section 13, which is ${HUMAN_TIME(nine.solveSeconds)} of solving.` : '.');
}
const PIECE_WORD = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };

// ── 12 the value of the move ─────────────────────────────────────────────────
// Every placement is in the table twice, once with each side to move, and the two entries need
// not agree. Comparing them answers something no evaluation function can be asked: is having to
// move an advantage or a liability? Read from Blue's side, a placement where Blue does better
// with the move than without it is one where *whoever* has the move does better — the same
// comparison, seen from either chair. When it runs the other way the side to move would rather
// pass, which is zugzwang, and the game offers no way to.
//
// The population is stated rather than assumed: placements where both sides still hold a piece
// and the types present still allow some capture. Everything else is a finished game, and a
// finished game has the same result whoever is nominally to move.
const tempoCache = new Map();

// Whether a capture is still possible for a given pair of surviving type sets. Sixty-four
// answers, each one asked of the engine, so the RPS cycle is never restated here.
function aliveGrid(id) {
  const cfg = E.sanitizeCfg(variantOf(id).cfg);
  const grid = [];
  for (let blueMask = 0; blueMask < 8; blueMask++) {
    grid.push([]);
    for (let redMask = 0; redMask < 8; redMask++) {
      const board = E.emptyBoard(TB.SIZE);
      TYPES.forEach((type, i) => {
        if (blueMask & (1 << i)) board[0][i].piece = { type, color: E.BLUE };
        if (redMask & (1 << i)) board[2][i].piece = { type, color: E.RED };
      });
      grid[blueMask].push(E.capturesPossible(board, cfg));
    }
  }
  return grid;
}

function tempoData(id) {
  if (tempoCache.has(id)) return tempoCache.get(id);
  const table = tables.get(id);
  if (!table) return null;
  const { blue, red } = census();
  const alive = aliveGrid(id);
  const out = { live: 0, settled: 0, asset: 0, burden: 0, wins: 0, loses: 0, sampleWin: -1, sampleZug: -1 };
  for (let p = 0; p < TB.PLACEMENTS; p++) {
    if (!alive[blue[p]][red[p]]) continue;
    out.live++;
    const withBlue = TB.valueOf(table[p * 2]);
    const withRed = -TB.valueOf(table[p * 2 + 1]);              // stated from Blue's side either way
    if (withBlue === withRed) { out.settled++; continue; }
    if (withBlue > withRed) {
      out.asset++;
      if (withBlue === 1 && withRed === -1) {
        out.wins++;
        if (out.sampleWin < 0 || p % 1009 === 0) out.sampleWin = p;
      }
    } else {
      out.burden++;
      if (out.sampleZug < 0 || p % 1009 === 0) out.sampleZug = p;
      // The whole point, lost purely for being the one who has to move. It has never yet been
      // seen on this board, which is a finding rather than a formality.
      if (withBlue === -1 && withRed === 1) out.loses++;
    }
  }
  tempoCache.set(id, out);
  return out;
}

function renderTempo() {
  const rows = manifest.variants.map((variant) => ({ variant, data: tempoData(variant.id) }))
    .filter((row) => row.data);
  if (!rows.length) return;
  $('tempo-rows').innerHTML = rows.map(({ variant, data }) => {
    const share = (count) => `${(100 * count / data.live).toFixed(1)}%`;
    const on = variant.id === state.variant ? ' on' : '';
    return `<div class="tempo-row${on}">
      <span class="tempo-name">${variant.label}</span>
      <span class="tempo-bar" title="${nf.format(data.live)} live positions — settled ${share(data.settled)}, the move helps ${share(data.asset)}, the move hurts ${share(data.burden)}">
        <span class="tempo-seg settled" style="--w:${share(data.settled)}"></span>
        <span class="tempo-seg asset" style="--w:${share(data.asset)}"></span>
        <span class="tempo-seg burden" style="--w:${share(data.burden)}"></span>
      </span>
      <span class="tempo-figure mono">${share(data.asset)}</span>
      <span class="tempo-meta mono">${nf.format(data.wins)} where the move wins outright · ${data.burden
        ? `${nf.format(data.burden)} zugzwang` : 'no zugzwang at all'}</span>
    </div>`;
  }).join('');

  const here = rows.find((row) => row.variant.id === state.variant) || rows[0];
  const free = rows.filter((row) => !row.data.burden).map((row) => row.variant.label.toLowerCase());
  const worst = rows.slice().sort((a, b) => b.data.burden - a.data.burden)[0];
  const outright = rows.reduce((sum, row) => sum + row.data.loses, 0);
  const matters = (row) => (row.data.asset + row.data.burden) / row.data.live;
  const spread = rows.slice().sort((a, b) => matters(a) - matters(b));
  const [least, most] = [spread[0], spread[spread.length - 1]];
  $('tempo-note').textContent = `${nf.format(here.data.live)} placements a variant are still a game, `
    + `and how often the side to move matters is a property of the piece, not of the board: `
    + `${pct(matters(most))} under ${most.variant.label.toLowerCase()} rules, `
    + `${pct(matters(least))} under ${least.variant.label.toLowerCase()}. A piece that cannot reach `
    + `much cannot use a tempo, so most of its positions are decided before anybody moves. `
    + (free.length
      ? `Zugzwang is where it gets interesting. Under ${free.join(', ')} there is not one position `
        + `in the entire table where the mover would rather pass — every one of those archetypes can `
        + `step to any adjacent square, so there is always a way to mark time. `
      : '')
    + (worst?.data.burden
      ? `The pieces that cannot mark time can be trapped by their own turn: `
        + `${nf.format(worst.data.burden)} positions under ${worst.variant.label.toLowerCase()} `
        + `(${pct(worst.data.burden / worst.data.live)}), where a jump must leave the neighbourhood `
        + `whether that helps or not. `
      : '')
    + `And in all seven archetypes, the number of positions where having the move costs the whole `
    + `point — a win turned into a loss by nothing but the obligation to play — is ${outright}. `
    + `The move here can be worth everything, and is never worth less than nothing.`;

  const zug = $('tempo-zug');
  const zugRow = rows.filter((row) => row.data.burden)
    .sort((a, b) => b.data.burden - a.data.burden)[0];
  zug.disabled = !zugRow;
  if (zugRow) {
    zug.textContent = zugRow.variant.id === state.variant
      ? 'a position where the move is a liability'
      : `a zugzwang, under ${zugRow.variant.label.toLowerCase()} rules`;
    zug.onclick = async () => {
      if (zugRow.variant.id !== state.variant) await selectVariant(zugRow.variant.id);
      setPosition(TB.boardOf(TB.positionsFromKey(keys[zugRow.data.sampleZug])), E.BLUE);
    };
  }
  const win = $('tempo-win');
  const winRow = here.data.sampleWin >= 0 ? here
    : rows.slice().sort((a, b) => b.data.wins - a.data.wins)[0];
  win.disabled = !winRow || winRow.data.sampleWin < 0;
  win.onclick = async () => {
    if (winRow.variant.id !== state.variant) await selectVariant(winRow.variant.id);
    setPosition(TB.boardOf(TB.positionsFromKey(keys[winRow.data.sampleWin])), E.BLUE);
  };
}

// ── 13 beyond the pocket board ───────────────────────────────────────────────
let lab = null;
// Decimal units, from an exact decimal string: these numbers pass 2^53 four sizes in, so the
// magnitude comes from the digit count rather than from a float that has already lost it.
const HUMAN_BYTES = (decimal) => {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const power = L.log10Of(decimal);
  const step = Math.min(units.length - 1, Math.floor(power / 3));
  const scaled = 10 ** (power - step * 3);
  return `${scaled.toFixed(scaled < 10 ? 1 : 0)} ${units[step]}`;
};
const HUMAN_TIME = (seconds) => {
  if (seconds < 90) return `${seconds.toFixed(0)} s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(0)} min`;
  if (seconds < 129_600) return `${(seconds / 3600).toFixed(1)} hours`;
  if (seconds < 3.1e7) return `${(seconds / 86_400).toFixed(0)} days`;
  const years = seconds / 3.156e7;
  return years > 1e6 ? `${years.toExponential(1)} years` : `${nf.format(Math.round(years))} years`;
};

function renderLadder() {
  if (!lab) return;
  const top = Math.max(...lab.ladder.map((rung) => rung.log10States));
  $('ladder').innerHTML = lab.ladder.map((rung) => {
    const notable = rung.size === 3 || rung.size === 5 || rung.size === 9;
    return `<div class="rung${rung.solved ? ' solved' : ''}${notable ? ' notable' : ''}">
      <span class="rg-label">${rung.size}×${rung.size}</span>
      <span class="rg-track"><span class="rg-fill" style="--w:${(100 * rung.log10States / top).toFixed(2)}%"></span></span>
      <span class="rg-value mono">10<sup>${rung.log10States.toFixed(1)}</sup></span>
      <span class="rg-tag">${rung.solved ? 'solved' : HUMAN_BYTES(rung.states)}</span>
    </div>`;
  }).join('');

  const rows = lab.ladder.filter((rung) => [3, 5, 7, 9, 13].includes(rung.size));
  $('ladder-table').innerHTML = `<table><thead><tr>
      <th>board</th><th>pieces</th><th>positions</th><th>legal openings</th><th>moves a position</th>
      <th>table</th><th>one core</th>
    </tr></thead><tbody>${rows.map((rung) => `<tr${rung.solved ? ' class="solved"' : ''}>
      <td>${rung.size}×${rung.size}</td>
      <td>${rung.pieces}</td>
      <td class="mono">10<sup>${rung.log10States.toFixed(1)}</sup></td>
      <td class="mono">${nf.format(Number(rung.openings))}</td>
      <td class="mono">${rung.branching.toFixed(1)}${rung.branchingMeasured ? '' : '*'}</td>
      <td class="mono">${HUMAN_BYTES(rung.solvedBytes)}</td>
      <td class="mono">${HUMAN_TIME(rung.solveSeconds)}</td>
    </tr>`).join('')}</tbody></table>`;

  const five = lab.ladder.find((rung) => rung.size === 5);
  const nine = lab.ladder.find((rung) => rung.size === 9);
  const three = lab.ladder.find((rung) => rung.size === 3);
  $('ladder-note').textContent = `Positions and openings are exact. The last two columns are `
    + `priced from the run that produced this site's tables — ${nf.format(lab.method.solverEdgesPerSecond)} `
    + `moves a second on one core, which puts the 3×3 at ${HUMAN_TIME(three.solveSeconds)} against the `
    + `21 seconds it really took. On that rate the 5×5 is ${HUMAN_BYTES(five.solvedBytes)} of table and `
    + `${HUMAN_TIME(five.solveSeconds)} of walking: not impossible, but not a static asset either. The `
    + `9×9 is ${HUMAN_BYTES(nine.solvedBytes)}, which is more storage than has ever been manufactured. `
    + `A star marks a branching factor interpolated between measured sizes rather than measured.`;
}

// ── 14 measured play ─────────────────────────────────────────────────────────
let liveRuns = new Map();                                   // size|policy → extra games run here
const runKey = (run) => `${run.size}|${run.policy}`;
const runsShown = () => (lab?.play || []).map((run) => L.mergeSummaries(run, liveRuns.get(runKey(run)) || null));
// A median survives only until two batches are pooled, so a run that has been extended in this
// browser reports the mean it can still compute exactly rather than an average of two medians.
const plies = (run) => (run.medianPlies === null
  ? `${run.meanPlies.toFixed(0)} plies mean`
  : `${run.medianPlies} plies median`);

function renderRuns() {
  if (!lab) return;
  $('runs').innerHTML = runsShown().map((run) => {
    const { p, lo, hi } = run.firstPlayer;
    return `<div class="run">
      <span class="run-name">${run.size}×${run.size} <em>${run.policy}</em></span>
      <span class="run-bar" title="Blue wins ${pct(p)} of decisive games (95% CI ${pct(lo)}–${pct(hi)})">
        <span class="run-mid"></span>
        <span class="run-ci" style="--lo:${(100 * lo).toFixed(2)}%;--hi:${(100 * hi).toFixed(2)}%"></span>
        <span class="run-dot" style="--p:${(100 * p).toFixed(2)}%"></span>
      </span>
      <span class="run-figure mono">${pct(p)}</span>
      <span class="run-meta mono">${pct(run.drawRate.p)} drawn · ${plies(run)} · b=${run.meanBranching.toFixed(1)} · ${nf.format(run.games)} games</span>
    </div>`;
  }).join('');

  const check = runsShown().find((run) => run.size === 3 && run.policy === 'greedy');
  if (check) {
    $('runs-note').textContent = `The calibration: perfect play draws all 192 legal 3×3 openings — `
      + `100%, from the table above. The same board under this self-play draws ${pct(check.drawRate.p)}, `
      + `and hands Blue ${pct(check.firstPlayer.p)} of the decisive games rather than the nothing it is `
      + `entitled to. Nobody here is playing well. Read every row below as what happens between two `
      + `impatient players, not as what the game is worth.`;
  }
}

function renderLengths() {
  if (!lab) return;
  const runs = runsShown().filter((run) => run.policy === 'greedy');
  const labels = L.PLY_BUCKETS.map((edge, i) => (edge === Infinity ? '240+' : `≤${edge}`));
  $('lengths').innerHTML = runs.map((run) => {
    const top = Math.max(...run.plyBuckets) || 1;
    return `<figure class="len"><figcaption>${run.size}×${run.size}</figcaption>
      <div class="len-bars">${run.plyBuckets.map((count, i) => `<span class="len-bar"
        style="--h:${(100 * count / top).toFixed(2)}%"
        title="${labels[i]} plies — ${count} of ${run.games} games"></span>`).join('')}</div>
      <div class="len-axis"><span>10</span><span>240+</span></div></figure>`;
  }).join('');
}

async function runMoreGames(button) {
  if (!lab) return;
  button.disabled = true;
  $('lab-status').textContent = 'playing…';
  await new Promise((resolve) => setTimeout(resolve, 16));   // let the label paint before we block
  for (const run of lab.play) {
    const key = runKey(run);
    const already = liveRuns.get(key);
    const extra = L.measure(L.labCfg(run.size), {
      games: 200,
      seed: lab.method.seed,
      policy: run.policy,
      offset: lab.method.games + (already?.games || 0),
    });
    liveRuns.set(key, L.mergeSummaries(already, extra));
  }
  renderRuns();
  renderLengths();
  const added = [...liveRuns.values()].reduce((sum, run) => sum + run.games, 0);
  $('lab-status').textContent = `${nf.format(added)} games added in this browser — intervals narrowed`;
  button.disabled = false;
}

// ── 15 the blocking law ──────────────────────────────────────────────────────
function renderBlocking() {
  if (!lab) return;
  const ceiling = lab.blocking.ceiling;
  const top = Math.max(...ceiling.map((entry) => entry.mean));
  $('blocklaw').innerHTML = `<div class="bl-chart">${ceiling.map((entry) => {
    const measured = runsShown().find((run) => run.size === entry.size && run.policy === 'random');
    return `<div class="bl-row${measured ? ' measured' : ''}">
      <span class="bl-label">${entry.size}×${entry.size}</span>
      <span class="bl-track"><span class="bl-fill" style="--w:${(100 * entry.mean / top).toFixed(2)}%"></span></span>
      <span class="bl-value mono">${entry.mean.toFixed(2)}</span>
      <span class="bl-measured mono">${measured ? `${pct(measured.contactRatio)} takeable` : ''}</span>
    </div>`;
  }).join('')}</div>`;
  const measured = runsShown().filter((run) => run.policy === 'random');
  const mean = measured.reduce((sum, run) => sum + run.contactRatio, 0) / (measured.length || 1);
  $('block-note').textContent = `The bars are the average number of squares a king can reach on an `
    + `empty board of that size — 3 in a corner, 5 on an edge, 8 inside. Beside them is the share of `
    + `adjacent enemies that were actually takeable across ${nf.format(measured.reduce((sum, run) => sum + run.games, 0))} `
    + `random games: ${pct(mean)}, against a predicted one in three. Contact in this game is mostly wall.`;
}

// ── 16 what search is worth ──────────────────────────────────────────────────
// The bot graded against the only two judges available: on the 3×3 the solved table, where a
// mistake is a fact; on every larger board the same search given twenty-five thousand nodes,
// where a mistake is an opinion. Both rows report *regret* — how much worse the move played was
// than the best one — so the exact row and the measured rows can sit in one column while being
// labelled for what they are. Written by `npm run tune`; nothing here is computed on the page,
// because a browser cannot play a thousand graded games while you scroll.
let bots = null;

function renderTruth() {
  if (!bots?.truth) return;
  const truth = bots.truth;
  const top = Math.max(...truth.rows.map((row) => row.blunder), 0.02);
  $('truth-rows').innerHTML = truth.rows.map((row) => `<div class="srch-row">
      <span class="srch-label mono">${nf.format(row.nodes)}</span>
      <span class="srch-track" title="${pct(row.best)} best move, threw the game away ${pct(row.blunder)}">
        <span class="srch-fill" style="--w:${(100 * row.best).toFixed(2)}%"></span>
        <span class="srch-bad" style="--w:${(100 * row.blunder / top).toFixed(2)}%"></span>
      </span>
      <span class="srch-value mono">${pct(row.best)}</span>
      <span class="srch-meta mono">${row.blunder ? `${pct(row.blunder)} thrown away` : 'nothing thrown away'} · depth ${row.meanDepth}</span>
    </div>`).join('');
  $('truth-note').textContent = `Graded on ${nf.format(truth.positions)} solved positions that `
    + `contained a mistake to make — of ${nf.format(truth.sampled)} sampled from self-play, the rest `
    + `offered no way to go wrong and are not worth marking. A mover choosing at random finds the `
    + `best move ${pct(truth.randomBest)} of the time and holds the result ${pct(truth.randomHolds)} `
    + `of the time, which is the floor these rows should be read against. `
    + (truth.rows.some((row) => !row.blunder)
      ? `From ${nf.format(truth.rows.find((row) => !row.blunder).nodes)} nodes upward the bot stops `
        + `throwing games away entirely — on this board, and only on this board, the search is done.`
      : '');
}

function renderSearchLadder() {
  if (!bots?.ladder?.length) return;
  const sizes = [...new Set(bots.ladder.map((row) => row.size))];
  $('srch-ladder').innerHTML = sizes.map((size) => {
    const rows = bots.ladder.filter((row) => row.size === size);
    const duel = (bots.duels || []).find((entry) => entry.size === size);
    // Each row is scaled to its own worst bar, because the rows are not on a common scale: the
    // judge is a fixed budget and is closer to perfect on a small board than on a large one.
    const worst = Math.max(...rows.map((row) => row.regret), 0.01);
    return `<div class="srch-size">
      <span class="srch-label mono">${size}×${size}</span>
      <span class="srch-bars">${rows.map((row) => `<span class="srch-bar"
        style="--h:${(100 * Math.max(row.regret, 0) / worst).toFixed(2)}%"
        title="${nf.format(row.nodes)} nodes — regret ${row.regret.toFixed(3)} of a piece (95% CI ${row.regretLo.toFixed(3)}–${row.regretHi.toFixed(3)}), best move ${pct(row.best)}, over ${row.graded} positions"></span>`).join('')}</span>
      <span class="srch-meta mono">b=${rows[0].branching} · regret ${rows[0].regret.toFixed(2)}→${rows[rows.length - 1].regret.toFixed(2)}${duel
        ? ` · ${nf.format(duel.strong)} v ${nf.format(duel.weak)} nodes: ${duel.wins}–${duel.draws}–${duel.losses}`
        : ''}</span>
    </div>`;
  }).join('');
  const flat = (bots.duels || []).filter((duel) => duel.wins === 0 && duel.losses === 0);
  const bites = (bots.duels || []).find((duel) => duel.wins > duel.losses);
  $('srch-note').textContent = `Each group is one board size, its bars the ${bots.method.rungs.join(', ')} `
    + `node budgets in order. Read a row left to right and not against its neighbours: the judge is `
    + `a fixed budget, so it is nearer to perfect on a small board than on a large one, and the `
    + `rows are not on one scale. What is comparable is beside them, where the two budgets played `
    + `each other. `
    + (flat.length
      ? `On ${flat.map((duel) => `${duel.size}×${duel.size}`).join(' and ')}, sixteen times the search `
        + `won nothing at all: every game drawn, which is what a solved, drawn board looks like from `
        + `the inside. `
      : '')
    + (bites
      ? `From ${bites.size}×${bites.size} upward it starts to pay: ${bites.wins} wins and `
        + `${bites.losses} losses over ${bites.games} games. `
      : '')
    + `Above 3×3 the judge is a ${nf.format(bots.method.referenceNodes)}-node search rather than the `
    + `truth, so those regrets are a floor: a mistake the reference cannot see is a mistake nobody `
    + `is charged for.`;
}

function renderTuning() {
  const rows = (bots?.tuning || []).filter((entry) => entry.accepted);
  const note = $('srch-tuning');
  if (!bots?.tuning?.length) return;
  note.textContent = rows.length
    ? `Measuring is also how the bot is fitted to a variant: ${rows.map((entry) => entry.label).join(', ')} `
      + `${rows.length === 1 ? 'carries' : 'carry'} a weight vector that graded better than the one `
      + `derived from the rules and then held its own over the board. Every other ruleset — including `
      + `any you invent in the parameters menu — plays on weights worked out from the rules themselves.`
    : `Measuring is also how the bot would be fitted to a variant, and this run found nothing worth `
      + `keeping: on every ruleset tested, the weights derived from the rules graded as well as any `
      + `nearby vector. That is the intended outcome — a derivation that needs no correction.`;
}

// ── static panels ────────────────────────────────────────────────────────────
function renderHero() {
  $('hero-states').textContent = nf.format(TB.STATES);
  const king = variantOf('king');
  const bishop = variantOf('bishop');
  $('hero-figures').innerHTML = [
    ['positions solved', nf.format(TB.STATES)],
    ['movement archetypes', manifest.variants.length],
    ['legal openings, all drawn', '192'],
    ['longest forced win', `${Math.max(...manifest.variants.map((v) => v.maxDtm))} plies`],
    ['moves walked, king rules', nf.format(king.edges)],
    // The spread between these two is the finding, not either number on its own.
    ...(king.reachable && bishop.reachable
      ? [['reachable in play, kings vs bishops',
        `${pct(king.reachable.states / TB.STATES)} · ${pct(bishop.reachable.states / TB.STATES)}`]]
      : []),
  ].map(([label, figure]) => `<div class="hero-figure"><span>${label}</span><b>${figure}</b></div>`).join('');
}

function renderMethodFacts() {
  const total = manifest.variants.reduce((sum, v) => sum + v.bytes, 0);
  $('method-facts').innerHTML = [
    ['Placements enumerated', nf.format(TB.PLACEMENTS)],
    ['Positions, counting the turn', nf.format(TB.STATES)],
    ['Variants solved', manifest.variants.length],
    ['Moves walked in total', nf.format(manifest.variants.reduce((sum, v) => sum + v.edges, 0))],
    ['Every table, compressed', `${Math.round(total / 1024)} KB`],
    ['One table, in memory', `${Math.round(TB.STATES / 1024)} KB`],
  ].map(([label, figure]) => `<div class="fact"><span>${label}</span><b>${figure}</b></div>`).join('');
}

// ── orchestration ────────────────────────────────────────────────────────────
// Two levels of redraw. Highlighting a move only touches the board, because rebuilding the
// move graph on every hover would make the list feel like treacle.
let ranked = [];
function renderSelection() {
  renderBoard(ranked);
}

function renderPosition() {
  ranked = rankMoves(movesFrom(state.board, state.turn));
  renderBoard(ranked);
  renderVerdict(ranked);
  renderMoveList(ranked);
  renderCrossCheck();
  renderSymmetry();
  renderGraph();
  renderPuzzle();
  $('turn-blue').classList.toggle('on', state.turn === E.BLUE);
  $('turn-red').classList.toggle('on', state.turn === E.RED);
  $('undo-btn').disabled = !state.history.length;
}

async function ensureTable(id) {
  try {
    await loadTable(id);
  } catch (error) {
    $('verdict-word').textContent = 'Unavailable';
    $('verdict-detail').textContent = error.message;
  }
}

function buildPalette() {
  const host = $('tb-palette');
  const tools = [];
  for (const color of [E.BLUE, E.RED]) for (const type of TYPES) tools.push({ type, color });
  host.innerHTML = `<button type="button" class="tb-pal on" data-tool="move" title="Move pieces">move</button>`
    + tools.map((tool, i) => `<button type="button" class="tb-pal" data-tool="${i}"
        title="${tool.color === E.BLUE ? 'Blue' : 'Red'} ${tool.type}">${pieceGlyph(tool.type, tool.color)}</button>`).join('')
    + '<button type="button" class="tb-pal" data-tool="erase" title="Remove a piece">clear</button>';
  for (const button of host.querySelectorAll('[data-tool]')) {
    button.addEventListener('click', () => {
      const value = button.dataset.tool;
      state.tool = value === 'move' ? null : value === 'erase' ? 'erase' : tools[+value];
      state.selected = null;
      for (const other of host.children) other.classList.toggle('on', other === button);
      renderPosition();
    });
  }
}

function wireControls() {
  $('theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'light';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#ffffff' : '#000000');
    try { localStorage.setItem('janken-theme', dark ? 'light' : 'dark'); } catch { /* optional */ }
  });
  $('turn-blue').addEventListener('click', () => setPosition(state.board, E.BLUE));
  $('turn-red').addEventListener('click', () => setPosition(state.board, E.RED));
  $('undo-btn').addEventListener('click', () => {
    const previous = state.history.pop();
    if (!previous) return;
    state.board = previous.board;
    state.turn = previous.turn;
    state.selected = null;
    state.lastMove = null;
    syncHash();
    renderPosition();
  });
  $('reset-btn').addEventListener('click', () => setPosition(E.blocksBoard(TB.SIZE, 1, 'rows'), E.BLUE));
  $('random-btn').addEventListener('click', () => {
    const pick = keys[(Math.random() * TB.PLACEMENTS) | 0];
    setPosition(TB.boardOf(TB.positionsFromKey(pick)), Math.random() < 0.5 ? E.BLUE : E.RED);
  });
  $('share-btn').addEventListener('click', async () => {
    syncHash();
    try {
      await navigator.clipboard.writeText(window.location.href);
      $('share-btn').textContent = 'copied';
    } catch { $('share-btn').textContent = 'in the bar'; }
    setTimeout(() => { $('share-btn').textContent = 'share'; }, 1600);
  });

  $('graph-depth').addEventListener('input', (event) => {
    state.graphDepth = +event.target.value;
    $('graph-depth-value').textContent = state.graphDepth;
    renderGraph();
  });
  $('graph-best').addEventListener('click', () => {
    state.graphBest = true;
    $('graph-best').classList.add('on'); $('graph-all').classList.remove('on');
    renderGraph();
  });
  $('graph-all').addEventListener('click', () => {
    state.graphBest = false;
    $('graph-all').classList.add('on'); $('graph-best').classList.remove('on');
    renderGraph();
  });
  $('graph-fit').addEventListener('click', fitGraph);
  setSpoilers(state.spoilers);
  $('spoiler-btn').addEventListener('click', () => setSpoilers(!state.spoilers));
  $('puzzle-daily').addEventListener('click', () => loadPuzzle('daily'));
  $('puzzle-next').addEventListener('click', () => loadPuzzle('random'));
  $('puzzle-give').addEventListener('click', () => {
    if (!ranked.length) return;
    const best = TB.topMoves(ranked);
    $('puzzle-state').textContent = best.length
      ? `Winning: ${best.map((move) => move.san).join(', ')}.`
      : 'Nothing wins here.';
    $('puzzle-state').className = 'puzzle-state shown';
    if (state.puzzle) { state.puzzle.done = true; state.puzzle.failed = true; }
    setSpoilers(true);
  });
  $('lab-more').addEventListener('click', (event) => runMoreGames(event.currentTarget));
  window.addEventListener('hashchange', () => { readHash(); renderPosition(); });
}

// The lab data is a second, smaller artifact beside the tablebase: exact arithmetic for boards
// nobody will solve, plus a seeded self-play run. It is not needed to read a position, so it
// loads after the page is usable and its sections simply stay quiet until it lands.
// How well the bot plays, measured offline. A third small artifact beside the tables and the lab,
// and like the lab it is optional: the sections that need it stay quiet until it lands.
async function loadBots() {
  try {
    const response = await fetch('/atlas/bots.json');
    if (!response.ok) return;
    bots = await response.json();
    renderTruth();
    renderSearchLadder();
    renderTuning();
  } catch { /* the solved sections do not depend on it */ }
}

async function loadLab() {
  try {
    const response = await fetch('/atlas/lab.json');
    if (!response.ok) return;
    lab = await response.json();
    renderLadder();
    renderRuns();
    renderLengths();
    renderBlocking();
  } catch { /* the solved sections do not depend on it */ }
}

// The lens label tracks the section in view, so the board always says what it is being used for.
function wireScrollLens() {
  const sections = [...document.querySelectorAll('.atlas-section')];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id;
      state.lens = entry.target.dataset.lens || 'position';
      $('stage-lens').textContent = {
        moves: 'legal moves', openings: 'openings', variants: 'rule sets', layers: 'material',
        depth: 'depth', symmetry: 'symmetry', graph: 'continuations', puzzles: 'puzzle',
        reach: 'reachable play', simplex: 'material', squares: 'square value',
        tempo: 'the move itself', beyond: 'state space', measured: 'measured play',
        blocking: 'mobility', search: 'playing strength',
      }[state.lens] || 'position';
      for (const link of $('atlas-nav').children) link.classList.toggle('on', link.getAttribute('href') === `#${id}`);
      if (id === 'variants') loadAllTables();
      // Every table, then one pass over each: built when looked at, like its neighbours.
      if (id === 'tempo') loadAllTables();
      if (id === 'openings') renderGallery();
      if (id === 'graph') fitGraph();
      // Both walk all 415,550 states, so they are built when first looked at rather than on load.
      if (id === 'simplex') renderSimplex();
      if (id === 'squares') renderHeatmap();
    }
  }, { rootMargin: '-25% 0px -60% 0px' });
  for (const section of sections) observer.observe(section);
}

async function start() {
  try {
    document.documentElement.dataset.theme = localStorage.getItem('janken-theme') || 'dark';
  } catch { /* optional */ }
  manifest = await (await fetch('/tablebase/manifest.json')).json();
  readHash();

  buildBoard();
  buildPalette();
  wireControls();
  wireCsvButtons();
  $('pack-btn').addEventListener('click', (event) => downloadDataPack(event.currentTarget));
  mountFact($('dyk'));
  wireGraphViewport();
  renderHero();
  renderMethodFacts();
  renderVariantList();
  renderOpeningGrid();
  renderWaterfall();
  renderDeepest();
  $('stage-rules').textContent = variantOf(state.variant).rules;
  renderPosition();

  await ensureTable(state.variant);
  if (state.pendingPuzzle) { state.pendingPuzzle = false; loadPuzzle('daily', { scroll: true }); }
  renderPosition();
  renderHistogram();
  renderGallery();
  renderReach();
  wireScrollLens();
  loadLab();
  loadBots();
}

start();
