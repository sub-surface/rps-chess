// Tablebase atlas. The board is the whole page: every chart, grid and node here is a way of
// putting a position onto it, and every verdict comes from the solved tables rather than from
// any evaluation invented for this screen.
//
// Rules come from engine.js exactly as they do in play, so the moves offered here are the moves
// the game would allow. The tables only supply values — never legality.
import * as E from './engine.js';
import { glyph } from './pieces.js';
import * as TB from './tablebase.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-GB');
const pct = (x) => `${(100 * x).toFixed(x < 0.001 ? 3 : 1)}%`;
const LETTER = { rock: 'R', paper: 'P', scissors: 'S' };
const TYPES = ['rock', 'paper', 'scissors'];
const OUTCOME = ['L', 'D', 'W'];

const { index, keys } = TB.enumeratePlacements();
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
};

const variantOf = (id) => manifest.variants.find((v) => v.id === id);
const activeCfg = () => variantOf(state.variant).cfg;

// ── table access ─────────────────────────────────────────────────────────────
// Artifacts are gzip on the wire and a flat byte array in memory. One variant is 406 KB
// decompressed, so they load on demand and stay cached rather than shipping all seven upfront.
async function loadTable(id) {
  if (tables.has(id)) return tables.get(id);
  const response = await fetch(`/tablebase/${id}.tb`);
  if (!response.ok) throw new Error(`could not load the ${id} tablebase`);
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (bytes.length !== TB.STATES) throw new Error(`${id} tablebase is ${bytes.length} bytes, expected ${TB.STATES}`);
  tables.set(id, bytes);
  return bytes;
}

const placementOf = (board) => {
  const positions = TB.positionsOf(board);
  return positions ? index[TB.keyOf(positions)] : -1;
};

// A verdict from the side to move's point of view: 1 win, 0 draw, -1 loss.
function probe(board, turn, id = state.variant) {
  const table = tables.get(id);
  const placement = placementOf(board);
  if (!table || placement < 0) return null;
  const entry = table[TB.stateOf(placement, turn)];
  return { value: TB.valueOf(entry), dtm: TB.dtmOf(entry), placement };
}

const terminalOf = (board, cfg) => E.terminalReason({ board, cfg, repetitions: {}, dry: 0 });

function applyOn(board, move, cfg, turn) {
  const next = E.cloneBoard(board);
  E.applyMove({
    board: next, cfg, moves: [], repetitions: {}, dry: 0, acts: 0,
    turn, passStreak: 0, gameOver: false, endReason: null,
  }, move);
  return next;
}

// Legal moves with the position each one creates already evaluated. A terminal position has
// none, whatever the geometry allows — that is the same judgement the solver made.
function movesFrom(board, turn, cfg = activeCfg()) {
  if (terminalOf(board, cfg)) return [];
  return E.allMoves(board, turn, cfg).map((move) => {
    const piece = board[move.fr][move.fc].piece;
    const captured = E.captureTarget(board, move, cfg)?.piece || null;
    const next = applyOn(board, move, cfg, turn);
    return {
      ...move,
      piece,
      captured,
      board: next,
      after: probe(next, E.other(turn)),
      san: `${LETTER[piece.type]}${E.sqName(move.fr, move.fc, TB.SIZE)}`
        + `${captured ? '×' : '–'}${E.sqName(move.tr, move.tc, TB.SIZE)}`,
    };
  });
}

const moverValue = (move) => (move.after ? -move.after.value : 0);
// Best first: win over draw over loss, then finish a win quickly and drag a loss out.
const rankMoves = (list) => list.slice().sort((a, b) => {
  const va = moverValue(a), vb = moverValue(b);
  if (va !== vb) return vb - va;
  if (va === 1) return a.after.dtm - b.after.dtm;
  if (va === -1) return b.after.dtm - a.after.dtm;
  return a.san.localeCompare(b.san);
});
const isBest = (move, ranked) => ranked.length > 0
  && moverValue(move) === moverValue(ranked[0])
  && (moverValue(move) === 0 || move.after.dtm === ranked[0].after.dtm);

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
    cell.innerHTML = `<span class="tb-coord">${E.sqName(row, col, TB.SIZE)}</span>`
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
      cell.pieceHost.innerHTML = piece ? glyph(piece.type, piece.color, 'line') : '';
    }

    const move = selectedMoves.find((m) => m.tr === row && m.tc === col);
    const dotKey = move ? `${OUTCOME[moverValue(move) + 1]}${move.captured ? 'c' : ''}` : '';
    if (cell.dataset.dot !== dotKey) {
      cell.dataset.dot = dotKey;
      cell.dotHost.innerHTML = move
        ? `<span class="dest ${OUTCOME[moverValue(move) + 1]}${move.captured ? ' cap' : ''}"></span>`
        : '';
    }

    cell.classList.toggle('sel', !!state.selected && state.selected.r === row && state.selected.c === col);
    cell.classList.toggle('from', !!state.lastMove
      && ((state.lastMove.fr === row && state.lastMove.fc === col)
        || (state.lastMove.tr === row && state.lastMove.tc === col)));
    cell.setAttribute('aria-label', `${E.sqName(row, col, TB.SIZE)} `
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
  group.innerHTML = '';
  if (state.selected || !list.length) return;
  const best = list.filter((move) => isBest(move, list));
  // A crowd of equally good moves is information, not decoration — but it should not shout.
  const weight = best.length > 4 ? 0.5 : best.length > 2 ? 0.66 : 0.82;
  group.innerHTML = best.map((move) => {
    const shape = arrowShape(move);
    return shape
      ? `<path class="garrow ${OUTCOME[moverValue(move) + 1]}" d="${shape}" opacity="${weight}"/>`
      : '';
  }).join('');
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
  for (const move of ranked) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `move-row${isBest(move, ranked) ? ' best' : ''}`;
    const letter = OUTCOME[moverValue(move) + 1];
    const word = { W: 'WIN', D: 'DRAW', L: 'LOSS' }[letter];
    row.innerHTML = `${glyph(move.piece.type, move.piece.color, 'line')}`
      + `<span class="san">${move.san}</span>`
      + `<span class="tag">${move.captured ? `takes ${move.captured.type}` : 'quiet'}</span>`
      + `<span class="out ${letter}">${word}${letter === 'D' ? '' : ` · ${move.after.dtm}`}</span>`;
    const highlight = () => { state.selected = { r: move.fr, c: move.fc }; renderSelection(); };
    row.addEventListener('mouseenter', highlight);
    row.addEventListener('focus', highlight);
    row.addEventListener('click', () => playMove(move));
    host.appendChild(row);
  }
  const best = ranked.filter((m) => isBest(m, ranked)).length;
  $('movelist-note').textContent = `${best} of ${ranked.length} ${best === 1 ? 'move keeps' : 'moves keep'} `
    + 'the best result available; the rest give something away.';
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

function renderOpeningGrid() {
  const variant = variantOf(state.variant);
  const host = $('opening-grid');
  const [shippedBlue, shippedRed] = manifest.startLineup;
  let html = '<div class="oh"></div>';
  for (const label of manifest.permutations) html += `<div class="oh">${label}</div>`;
  for (let blue = 0; blue < 6; blue++) {
    html += `<div class="oh">${manifest.permutations[blue]}</div>`;
    for (let red = 0; red < 6; red++) {
      const value = variant.lineups[blue][red];
      // Reachable exactly when Red's column is Blue's reversed — that is what a 180° turn does.
      const legal = manifest.permutations[red] === [...manifest.permutations[blue]].reverse().join('');
      const shipped = blue === shippedBlue && red === shippedRed;
      html += `<button type="button" class="opening-cell ${OUTCOME[value + 1]}`
        + `${legal ? ' legal' : ''}${shipped ? ' shipped' : ''}" data-b="${blue}" data-r="${red}"`
        + ` title="Blue ${manifest.permutations[blue]} vs Red ${manifest.permutations[red]}`
        + `${legal ? ' — reachable' : ' — no layout deals this'}">${OUTCOME[value + 1]}</button>`;
    }
  }
  host.innerHTML = html;
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
  const table = tables.get(state.variant);
  const host = $('histogram');
  if (!table) { host.innerHTML = '<p class="loading">reading the table</p>'; return; }
  const variant = variantOf(state.variant);
  const counts = new Array(variant.maxDtm + 1).fill(0);
  for (let s = 0; s < TB.STATES; s++) {
    const entry = table[s];
    if (TB.valueOf(entry) !== 0) counts[TB.dtmOf(entry)]++;
  }
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

// ── static panels ────────────────────────────────────────────────────────────
function renderHero() {
  $('hero-states').textContent = nf.format(TB.STATES);
  const king = variantOf('king');
  $('hero-figures').innerHTML = [
    ['positions solved', nf.format(TB.STATES)],
    ['movement archetypes', manifest.variants.length],
    ['legal openings, all drawn', '192'],
    ['longest forced win', `${Math.max(...manifest.variants.map((v) => v.maxDtm))} plies`],
    ['moves walked, king rules', nf.format(king.edges)],
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
        title="${tool.color === E.BLUE ? 'Blue' : 'Red'} ${tool.type}">${glyph(tool.type, tool.color, 'line')}</button>`).join('')
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
  window.addEventListener('hashchange', () => { readHash(); renderPosition(); });
}

// The lens label tracks the section in view, so the board always says what it is being used for.
function wireScrollLens() {
  const sections = [...document.querySelectorAll('.atlas-section')];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id;
      state.lens = entry.target.dataset.lens || 'position';
      $('stage-lens').textContent = { moves: 'legal moves', openings: 'openings', variants: 'rule sets', layers: 'material', depth: 'depth', symmetry: 'symmetry', graph: 'continuations' }[state.lens] || 'position';
      for (const link of $('atlas-nav').children) link.classList.toggle('on', link.getAttribute('href') === `#${id}`);
      if (id === 'variants') loadAllTables();
      if (id === 'openings') renderGallery();
      if (id === 'graph') fitGraph();
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
  renderPosition();
  renderHistogram();
  renderGallery();
  wireScrollLens();
}

start();
