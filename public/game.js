// JANKEN client — homepage, local play (hot-seat / bot / bot-vs-bot), and online rooms.
// All rules live in engine.js (shared with the server), so hints match server validation.
import * as E from '/engine.js';
const { BLUE, RED, other } = E;

// ── config + identity (persisted) ───────────────────────────────────────────
const DEFAULTS = { size: 9, perType: 2, moveStyle: 'classic', capture: 'rps', territory: true, retread: false, actionsPerTurn: 1, first: BLUE, coords: true, hints: true, pieceStyle: 'line' };
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage is optional */ } },
};
function storedObject(key) {
  try {
    const value = JSON.parse(store.get(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
const savedCfg = storedObject('janken-cfg');
const rulesCfg = E.sanitizeCfg(savedCfg);
const cfg = {
  ...DEFAULTS,
  ...rulesCfg,
  coords: savedCfg.coords !== false,
  hints: savedCfg.hints !== false,
  pieceStyle: ['line', 'pixel'].includes(savedCfg.pieceStyle) ? savedCfg.pieceStyle : 'line',
};
const saveCfg = () => store.set('janken-cfg', JSON.stringify(cfg));
const randomGuest = () => {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return 'guest-' + [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 4);
};
let flipped = store.get('janken-flip') === '1';
let name = store.get('janken-name') || randomGuest();
store.set('janken-name', name);

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
const state = { board: E.blocksBoard(cfg.size, cfg.perType), turn: BLUE, acts: 0, selected: null, targets: [], lastMove: null, justMovedTo: null, moves: [], passStreak: 0, gameOver: false, dry: 0, thinking: false, cfg };
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
  if (net) return net.connected && net.role === color;
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
let slots = [], curSize = 0, paletteBuilt = false, lastLogKey = '';
function build(size) {
  boardEl.innerHTML = ''; slots = [];
  boardEl.style.gridTemplateColumns = `repeat(${size},1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${size},1fr)`;
  for (let dr = 0; dr < size; dr++) {
    slots[dr] = [];
    for (let dc = 0; dc < size; dc++) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'sq'; btn.dataset.dr = dr; btn.dataset.dc = dc;
      btn.setAttribute('role', 'gridcell');
      const rank = document.createElement('span'); rank.className = 'coord rank'; rank.hidden = true;
      const file = document.createElement('span'); file.className = 'coord file'; file.hidden = true;
      const pcw = document.createElement('span'); pcw.className = 'pcw';
      btn.append(rank, file, pcw);
      boardEl.appendChild(btn);
      slots[dr][dc] = { btn, rank, file, pcw, pieceKey: null, label: null };
    }
  }
  curSize = size;
}
const toBoard = (dr, dc, size) => flipped ? [size - 1 - dr, size - 1 - dc] : [dr, dc];

// ── render ──────────────────────────────────────────────────────────────────
function renderLegend() { $('legend').innerHTML = (MOVES_DESC[cfg.moveStyle] || MOVES_DESC.classic).map(([p, t, d]) => `<div class="lg"><span class="glyph">${legendGlyph(p)}</span><span class="lt">${t}</span><span class="lm">${d}</span></div>`).join(''); }

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
  const targetKeys = new Set(state.targets.map(([r, c]) => `${r}:${c}`));
  for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
    const [r, c] = toBoard(dr, dc, size);
    const cell = board[r][c], s = slots[dr][dc];
    let cls = 'sq' + (((r + c) % 2 === 0) ? ' light' : '');
    if (tint && cell.owner === BLUE) cls += ' own-B'; else if (tint && cell.owner === RED) cls += ' own-R';
    if (lastMove && ((lastMove.fr === r && lastMove.fc === c) || (lastMove.tr === r && lastMove.tc === c))) cls += ' last';
    if (boardMode === 'play') {
      if (state.selected && state.selected.r === r && state.selected.c === c) cls += ' sel';
      if (cfg.hints && targetKeys.has(`${r}:${c}`)) cls += cell.piece ? ' target-cap' : ' target';
    }
    if (state.justMovedTo && state.justMovedTo.r === r && state.justMovedTo.c === c && isLive() && !editing) cls += ' pop';
    if (s.btn.className !== cls) s.btn.className = cls;
    const pieceKey = cell.piece ? `${cell.piece.color}:${cell.piece.type}:${cfg.pieceStyle}` : '';
    if (s.pieceKey !== pieceKey) {
      s.pcw.innerHTML = cell.piece ? glyph(cell.piece.type, cell.piece.color) : '';
      s.pieceKey = pieceKey;
    }
    const label = cell.piece
      ? `${cell.piece.color === BLUE ? 'Blue' : 'Red'} ${cell.piece.type} on ${E.sqName(r, c, size)}`
      : `Empty ${E.sqName(r, c, size)}`;
    if (s.label !== label) { s.btn.setAttribute('aria-label', label); s.label = label; }
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
  const key = state.moves.map((move) => `${move.c}:${move.t}`).join('|');
  if (key === lastLogKey) return;
  lastLogKey = key;
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
    if (net) { sendNet({ type: 'move', from: [m.fr, m.fc], to: [m.tr, m.tc] }); state.selected = null; state.targets = []; render(); }
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
  if (net) { sendNet({ type: 'new', cfg }); return; }
  if (curSize !== cfg.size) build(cfg.size);
  freshLocal();
  positions = [snap()]; viewPly = 0;
  renderLegend(); render(); maybeBot();
}
function startLocal(m) { leaveOnline(); gen++; mode = m; $('online').hidden = true; $('players').hidden = true; showGame(); newGame(); }

// ── online ───────────────────────────────────────────────────────────────────
const genRoom = () => { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };
function startOnline(room, opts = {}) {
  leaveOnline(); gen++; mode = 'online';
  const session = {
    ws: null,
    room,
    role: null,
    token: store.get('janken-tok-' + room) || null,
    names: {},
    seats: {},
    online: {},
    connected: false,
    stopped: false,
    status: 'connecting',
    attempt: 0,
    timer: null,
    socketGeneration: 0,
    hostConfig: !!opts.host,
    error: '',
  };
  net = session;
  showGame(); $('players').hidden = false; $('online').hidden = false;
  if (curSize !== cfg.size) build(cfg.size);
  renderLegend();
  connectOnline(session);
  location.hash = 'r=' + room;
  updateOnlineUI();
}
function connectOnline(session) {
  if (net !== session || session.stopped) return;
  if (!navigator.onLine) {
    session.status = 'offline';
    updateOnlineUI();
    return scheduleReconnect(session);
  }
  const socketGeneration = ++session.socketGeneration;
  session.status = session.attempt ? 'reconnecting' : 'connecting';
  session.error = '';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ room: session.room, name });
  if (session.token) params.set('token', session.token);
  else if (session.hostConfig) params.set('cfg', btoa(JSON.stringify(E.sanitizeCfg(cfg))));
  const ws = new WebSocket(`${proto}://${location.host}/ws?${params.toString()}`);
  session.ws = ws;
  const current = () => net === session && !session.stopped && session.socketGeneration === socketGeneration;
  ws.onopen = () => {
    if (!current()) return ws.close();
    session.connected = true;
    session.status = 'connected';
    updateOnlineUI();
  };
  ws.onmessage = (event) => {
    if (!current()) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    onNet(session, message);
  };
  ws.onclose = (event) => {
    if (!current()) return;
    session.connected = false;
    session.ws = null;
    if (event.code === 4000 || event.code === 4001) {
      session.stopped = true;
      session.status = 'replaced';
      updateOnlineUI();
      return;
    }
    scheduleReconnect(session);
  };
  ws.onerror = () => {
    if (!current()) return;
    session.connected = false;
    updateOnlineUI();
  };
  updateOnlineUI();
}
function scheduleReconnect(session, immediate = false) {
  if (net !== session || session.stopped || session.timer) return;
  if (!navigator.onLine) {
    session.status = 'offline';
    updateOnlineUI();
    return;
  }
  session.status = 'reconnecting';
  const base = Math.min(15000, 500 * (2 ** Math.min(session.attempt, 5)));
  const delay = immediate ? 0 : Math.round(base * (0.8 + Math.random() * 0.4));
  session.attempt++;
  updateOnlineUI();
  session.timer = setTimeout(() => {
    session.timer = null;
    connectOnline(session);
  }, delay);
}
function sendNet(message) {
  if (!net || !net.connected || !net.ws || net.ws.readyState !== WebSocket.OPEN) return false;
  try { net.ws.send(JSON.stringify(message)); return true; } catch { return false; }
}
function onNet(session, message) {
  if (net !== session) return;
  if (message.type === 'welcome') {
    session.role = message.role;
    session.token = message.token;
    session.attempt = 0;
    session.status = 'connected';
    store.set('janken-tok-' + session.room, message.token);
    applyServerState(message.state);
  } else if (message.type === 'state') {
    applyServerState(message.state);
  } else if (message.type === 'error') {
    session.error = message.msg || 'Move rejected';
    updateOnlineUI();
  } else if (message.type === 'expired') {
    session.stopped = true;
    session.connected = false;
    session.status = 'expired';
    updateOnlineUI();
  }
}
function applyServerState(s) {
  if (!s || !s.cfg || !Array.isArray(s.board)) return;
  Object.assign(cfg, E.sanitizeCfg(s.cfg));
  if (curSize !== cfg.size) build(cfg.size);
  Object.assign(state, { board: s.board, turn: s.turn, acts: s.acts || 0, moves: Array.isArray(s.moves) ? s.moves : [], gameOver: !!s.gameOver, lastMove: s.lastMove || null, passStreak: 0, dry: 0, thinking: false, selected: null, targets: [] });
  net.names = s.names || {}; net.seats = s.seats || {}; net.online = s.online || {};
  net.error = '';
  positions = [snap()]; viewPly = 0;
  renderLegend(); render(); updateOnlineUI();
}
function updateOnlineUI() {
  if (!net) { $('online').hidden = true; $('players').hidden = true; return; }
  $('online').hidden = false; $('players').hidden = false;
  const connectionClass = net.status === 'connected' ? '' : ['expired', 'replaced'].includes(net.status) ? ' off' : ' waiting';
  $('orole').className = 'orole ' + (net.role === 'B' ? 'b' : net.role === 'R' ? 'r' : 'on') + connectionClass;
  let label = net.role === 'B' ? 'You are Blue' : net.role === 'R' ? 'You are Red' : 'Spectating';
  if (net.status === 'connecting') label = 'Connecting…';
  else if (net.status === 'reconnecting') label = `Reconnecting… attempt ${net.attempt}`;
  else if (net.status === 'offline') label = 'Offline · waiting for network';
  else if (net.status === 'expired') label = 'Room expired · return home';
  else if (net.status === 'replaced') label = 'Seat continued in another tab';
  else if (net.error) label = net.error;
  else if (net.role !== 'S' && !(net.seats.B && net.seats.R)) label += ' · waiting for opponent';
  $('orole-text').textContent = label;
  $('oshare').value = location.origin + '/#r=' + net.room;
  const blue = $('pl-b').parentElement, red = $('pl-r').parentElement;
  blue.classList.toggle('offline', !!net.seats.B && net.online.B === false);
  red.classList.toggle('offline', !!net.seats.R && net.online.R === false);
  $('pl-b').textContent = (net.names.B || (net.seats.B ? 'Blue' : '— open')) + (net.role === 'B' ? ' (you)' : '');
  $('pl-r').textContent = (net.names.R || (net.seats.R ? 'Red' : '— open')) + (net.role === 'R' ? ' (you)' : '');
}
function leaveOnline() {
  gen++;
  const session = net;
  net = null;
  if (!session) return;
  session.stopped = true;
  if (session.timer) clearTimeout(session.timer);
  if (session.ws) try { session.ws.close(1000, 'left room'); } catch { /* already closed */ }
}

// ── editor ────────────────────────────────────────────────────────────────────
function buildPalette() {
  const pal = $('palette'); pal.innerHTML = '';
  for (const color of [BLUE, RED]) for (const type of ['rock', 'paper', 'scissors']) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pal'; b.dataset.type = type; b.dataset.color = color; b.innerHTML = glyph(type, color);
    b.onclick = () => { tool = { type, color }; markTool(); }; pal.appendChild(b);
  }
  const er = document.createElement('button'); er.type = 'button'; er.className = 'pal erase'; er.textContent = 'erase'; er.dataset.erase = '1';
  er.onclick = () => { tool = 'erase'; markTool(); }; pal.appendChild(er); markTool();
  paletteBuilt = true;
}
function markTool() { for (const b of $('palette').children) b.classList.toggle('on', tool === 'erase' ? b.dataset.erase === '1' : (b.dataset.type === tool.type && b.dataset.color === tool.color)); }
function enterEdit() { gen++; leaveOnline(); mode = 'human'; showGame(); if (curSize !== cfg.size) build(cfg.size); if (!paletteBuilt) buildPalette(); editing = true; editBoard = E.blocksBoard(cfg.size, cfg.perType); $('panel').hidden = true; $('editpanel').hidden = false; $('online').hidden = true; $('players').hidden = true; render(); }
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
let previewPiece = 'rock';
function previewGlyph(type, x, y, size) {
  return glyph(type, BLUE).replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
}
function renderVariantPreview() {
  const safe = E.sanitizeCfg(cfg);
  const size = safe.size;
  const board = E.emptyBoard(size);
  const origin = Math.floor(size / 2);
  board[origin][origin] = { owner: BLUE, piece: { type: previewPiece, color: BLUE } };
  const targets = E.legalDest(board, origin, origin, safe);
  const pad = 10;
  const span = 220;
  const cell = span / size;
  const center = (index) => pad + (index + 0.5) * cell;
  const ox = center(origin), oy = center(origin);
  const farthest = new Map();
  for (const [row, col] of targets) {
    const dr = Math.sign(row - origin), dc = Math.sign(col - origin);
    const distance = Math.max(Math.abs(row - origin), Math.abs(col - origin));
    const key = `${dr}:${dc}`;
    if (!farthest.has(key) || farthest.get(key).distance < distance) {
      farthest.set(key, { row, col, distance });
    }
  }

  const gridLines = [];
  for (let index = 0; index <= size; index++) {
    const offset = pad + index * cell;
    gridLines.push(`M ${offset} ${pad} V ${pad + span} M ${pad} ${offset} H ${pad + span}`);
  }
  const arrows = [];
  for (const { row, col } of farthest.values()) {
    const tx = center(col), ty = center(row);
    const dx = tx - ox, dy = ty - oy, length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    const start = Math.min(cell * 0.32, length * 0.25);
    const end = Math.min(cell * 0.34, length * 0.28);
    arrows.push(`<line class="pv-arrow" x1="${ox + ux * start}" y1="${oy + uy * start}" x2="${tx - ux * end}" y2="${ty - uy * end}" marker-end="url(#preview-arrow)"/>`);
  }
  const dots = targets.map(([row, col]) =>
    `<circle class="pv-target" cx="${center(col)}" cy="${center(row)}" r="${Math.max(1.7, Math.min(3.4, cell * 0.11))}"/>`,
  );
  const iconSize = Math.max(13, cell * 0.78);
  $('preview-board').innerHTML = `
    <defs>
      <pattern id="preview-checks" x="${pad}" y="${pad}" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">
        <rect class="pv-pattern-base" width="${cell * 2}" height="${cell * 2}"/>
        <rect class="pv-pattern-alt" width="${cell}" height="${cell}"/>
        <rect class="pv-pattern-alt" x="${cell}" y="${cell}" width="${cell}" height="${cell}"/>
      </pattern>
      <marker id="preview-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path class="pv-arrowhead" d="M0 0 L8 4 L0 8 Z"/></marker>
    </defs>
    <rect x="${pad}" y="${pad}" width="${span}" height="${span}" fill="url(#preview-checks)"/>
    <path class="pv-grid" d="${gridLines.join(' ')}"/>
    ${arrows.join('')}${dots.join('')}
    <circle class="pv-origin" cx="${ox}" cy="${oy}" r="${Math.max(7, cell * 0.42)}"/>
    ${previewGlyph(previewPiece, ox - iconSize / 2, oy - iconSize / 2, iconSize)}
  `;
  for (const tab of $('preview-tabs').children) {
    tab.setAttribute('aria-pressed', String(tab.dataset.previewPiece === previewPiece));
  }
  const [, pieceName, movement] = (MOVES_DESC[safe.moveStyle] || MOVES_DESC.classic)
    .find(([type]) => type === previewPiece);
  $('preview-description').textContent = `${pieceName} ${movement}; ${targets.length} legal destination${targets.length === 1 ? '' : 's'} from the centre.`;
  const capture = safe.capture === 'rps' ? 'RPS captures' : 'capture any piece';
  const goal = safe.territory ? (safe.retread ? 'territory + re-tread' : 'new territory only') : 'elimination';
  $('preview-facts').textContent = `${safe.size}×${safe.size} · ${safe.perType} / type · ${safe.actionsPerTurn} action${safe.actionsPerTurn === 1 ? '' : 's'} · ${capture} · ${goal}`;
}
for (const tab of $('preview-tabs').children) {
  tab.onclick = () => { previewPiece = tab.dataset.previewPiece; renderVariantPreview(); };
}

let lobbyTimer = null, lobbyRequest = null, lobbyFailures = 0;
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
  $('retread-row').hidden = !cfg.territory;
  updateVariantLine(); markPreset(); renderVariantPreview();
}
function readHome() {
  cfg.size = +$('s-size').value; cfg.perType = +$('s-per').value; cfg.actionsPerTurn = +$('s-acts').value;
  cfg.moveStyle = $('s-move').value; cfg.capture = $('s-cap').value;
  cfg.territory = $('s-terr').value === 'territory'; cfg.retread = $('s-retread').checked && cfg.territory;
  cfg.first = $('s-first').value; cfg.coords = $('s-coords').checked; cfg.hints = $('s-hints').checked;
  saveCfg(); updateVariantLine(); markPreset(); renderVariantPreview();
}
function updateVariantLine() { $('variant-line').textContent = E.variantLabel(E.sanitizeCfg(cfg)); }
function markPreset() { const cur = E.presetOf(E.sanitizeCfg(cfg)); for (const ch of document.querySelectorAll('#presets .chip')) ch.classList.toggle('on', ch.dataset.preset === cur); }

$('s-size').oninput = () => { $('s-size-v').textContent = `${$('s-size').value}×${$('s-size').value}`; readHome(); };
$('s-per').oninput = () => { $('s-per-v').textContent = $('s-per').value; readHome(); };
$('s-acts').oninput = () => { $('s-acts-v').textContent = $('s-acts').value; readHome(); };
for (const id of ['s-move', 's-cap', 's-first', 's-coords', 's-hints', 's-retread']) $(id).onchange = readHome;
$('s-terr').onchange = () => { $('retread-row').hidden = $('s-terr').value !== 'territory'; readHome(); };
$('name-input').oninput = () => { name = ($('name-input').value || '').replace(/[^\w \-]/g, '').slice(0, 20) || randomGuest(); store.set('janken-name', name); };
for (const ch of document.querySelectorAll('#presets .chip')) ch.onclick = () => { const p = ch.dataset.preset; if (p !== 'custom' && E.PRESETS[p]) { Object.assign(cfg, E.PRESETS[p]); saveCfg(); fillHome(); } };

for (const b of document.querySelectorAll('.play [data-mode]')) b.onclick = () => {
  readHome();
  const m = b.dataset.mode;
  if (m === 'online') startOnline(genRoom(), { host: true });
  else startLocal(m);
};

// lobby
function scheduleLobbyPoll(delay) {
  if (lobbyTimer) clearTimeout(lobbyTimer);
  if (document.body.dataset.screen !== 'home' || document.hidden) return;
  lobbyTimer = setTimeout(() => refreshLobby(), delay);
}
async function refreshLobby(manual = false) {
  if (lobbyRequest || document.body.dataset.screen !== 'home' || (document.hidden && !manual)) return;
  const controller = new AbortController();
  lobbyRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch('/api/lobby', { cache: 'no-store', signal: controller.signal });
    if (!r.ok) throw new Error(`lobby ${r.status}`);
    const { games } = await r.json();
    const list = $('games'), empty = $('lobby-empty');
    lobbyFailures = 0;
    if (!Array.isArray(games) || !games.length) {
      list.innerHTML = '';
      empty.textContent = 'No open games right now — create one and share the link.';
      empty.hidden = false;
      return;
    }
    empty.hidden = true; list.innerHTML = '';
    for (const g of games) {
      if (!g || !/^[a-z0-9_-]{1,40}$/i.test(g.room || '')) continue;
      const li = document.createElement('li'); li.className = 'game-row';
      li.innerHTML = `<span class="gr-host"></span><span class="gr-var"></span><button class="btn sm">Join</button>`;
      li.querySelector('.gr-host').textContent = g.host || 'guest';
      li.querySelector('.gr-var').textContent = g.variant || '';
      li.querySelector('button').onclick = () => startOnline(g.room);
      list.appendChild(li);
    }
    if (!list.children.length) {
      empty.textContent = 'No open games right now — create one and share the link.';
      empty.hidden = false;
    }
  } catch (error) {
    if (error.name !== 'AbortError') lobbyFailures++;
    if (!$('games').children.length) {
      $('lobby-empty').textContent = navigator.onLine ? 'Open games could not be refreshed. Retrying…' : 'You are offline. Open games will return when connected.';
      $('lobby-empty').hidden = false;
    }
  } finally {
    clearTimeout(timeout);
    if (lobbyRequest === controller) lobbyRequest = null;
    const delay = Math.min(60000, 12000 * (2 ** Math.min(lobbyFailures, 3)));
    scheduleLobbyPoll(delay);
  }
}
function startLobbyPoll() { stopLobbyPoll(); lobbyFailures = 0; refreshLobby(true); }
function stopLobbyPoll() {
  if (lobbyTimer) clearTimeout(lobbyTimer);
  lobbyTimer = null;
  if (lobbyRequest) lobbyRequest.abort();
  lobbyRequest = null;
}
$('refresh-lobby').onclick = () => refreshLobby(true);
$('custom-btn').onclick = () => { readHome(); enterEdit(); };

// ── appearance ────────────────────────────────────────────────────────────────
const PSTYLES = [['line', 'Line'], ['pixel', 'Pixel']];
function buildPStyle() {
  const el = $('pstyle'); el.innerHTML = '';
  for (const [val, label] of PSTYLES) {
    const o = document.createElement('button'); o.type = 'button'; o.className = 'opt'; o.dataset.style = val;
    o.innerHTML = `<div class="row">${glyph('rock', 'R', val)}${glyph('paper', 'B', val)}${glyph('scissors', 'R', val)}</div><div class="nm">${label}</div>`;
    o.onclick = () => {
      cfg.pieceStyle = val; saveCfg(); markPStyle(); renderVariantPreview();
      if (curSize) renderLegend();
      if (paletteBuilt) buildPalette();
      if (document.body.dataset.screen === 'game') render();
    };
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
$('help-btn').onclick = () => {
  $('help-btn').classList.remove('attention');
  store.set('janken-seen', '1');
  $('rules').showModal();
};
$('flip-btn').onclick = () => { flipped = !flipped; store.set('janken-flip', flipped ? '1' : '0'); render(); };
$('copy-btn').onclick = async () => {
  const rows = []; let cur = null;
  for (const m of state.moves) { if (m.c === BLUE) { cur = [rows.length + 1, m.t, '']; rows.push(cur); } else { if (!cur) { cur = [rows.length + 1, '', '']; rows.push(cur); } cur[2] = m.t; } }
  const text = `JANKEN ${E.variantLabel(cfg)}\n` + rows.map(r => `${r[0]}. ${r[1]}${r[2] ? '   ' + r[2] : ''}`).join('\n');
  try { await navigator.clipboard.writeText(text); const b = $('copy-btn'); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); } catch { }
};
$('ocopy').onclick = async () => { try { await navigator.clipboard.writeText($('oshare').value); const b = $('ocopy'); b.textContent = 'copied'; setTimeout(() => b.textContent = 'copy link', 1200); } catch { } };

function applyTheme(t) { document.documentElement.dataset.theme = t; document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#000000' : '#ffffff'); store.set('janken-theme', t); }
$('theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// footer commit
fetch('/version.json').then(r => r.json()).then(v => { if (v && v.short) { const a = $('commit-link'); a.href = v.url; a.textContent = v.short; } }).catch(() => { });

// ── boot ────────────────────────────────────────────────────────────────────
applyTheme(store.get('janken-theme') || 'dark');
window.addEventListener('online', () => {
  if (net && !net.stopped) {
    if (net.timer) clearTimeout(net.timer);
    net.timer = null;
    scheduleReconnect(net, true);
  } else if (document.body.dataset.screen === 'home') {
    refreshLobby(true);
  }
});
window.addEventListener('offline', () => {
  if (!net || net.stopped) return;
  net.connected = false;
  net.status = 'offline';
  if (net.timer) clearTimeout(net.timer);
  net.timer = null;
  updateOnlineUI();
});
document.addEventListener('visibilitychange', () => {
  if (document.body.dataset.screen !== 'home') return;
  if (document.hidden) {
    if (lobbyTimer) clearTimeout(lobbyTimer);
    lobbyTimer = null;
  } else {
    refreshLobby(true);
  }
});
window.addEventListener('hashchange', () => {
  const room = (location.hash.match(/r=([a-z0-9_-]+)/i) || [])[1];
  if (room) { if (!net || net.room !== room) startOnline(room); }
  else if (net) showHome();
});
const hashRoom = (location.hash.match(/r=([a-z0-9_-]+)/i) || [])[1];
if (hashRoom) { fillHome(); startOnline(hashRoom); }
else showHome();
if (!store.get('janken-seen')) $('help-btn').classList.add('attention');
