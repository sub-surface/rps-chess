// JANKEN client — homepage, local play (hot-seat / bot / bot-vs-bot), and online rooms.
// All rules live in engine.js (shared with the server), so hints match server validation.
import * as E from '/engine.js';
const { BLUE, RED, other } = E;

// ── config + identity (persisted) ───────────────────────────────────────────
const DEFAULTS = { size: 9, perType: 2, moveStyle: 'classic', capture: 'rps', territory: true, retread: false, actionsPerTurn: 1, first: BLUE, coords: true, hints: true, pieceStyle: 'line' };
const cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('janken-cfg') || '{}'));
const saveCfg = () => localStorage.setItem('janken-cfg', JSON.stringify(cfg));
let flipped = localStorage.getItem('janken-flip') === '1';
let name = localStorage.getItem('janken-name') || ('guest-' + Math.random().toString(36).slice(2, 6));
localStorage.setItem('janken-name', name);

// ── piece glyphs — two styles ────────────────────────────────────────────────
const LINE = {
  rock: `<path d="M14 62 L26 43 L35 29 L46 41 L58 25 L70 40 L86 47 L81 67 L69 82 L38 84 L21 75 Z"/>
         <path d="M35 29 L43 58 M58 25 L53 60 M70 40 L64 62" stroke-width="4"/><path d="M30 68 L74 65" stroke-width="4"/>`,
  paper: `<path d="M31 17 H60 L74 31 V83 H31 Z"/><path d="M60 17 V31 H74" stroke-width="5"/><path d="M40 46 H64 M40 58 H64 M40 70 H56" stroke-width="5"/>`,
  scissors: `<circle cx="33" cy="73" r="9" stroke-width="6"/><circle cx="67" cy="73" r="9" stroke-width="6"/><path d="M40 67 L76 21"/><path d="M60 67 L24 21"/><circle cx="50" cy="44" r="3.4" fill="currentColor" stroke="none"/>`,
};
const PIX = {
  rock: ["............", "............", "....XXXX....", "...XXXXXX...", "..XXXXXXXX..", ".XXXXXXXXXX.", "XXXXXXXXXXXX", "XXXXXXXXXXXX", "XXXXXXXXXXXX", ".XXXXXXXXXX.", "............", "............"],
  paper: ["............", "..XXXXXXXX..", "..X......X..", "..X.XXXX.X..", "..X......X..", "..X.XXXX.X..", "..X......X..", "..X.XXX..X..", "..X......X..", "..XXXXXXXX..", "............", "............"],
  scissors: ["............", ".X........X.", "..X......X..", "...X....X...", "....X..X....", ".....XX.....", "....X..X....", "...X....X...", "..XX....XX..", "..XX....XX..", "............", "............"],
};
function glyph(type, color, style) {
  style = style || cfg.pieceStyle;
  if (style === 'pixel') {
    const m = PIX[type]; let cells = '';
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) if (m[y][x] === 'X') cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    return `<svg class="pc pix pc-${color}" viewBox="0 0 12 12" fill="currentColor" stroke="none">${cells}</svg>`;
  }
  return `<svg class="pc pc-${color}" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="7">${LINE[type]}</svg>`;
}
const legendGlyph = (type) => glyph(type, 'B').replace('pc-B', 'pc');
const MOVES_DESC = {
  classic: [['rock', 'Rock', 'steps 1 — any way'], ['paper', 'Paper', 'slides — straight'], ['scissors', 'Scissors', 'slides — diagonal']],
  kings: [['rock', 'Rock', 'steps 1 — any way'], ['paper', 'Paper', 'steps 1 — any way'], ['scissors', 'Scissors', 'steps 1 — any way']],
  queens: [['rock', 'Rock', 'slides — any way'], ['paper', 'Paper', 'slides — any way'], ['scissors', 'Scissors', 'slides — any way']],
};

// ── state ────────────────────────────────────────────────────────────────────
const state = { board: E.blocksBoard(9, 2), turn: BLUE, acts: 0, selected: null, targets: [], lastMove: null, justMovedTo: null, moves: [], passStreak: 0, gameOver: false, dry: 0, thinking: false, cfg };
let positions = [], viewPly = 0;
let mode = 'human';        // 'human' | 'bot' | 'botbot' | (online → net set)
let net = null;
let gen = 0;               // bumps to cancel stale bot timeouts / sockets
let editing = false, editBoard = null, tool = { type: 'rock', color: BLUE };
const BOTSIDE = RED;

const liveIndex = () => positions.length - 1;
const isLive = () => viewPly === liveIndex();
const snap = () => JSON.stringify({ board: state.board, turn: state.turn, acts: state.acts, moves: state.moves, passStreak: state.passStreak, gameOver: state.gameOver, lastMove: state.lastMove, dry: state.dry });
function loadLive(s) { const d = JSON.parse(s); Object.assign(state, { board: d.board, turn: d.turn, acts: d.acts, moves: d.moves, passStreak: d.passStreak, gameOver: d.gameOver, lastMove: d.lastMove, dry: d.dry, selected: null, targets: [], justMovedTo: null }); }

function humanControls(color) {
  if (net) return net.role === color;
  if (mode === 'human') return true;
  if (mode === 'bot') return color !== BOTSIDE;
  return false;
}
const canPlay = () => !state.gameOver && !state.thinking && isLive() && humanControls(state.turn);

// ── bot ──────────────────────────────────────────────────────────────────────
function metricDiff(board, color) {
  if (cfg.territory) { const s = E.scoreOf(board); return color === BLUE ? s.B - s.R : s.R - s.B; }
  const p = E.pieceCounts(board); return color === BLUE ? p.B - p.R : p.R - p.B;
}
function botPick(color) {
  const moves = E.allMoves(state.board, color, cfg);
  if (!moves.length) return null;
  const mid = (state.board.length - 1) / 2;
  let best = [], bv = -Infinity;
  for (const m of moves) {
    const b = E.cloneBoard(state.board);
    const cap = !!b[m.tr][m.tc].piece, p = b[m.fr][m.fc].piece;
    b[m.fr][m.fc].piece = null;
    b[m.tr][m.tc] = { owner: cfg.territory ? color : b[m.tr][m.tc].owner, piece: p };
    let v = metricDiff(b, color);
    if (cap) v += cfg.territory ? 2.2 : 3.0;
    v += 0.05 * (mid - Math.abs(mid - m.tr)) + 0.05 * (mid - Math.abs(mid - m.tc)) + Math.random() * 0.25;
    if (v > bv) { bv = v; best = [m]; } else if (v === bv) best.push(m);
  }
  return best[(Math.random() * best.length) | 0];
}
function botToMove() {
  if (state.gameOver || net || editing) return false;
  if (mode === 'bot') return state.turn === BOTSIDE;
  return mode === 'botbot';
}
function maybeBot() {
  if (!botToMove()) return;
  state.thinking = true; render();
  const g = gen;
  setTimeout(() => {
    if (g !== gen) return;
    state.thinking = false;
    if (!botToMove()) return render();
    const m = botPick(state.turn);
    if (m) doMove(m); else render();
  }, mode === 'botbot' ? 460 : 320);
}

function doMove(m) {
  E.applyMove(state, m);
  state.justMovedTo = { r: m.tr, c: m.tc };
  state.selected = null; state.targets = [];
  positions.push(snap()); viewPly = liveIndex();
  render(); maybeBot();
}

// ── DOM build ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const boardEl = $('board');
let slots = [], curSize = 0;
function build(size) {
  boardEl.innerHTML = ''; slots = [];
  boardEl.style.gridTemplateColumns = `repeat(${size},1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${size},1fr)`;
  for (let dr = 0; dr < size; dr++) {
    slots[dr] = [];
    for (let dc = 0; dc < size; dc++) {
      const btn = document.createElement('button');
      btn.className = 'sq'; btn.dataset.dr = dr; btn.dataset.dc = dc;
      const rank = document.createElement('span'); rank.className = 'coord rank'; rank.hidden = true;
      const file = document.createElement('span'); file.className = 'coord file'; file.hidden = true;
      const pcw = document.createElement('span'); pcw.className = 'pcw';
      btn.append(rank, file, pcw);
      boardEl.appendChild(btn);
      slots[dr][dc] = { btn, rank, file, pcw };
    }
  }
  curSize = size;
}
const toBoard = (dr, dc, size) => flipped ? [size - 1 - dr, size - 1 - dc] : [dr, dc];

// ── render ──────────────────────────────────────────────────────────────────
function renderLegend() { $('legend').innerHTML = MOVES_DESC[cfg.moveStyle].map(([p, t, d]) => `<div class="lg"><span class="glyph">${legendGlyph(p)}</span><span class="lt">${t}</span><span class="lm">${d}</span></div>`).join(''); }

function render() {
  const size = curSize;
  let board, lastMove, boardMode;
  if (editing) { board = editBoard; lastMove = null; boardMode = 'edit'; }
  else if (isLive()) { board = state.board; lastMove = state.lastMove; boardMode = canPlay() ? 'play' : 'lock'; }
  else { const d = JSON.parse(positions[viewPly]); board = d.board; lastMove = d.lastMove; boardMode = 'review'; }
  boardEl.classList.toggle('editing', boardMode === 'edit');
  boardEl.classList.toggle('review', boardMode === 'review');
  boardEl.classList.toggle('locked', boardMode === 'lock');

  const tint = cfg.territory || editing;
  for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
    const [r, c] = toBoard(dr, dc, size);
    const cell = board[r][c], s = slots[dr][dc];
    let cls = 'sq' + (((r + c) % 2 === 0) ? ' light' : '');
    if (tint && cell.owner === BLUE) cls += ' own-B'; else if (tint && cell.owner === RED) cls += ' own-R';
    if (lastMove && ((lastMove.fr === r && lastMove.fc === c) || (lastMove.tr === r && lastMove.tc === c))) cls += ' last';
    if (boardMode === 'play') {
      if (state.selected && state.selected.r === r && state.selected.c === c) cls += ' sel';
      if (cfg.hints && state.targets.some(t => t[0] === r && t[1] === c)) cls += cell.piece ? ' target-cap' : ' target';
    }
    if (state.justMovedTo && state.justMovedTo.r === r && state.justMovedTo.c === c && isLive() && !editing) cls += ' pop';
    s.btn.className = cls;
    s.pcw.innerHTML = cell.piece ? glyph(cell.piece.type, cell.piece.color) : '';
    const showR = cfg.coords && dc === 0, showF = cfg.coords && dr === size - 1;
    s.rank.hidden = !showR; if (showR) s.rank.textContent = size - r;
    s.file.hidden = !showF; if (showF) s.file.textContent = E.fileL(c);
  }
  state.justMovedTo = null;
  renderHUD(board);
}

function renderHUD(board) {
  const terr = cfg.territory;
  const res = E.result({ board, cfg });
  const tot = terr ? board.length * board.length : (res.B + res.R) || 1;
  $('seg-b').style.width = (res.B / tot * 100) + '%';
  $('seg-r').style.width = (res.R / tot * 100) + '%';
  $('seg-n').style.width = (terr ? (res.open || 0) / tot * 100 : 0) + '%';
  $('ct-b').textContent = res.B; $('ct-r').textContent = res.R;
  $('ct-n').textContent = terr ? res.open : ''; $('lbl-n').textContent = terr ? 'open' : '';
  $('lbl-b').textContent = terr ? 'blue' : 'blue pcs'; $('lbl-r').textContent = terr ? 'red' : 'red pcs';

  $('turn').classList.toggle('red', state.turn === RED);
  const N = cfg.actionsPerTurn || 1, left = N - (state.acts || 0);
  const actNote = (N > 1 && !state.gameOver && !state.thinking && isLive()) ? ` · ${left} action${left === 1 ? '' : 's'} left` : '';
  $('turn-label').textContent = state.gameOver ? 'Game over'
    : state.thinking ? (state.turn === BLUE ? 'Blue' : 'Red') + ' thinking…'
      : (state.turn === BLUE ? 'Blue' : 'Red') + ' to move' + (!isLive() ? ' · reviewing' : actNote);

  const scrub = !!net;
  $('nav-prev').disabled = scrub || viewPly <= 0;
  $('nav-start').disabled = scrub || viewPly <= 0;
  $('nav-next').disabled = scrub || viewPly >= liveIndex();
  $('nav-end').disabled = scrub || viewPly >= liveIndex();
  $('takeback').disabled = !!net || mode === 'botbot' || positions.length <= 1 || state.thinking;
  $('ply').textContent = viewPly === 0 ? 'start' : `${viewPly} / ${liveIndex()}`;

  renderLog(); renderBanner(res);
}

function renderLog() {
  const rows = []; let cur = null;
  for (const m of state.moves) {
    if (m.c === BLUE) { cur = { n: rows.length + 1, b: m.t, r: '' }; rows.push(cur); }
    else { if (!cur) { cur = { n: rows.length + 1, b: '', r: '' }; rows.push(cur); } cur.r = m.t; }
  }
  const log = $('log');
  log.innerHTML = rows.map(row => `<li class="n">${row.n}.</li><span class="mv b">${row.b}</span><span class="mv r">${row.r}</span>`).join('');
  log.scrollTop = log.scrollHeight;
}

function renderBanner(res) {
  const el = $('banner');
  if (!state.gameOver || editing || !isLive()) { el.hidden = true; return; }
  const winner = res.B > res.R ? 'Blue wins' : res.R > res.B ? 'Red wins' : 'Draw';
  const cls = res.B > res.R ? 'tb' : res.R > res.B ? 'tr' : '';
  const unit = res.metric === 'squares' ? '' : ' pieces';
  el.hidden = false;
  el.innerHTML = `<div class="card"><b class="${cls}">${winner}</b><p>Blue ${res.B} · Red ${res.R}${unit}</p><button class="btn" id="again-btn">${net ? 'Rematch' : 'New game'}</button></div>`;
  $('again-btn').onclick = newGame;
}

// ── interaction ─────────────────────────────────────────────────────────────
boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq'); if (!b) return;
  const [r, c] = toBoard(+b.dataset.dr, +b.dataset.dc, curSize);
  if (editing) return editClick(r, c);
  if (!canPlay()) return;
  if (state.selected && state.targets.some(t => t[0] === r && t[1] === c)) {
    const m = { fr: state.selected.r, fc: state.selected.c, tr: r, tc: c };
    if (net) { net.ws.send(JSON.stringify({ type: 'move', from: [m.fr, m.fc], to: [m.tr, m.tc] })); state.selected = null; state.targets = []; render(); }
    else doMove(m);
    return;
  }
  const p = state.board[r][c].piece;
  if (p && p.color === state.turn) { state.selected = { r, c }; state.targets = E.legalDest(state.board, r, c, cfg); }
  else { state.selected = null; state.targets = []; }
  render();
});
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || (document.activeElement && document.activeElement.tagName === 'INPUT')) return;
  if (e.key === 'Escape') { if (editing) return cancelEdit(); state.selected = null; state.targets = []; render(); return; }
  if (editing || net) return;
  if (e.key === 'ArrowLeft') { nav(viewPly - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { nav(viewPly + 1); e.preventDefault(); }
  else if (e.key === 'Home') { nav(0); e.preventDefault(); }
  else if (e.key === 'End') { nav(liveIndex()); e.preventDefault(); }
});
function nav(to) { if (net) return; viewPly = Math.max(0, Math.min(liveIndex(), to)); state.selected = null; state.targets = []; render(); }

// ── game lifecycle ──────────────────────────────────────────────────────────
function freshLocal(board) {
  const gm = E.newGame(cfg, board);
  Object.assign(state, { board: gm.board, turn: gm.turn, acts: gm.acts, moves: gm.moves, passStreak: gm.passStreak, gameOver: gm.gameOver, lastMove: gm.lastMove, dry: gm.dry, selected: null, targets: [], justMovedTo: null, thinking: false });
}
function newGame() {
  gen++;
  if (net) { net.ws.send(JSON.stringify({ type: 'new', cfg })); return; }
  if (curSize !== cfg.size) build(cfg.size);
  freshLocal();
  positions = [snap()]; viewPly = 0;
  renderLegend(); render(); maybeBot();
}
function startLocal(m) { gen++; net = null; mode = m; $('online').hidden = true; $('players').hidden = true; showGame(); newGame(); }

// ── online ───────────────────────────────────────────────────────────────────
const genRoom = () => { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };
function startOnline(room, opts = {}) {
  gen++; mode = 'online';
  net = { ws: null, room, role: null, token: localStorage.getItem('janken-tok-' + room) || null, names: {}, seats: {}, connected: false };
  showGame(); $('players').hidden = false; $('online').hidden = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ room, name });
  if (net.token) params.set('token', net.token);
  else if (opts.host) params.set('cfg', btoa(JSON.stringify(cfg)));
  const ws = new WebSocket(`${proto}://${location.host}/ws?${params.toString()}`);
  net.ws = ws;
  ws.onopen = () => { if (net) { net.connected = true; updateOnlineUI(); } };
  ws.onmessage = (e) => { let msg; try { msg = JSON.parse(e.data); } catch { return; } onNet(msg); };
  ws.onclose = () => { if (net) { net.connected = false; updateOnlineUI(); } };
  ws.onerror = () => { if (net) { net.connected = false; updateOnlineUI(); } };
  location.hash = 'r=' + room;
  updateOnlineUI();
}
function onNet(msg) {
  if (msg.type === 'welcome') { net.role = msg.role; net.token = msg.token; localStorage.setItem('janken-tok-' + net.room, msg.token); applyServerState(msg.state); }
  else if (msg.type === 'state') applyServerState(msg.state);
}
function applyServerState(s) {
  Object.assign(cfg, { size: s.cfg.size, perType: s.cfg.perType, moveStyle: s.cfg.moveStyle, capture: s.cfg.capture, territory: s.cfg.territory, retread: s.cfg.retread, actionsPerTurn: s.cfg.actionsPerTurn, first: s.cfg.first });
  if (curSize !== cfg.size) build(cfg.size);
  Object.assign(state, { board: s.board, turn: s.turn, acts: s.acts || 0, moves: s.moves, gameOver: s.gameOver, lastMove: s.lastMove, passStreak: 0, dry: 0, thinking: false, selected: null, targets: [] });
  net.names = s.names || {}; net.seats = s.seats || {};
  positions = [snap()]; viewPly = 0;
  renderLegend(); render(); updateOnlineUI();
}
function updateOnlineUI() {
  if (!net) { $('online').hidden = true; $('players').hidden = true; return; }
  $('online').hidden = false; $('players').hidden = false;
  $('orole').className = 'orole ' + (net.role === 'B' ? 'b' : net.role === 'R' ? 'r' : 'on');
  let label = net.role === 'B' ? 'You are Blue' : net.role === 'R' ? 'You are Red' : 'Spectating';
  if (!net.connected) label = 'Reconnecting…';
  else if (net.role !== 'S' && !(net.seats.B && net.seats.R)) label += ' · waiting for opponent';
  $('orole-text').textContent = label;
  $('oshare').value = location.origin + '/#r=' + net.room;
  $('pl-b').textContent = (net.names.B || 'Blue') + (net.role === 'B' ? ' (you)' : '');
  $('pl-r').textContent = (net.names.R || (net.seats.R ? 'Red' : '— open')) + (net.role === 'R' ? ' (you)' : '');
}
function leaveOnline() { gen++; if (net && net.ws) try { net.ws.close(); } catch { } net = null; }

// ── editor ────────────────────────────────────────────────────────────────────
function buildPalette() {
  const pal = $('palette'); pal.innerHTML = '';
  for (const color of [BLUE, RED]) for (const type of ['rock', 'paper', 'scissors']) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pal'; b.dataset.type = type; b.dataset.color = color; b.innerHTML = glyph(type, color);
    b.onclick = () => { tool = { type, color }; markTool(); }; pal.appendChild(b);
  }
  const er = document.createElement('button'); er.type = 'button'; er.className = 'pal erase'; er.textContent = 'erase'; er.dataset.erase = '1';
  er.onclick = () => { tool = 'erase'; markTool(); }; pal.appendChild(er); markTool();
}
function markTool() { for (const b of $('palette').children) b.classList.toggle('on', tool === 'erase' ? b.dataset.erase === '1' : (b.dataset.type === tool.type && b.dataset.color === tool.color)); }
function enterEdit() { gen++; leaveOnline(); mode = 'human'; showGame(); if (curSize !== cfg.size) build(cfg.size); editing = true; editBoard = E.blocksBoard(cfg.size, cfg.perType); $('panel').hidden = true; $('editpanel').hidden = false; $('online').hidden = true; $('players').hidden = true; render(); }
function cancelEdit() { editing = false; $('editpanel').hidden = true; $('panel').hidden = false; showHome(); }
function editClick(r, c) { editBoard[r][c] = tool === 'erase' ? { owner: null, piece: null } : { owner: tool.color, piece: { type: tool.type, color: tool.color } }; render(); }
function startFromEdit() { editing = false; $('editpanel').hidden = true; $('panel').hidden = false; mode = 'human'; freshLocal(E.cloneBoard(editBoard)); positions = [snap()]; viewPly = 0; renderLegend(); render(); maybeBot(); }
$('ed-cancel').onclick = cancelEdit;
$('ed-start').onclick = startFromEdit;
$('ed-clear').onclick = () => { editBoard = E.emptyBoard(cfg.size); render(); };
$('ed-blocks').onclick = () => { editBoard = E.blocksBoard(cfg.size, cfg.perType); render(); };
$('ed-mirror').onclick = () => {
  const S = editBoard.length;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (editBoard[r][c].piece && editBoard[r][c].piece.color === RED) editBoard[r][c] = { owner: null, piece: null };
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) { const p = editBoard[r][c].piece; if (p && p.color === BLUE) { const rr = S - 1 - r, cc = S - 1 - c; if (!(editBoard[rr][cc].piece && editBoard[rr][cc].piece.color === BLUE)) editBoard[rr][cc] = { owner: RED, piece: { type: p.type, color: RED } }; } }
  render();
};

// ── screens / homepage ────────────────────────────────────────────────────────
let lobbyTimer = null;
function showGame() { document.body.dataset.screen = 'game'; $('home').hidden = true; $('game').hidden = false; stopLobbyPoll(); }
function showHome() { gen++; leaveOnline(); editing = false; $('editpanel').hidden = true; $('panel').hidden = false; document.body.dataset.screen = 'home'; $('home').hidden = false; $('game').hidden = true; if (location.hash) location.hash = ''; fillHome(); startLobbyPoll(); }

function fillHome() {
  $('s-size').value = cfg.size; $('s-size-v').textContent = `${cfg.size}×${cfg.size}`;
  $('s-per').value = cfg.perType; $('s-per-v').textContent = cfg.perType;
  $('s-acts').value = cfg.actionsPerTurn; $('s-acts-v').textContent = cfg.actionsPerTurn;
  $('s-move').value = cfg.moveStyle; $('s-cap').value = cfg.capture;
  $('s-terr').value = cfg.territory ? 'territory' : 'elimination';
  $('s-retread').checked = cfg.retread; $('s-first').value = cfg.first;
  $('s-coords').checked = cfg.coords; $('s-hints').checked = cfg.hints;
  $('name-input').value = name;
  $('retread-row').style.display = cfg.territory ? '' : 'none';
  updateVariantLine(); markPreset();
}
function readHome() {
  cfg.size = +$('s-size').value; cfg.perType = +$('s-per').value; cfg.actionsPerTurn = +$('s-acts').value;
  cfg.moveStyle = $('s-move').value; cfg.capture = $('s-cap').value;
  cfg.territory = $('s-terr').value === 'territory'; cfg.retread = $('s-retread').checked && cfg.territory;
  cfg.first = $('s-first').value; cfg.coords = $('s-coords').checked; cfg.hints = $('s-hints').checked;
  saveCfg(); updateVariantLine(); markPreset();
}
function updateVariantLine() { $('variant-line').textContent = E.variantLabel(E.sanitizeCfg(cfg)); }
function markPreset() { const cur = E.presetOf(E.sanitizeCfg(cfg)); for (const ch of document.querySelectorAll('#presets .chip')) ch.classList.toggle('on', ch.dataset.preset === cur); }

$('s-size').oninput = () => { $('s-size-v').textContent = `${$('s-size').value}×${$('s-size').value}`; readHome(); };
$('s-per').oninput = () => { $('s-per-v').textContent = $('s-per').value; readHome(); };
$('s-acts').oninput = () => { $('s-acts-v').textContent = $('s-acts').value; readHome(); };
for (const id of ['s-move', 's-cap', 's-first', 's-coords', 's-hints', 's-retread']) $(id).onchange = readHome;
$('s-terr').onchange = () => { $('retread-row').style.display = $('s-terr').value === 'territory' ? '' : 'none'; readHome(); };
$('name-input').oninput = () => { name = ($('name-input').value || '').replace(/[^\w \-]/g, '').slice(0, 20) || ('guest-' + Math.random().toString(36).slice(2, 6)); localStorage.setItem('janken-name', name); };
for (const ch of document.querySelectorAll('#presets .chip')) ch.onclick = () => { const p = ch.dataset.preset; if (p !== 'custom' && E.PRESETS[p]) { Object.assign(cfg, E.PRESETS[p]); saveCfg(); fillHome(); } };

for (const b of document.querySelectorAll('.play [data-mode]')) b.onclick = () => {
  readHome();
  const m = b.dataset.mode;
  if (m === 'online') startOnline(genRoom(), { host: true });
  else startLocal(m);
};

// lobby
async function refreshLobby() {
  try {
    const r = await fetch('/api/lobby'); const { games } = await r.json();
    const list = $('games'), empty = $('lobby-empty');
    if (!games || !games.length) { list.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true; list.innerHTML = '';
    for (const g of games) {
      const li = document.createElement('li'); li.className = 'game-row';
      li.innerHTML = `<span class="gr-host"></span><span class="gr-var"></span><button class="btn sm">Join</button>`;
      li.querySelector('.gr-host').textContent = g.host || 'guest';
      li.querySelector('.gr-var').textContent = g.variant || '';
      li.querySelector('button').onclick = () => startOnline(g.room);
      list.appendChild(li);
    }
  } catch { }
}
function startLobbyPoll() { stopLobbyPoll(); refreshLobby(); lobbyTimer = setInterval(refreshLobby, 4000); }
function stopLobbyPoll() { if (lobbyTimer) clearInterval(lobbyTimer); lobbyTimer = null; }
$('refresh-lobby').onclick = refreshLobby;
$('custom-btn').onclick = () => { readHome(); enterEdit(); };

// ── appearance ────────────────────────────────────────────────────────────────
const PSTYLES = [['line', 'Line'], ['pixel', 'Pixel']];
function buildPStyle() {
  const el = $('pstyle'); el.innerHTML = '';
  for (const [val, label] of PSTYLES) {
    const o = document.createElement('button'); o.type = 'button'; o.className = 'opt'; o.dataset.style = val;
    o.innerHTML = `<div class="row">${glyph('rock', 'R', val)}${glyph('paper', 'B', val)}${glyph('scissors', 'R', val)}</div><div class="nm">${label}</div>`;
    o.onclick = () => { cfg.pieceStyle = val; saveCfg(); markPStyle(); renderLegend(); buildPalette(); if (document.body.dataset.screen === 'game') render(); };
    el.appendChild(o);
  }
  markPStyle();
}
function markPStyle() { for (const o of $('pstyle').children) o.classList.toggle('on', o.dataset.style === cfg.pieceStyle); }
$('pieces-btn').onclick = () => { buildPStyle(); $('pieces').showModal(); };

// ── controls / chrome ─────────────────────────────────────────────────────────
$('new-btn').onclick = newGame;
$('home-btn').onclick = showHome;
$('brand').onclick = (e) => { e.preventDefault(); showHome(); };
$('takeback').onclick = () => {
  if (net || positions.length <= 1) return;
  positions.pop(); loadLive(positions[liveIndex()]);
  if (mode === 'bot') while (positions.length > 1 && state.turn === BOTSIDE) { positions.pop(); loadLive(positions[liveIndex()]); }
  state.thinking = false; viewPly = liveIndex(); render();
  if (botToMove()) maybeBot();
};
$('nav-prev').onclick = () => nav(viewPly - 1);
$('nav-next').onclick = () => nav(viewPly + 1);
$('nav-start').onclick = () => nav(0);
$('nav-end').onclick = () => nav(liveIndex());
$('help-btn').onclick = () => $('rules').showModal();
$('flip-btn').onclick = () => { flipped = !flipped; localStorage.setItem('janken-flip', flipped ? '1' : '0'); render(); };
$('copy-btn').onclick = async () => {
  const rows = []; let cur = null;
  for (const m of state.moves) { if (m.c === BLUE) { cur = [rows.length + 1, m.t, '']; rows.push(cur); } else { if (!cur) { cur = [rows.length + 1, '', '']; rows.push(cur); } cur[2] = m.t; } }
  const text = `JANKEN ${E.variantLabel(cfg)}\n` + rows.map(r => `${r[0]}. ${r[1]}${r[2] ? '   ' + r[2] : ''}`).join('\n');
  try { await navigator.clipboard.writeText(text); const b = $('copy-btn'); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); } catch { }
};
$('ocopy').onclick = async () => { try { await navigator.clipboard.writeText($('oshare').value); const b = $('ocopy'); b.textContent = 'copied'; setTimeout(() => b.textContent = 'copy link', 1200); } catch { } };

function applyTheme(t) { document.documentElement.dataset.theme = t; document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#000000' : '#ffffff'); localStorage.setItem('janken-theme', t); }
$('theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// footer commit
fetch('/version.json').then(r => r.json()).then(v => { if (v && v.short) { const a = $('commit-link'); a.href = v.url; a.textContent = v.short; } }).catch(() => { });

// ── boot ────────────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('janken-theme') || 'dark');
buildPalette();
build(cfg.size);
renderLegend();
window.addEventListener('hashchange', () => {
  const room = (location.hash.match(/r=([a-z0-9_-]+)/i) || [])[1];
  if (room) { if (!net || net.room !== room) startOnline(room); }
  else if (net) showHome();
});
const hashRoom = (location.hash.match(/r=([a-z0-9_-]+)/i) || [])[1];
if (hashRoom) { fillHome(); startOnline(hashRoom); }
else showHome();
if (!localStorage.getItem('janken-seen')) { $('rules').showModal(); localStorage.setItem('janken-seen', '1'); }
