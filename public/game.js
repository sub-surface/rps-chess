// JANKEN client — homepage, local play (hot-seat / bot / bot-vs-bot), and online rooms.
// All rules live in engine.js (shared with the server), so hints match server validation.
import * as E from '/engine.js';
import { exportJpgn } from '/notation.js';
const { BLUE, RED, other } = E;

// ── config + identity (persisted) ───────────────────────────────────────────
const DEFAULTS = { ...E.PRESETS.standard, coords: true, hints: true, sound: true, pieceStyle: 'line' };
const PIECE_STYLES = ['line', 'solid', 'pixel', 'kanji'];
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
// Standard used the legacy "classic" R-king/P-rook/S-bishop mapping before
// per-piece movement fields existed. Only migrate that exact old preset shape;
// other legacy custom variants retain their original movement semantics.
const legacyStandard = !['rockMove', 'paperMove', 'scissorsMove'].some((field) => field in savedCfg)
  && savedCfg.moveStyle === 'classic'
  && rulesCfg.size === 9
  && rulesCfg.perType === 2
  && rulesCfg.capture === 'rps'
  && rulesCfg.territory
  && !rulesCfg.trail
  && rulesCfg.layout === 'rows'
  && rulesCfg.actionsPerTurn === 1
  && rulesCfg.first === BLUE;
if (legacyStandard) {
  Object.assign(rulesCfg, E.PRESETS.standard);
}
const cfg = {
  ...DEFAULTS,
  ...rulesCfg,
  coords: savedCfg.coords !== false,
  hints: savedCfg.hints !== false,
  sound: savedCfg.sound !== false,
  pieceStyle: PIECE_STYLES.includes(savedCfg.pieceStyle) ? savedCfg.pieceStyle : 'line',
};
// `cfg` is the live config the board plays under, so joining an online room overwrites its
// rules. `ownRules` is the variant this player chose, and only it is ever persisted —
// otherwise a visit to someone else's 13×13 game would quietly replace your saved preset.
let ownRules = E.sanitizeCfg(cfg);
const saveCfg = () => store.set('janken-cfg', JSON.stringify({
  ...ownRules,
  coords: cfg.coords, hints: cfg.hints, sound: cfg.sound, pieceStyle: cfg.pieceStyle,
}));
// Call after the player themselves changes the rules; plain saveCfg() is for view prefs.
const adoptRules = () => { ownRules = E.sanitizeCfg(cfg); saveCfg(); };
const randomGuest = () => {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return 'guest-' + [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 4);
};
let flipped = store.get('janken-flip') === '1';
let name = store.get('janken-name') || randomGuest();
store.set('janken-name', name);

// ── account (optional, device-bound; enables rated play) ────────────────────
let account = (() => { const a = storedObject('janken-acct'); return a.id && a.secret ? a : null; })();
let myRating = Number(store.get('janken-rating')) || null;
function setMyRating(rating) {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return;
  myRating = rating; store.set('janken-rating', String(rating));
  renderAccountUI();
}
async function api(path, body) {
  const response = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

// ── sounds — tiny synthesized clicks, no assets ──────────────────────────────
let audioCtx = null;
function blip(freq, dur = 0.06, gain = 0.05, type = 'sine') {
  if (!cfg.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + dur);
  } catch { /* audio is optional */ }
}
const soundMove = () => blip(220, 0.05, 0.045);
const soundCap = () => blip(150, 0.09, 0.06, 'square');
const soundEnd = () => { blip(392, 0.09, 0.05); setTimeout(() => blip(523, 0.14, 0.05), 100); };

// ── piece glyphs ─────────────────────────────────────────────────────────────
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
const SOLID = {
  rock: `<path d="M18 64 L30 36 L50 22 L72 34 L84 60 L70 82 L32 82 Z"/>`,
  paper: `<path d="M30 14 L62 14 L76 28 L76 86 L30 86 Z"/><path d="M62 14 L76 28 L62 28 Z" opacity=".45"/>
          <path d="M38 44 H68 M38 56 H68 M38 68 H58" stroke="currentColor" stroke-width="4" opacity=".35" fill="none"/>`,
  scissors: `<path d="M27 18 L37 13 L58 60 L48 66 Z"/><path d="M73 18 L63 13 L42 60 L52 66 Z"/>
             <circle cx="34" cy="76" r="10"/><circle cx="66" cy="76" r="10"/>`,
};
const KANJI = { rock: '石', paper: '紙', scissors: '鋏' };
function glyph(type, color, style) {
  style = style || cfg.pieceStyle;
  if (style === 'pixel') {
    const m = PIX[type]; let cells = '';
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) if (m[y][x] === 'X') cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    return `<svg class="pc pix pc-${color}" viewBox="0 0 12 12" fill="currentColor" stroke="none">${cells}</svg>`;
  }
  if (style === 'solid') return `<svg class="pc solid pc-${color}" viewBox="0 0 100 100" fill="currentColor" stroke="none">${SOLID[type]}</svg>`;
  if (style === 'kanji') return `<svg class="pc kanji pc-${color}" viewBox="0 0 100 100" fill="currentColor" stroke="none"><text x="50" y="57" text-anchor="middle" dominant-baseline="central" font-size="70" font-weight="600">${KANJI[type]}</text></svg>`;
  return `<svg class="pc pc-${color}" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="7">${LINE[type]}</svg>`;
}
const legendGlyph = (type) => glyph(type, 'B').replace('pc-B', 'pc');
const PIECE_NAMES = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
const moveDescription = (type, rules = cfg) => E.MOVEMENT_DESCRIPTIONS[E.movementFor(rules, type)];

// ── state ────────────────────────────────────────────────────────────────────
const initialBoard = E.blocksBoard(cfg.size, cfg.perType, cfg.layout);
const state = {
  board: initialBoard,
  startPos: E.encodePos(initialBoard),
  startOwners: E.encodeOwners(initialBoard),
  startedAt: Date.now(),
  turn: cfg.first,
  acts: 0,
  selected: null,
  targets: [],
  lastMove: null,
  justMovedTo: null,
  moves: [],
  passStreak: 0,
  gameOver: false,
  endReason: null,
  winner: null,
  dry: 0,
  thinking: false,
  cfg,
};
let positions = [], viewPly = 0;
let mode = 'human';        // 'human' | 'bot' | 'botbot' | (online → net set)
let net = null;
let gen = 0;               // bumps to cancel stale bot timeouts / sockets
let editing = false, editBoard = null, tool = 'move';
let edSel = null, edTargets = [];
const BOTSIDE = RED;

const liveIndex = () => positions.length - 1;
const isLive = () => viewPly === liveIndex();
const snap = () => JSON.stringify({
  board: state.board,
  startPos: state.startPos,
  startOwners: state.startOwners,
  startedAt: state.startedAt,
  turn: state.turn,
  acts: state.acts,
  moves: state.moves,
  passStreak: state.passStreak,
  gameOver: state.gameOver,
  endReason: state.endReason,
  winner: state.winner,
  lastMove: state.lastMove,
  dry: state.dry,
});
function loadLive(s) {
  const d = JSON.parse(s);
  Object.assign(state, {
    board: d.board,
    startPos: d.startPos,
    startOwners: d.startOwners,
    startedAt: d.startedAt,
    turn: d.turn,
    acts: d.acts,
    moves: d.moves,
    passStreak: d.passStreak,
    gameOver: d.gameOver,
    endReason: d.endReason || null,
    winner: d.winner || null,
    lastMove: d.lastMove,
    dry: d.dry,
    selected: null,
    targets: [],
    justMovedTo: null,
  });
}

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
    if (cfg.territory && cfg.trail) {
      const dr = Math.sign(m.tr - m.fr), dc = Math.sign(m.tc - m.fc);
      for (let r = m.fr + dr, c = m.fc + dc; r !== m.tr || c !== m.tc; r += dr, c += dc) {
        if (b[r][c].owner === null) b[r][c].owner = color;
      }
    }
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
  const cap = E.applyMove(state, m);
  state.justMovedTo = { r: m.tr, c: m.tc };
  state.selected = null; state.targets = [];
  positions.push(snap()); viewPly = liveIndex();
  if (state.gameOver) soundEnd(); else if (cap) soundCap(); else soundMove();
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
  annos.clear(); drawAnnos();
}
const toBoard = (dr, dc, size) => flipped ? [size - 1 - dr, size - 1 - dc] : [dr, dc];

// ── render ──────────────────────────────────────────────────────────────────
function renderLegend() {
  $('legend').innerHTML = ['rock', 'paper', 'scissors']
    .map((type) => `<div class="lg" title="${PIECE_NAMES[type]} ${E.MOVEMENT_SENTENCES[E.movementFor(cfg, type)]}"><span class="glyph">${legendGlyph(type)}</span><span class="lt">${PIECE_NAMES[type]}</span><span class="lm">${moveDescription(type)}</span></div>`)
    .join('');
  renderRulesFlap();   // the rules on screen always match the rules in play
}

function render() {
  const size = curSize;
  let board, lastMove, boardMode;
  if (editing) { board = editBoard; lastMove = null; boardMode = 'edit'; }
  else if (isLive()) { board = state.board; lastMove = state.lastMove; boardMode = canPlay() ? 'play' : 'lock'; }
  else { const d = JSON.parse(positions[viewPly]); board = d.board; lastMove = d.lastMove; boardMode = 'review'; }
  boardEl.classList.toggle('editing', boardMode === 'edit');
  boardEl.classList.toggle('movetool', boardMode === 'edit' && tool === 'move');
  boardEl.classList.toggle('review', boardMode === 'review');
  boardEl.classList.toggle('locked', boardMode === 'lock');

  const tint = cfg.territory || editing;
  const selected = boardMode === 'play' ? state.selected : boardMode === 'edit' && tool === 'move' ? edSel : null;
  const targets = boardMode === 'play' ? (cfg.hints ? state.targets : []) : boardMode === 'edit' && tool === 'move' ? edTargets : [];
  const targetKeys = new Set(targets.map(([r, c]) => `${r}:${c}`));
  for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
    const [r, c] = toBoard(dr, dc, size);
    const cell = board[r][c], s = slots[dr][dc];
    let cls = 'sq' + (((r + c) % 2 === 0) ? ' light' : '');
    if (tint && cell.owner === BLUE) cls += ' own-B'; else if (tint && cell.owner === RED) cls += ' own-R';
    if (lastMove && ((lastMove.fr === r && lastMove.fc === c) || (lastMove.tr === r && lastMove.tc === c))) cls += ' last';
    if (selected && selected.r === r && selected.c === c) cls += ' sel';
    if (targetKeys.has(`${r}:${c}`)) cls += cell.piece ? ' target-cap' : ' target';
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
  // A started online game can only be finished or resigned, never discarded.
  const liveOnline = !!net && !state.gameOver && state.moves.length > 0;
  $('new-btn').disabled = liveOnline;
  $('new-btn').title = liveOnline ? 'Finish or resign this game first' : '';
  $('ply').textContent = viewPly === 0 ? 'start' : `${viewPly} / ${liveIndex()}`;

  renderLog(); renderBanner(res);
}

function renderLog() {
  const key = state.moves.map((move) => `${move.c}:${move.t}`).join('|');
  if (key === lastLogKey) return;
  lastLogKey = key;
  const rows = []; let cur = null, ply = 0;
  for (const m of state.moves) {
    ply++;
    if (m.c === BLUE) { cur = { n: rows.length + 1, b: m.t, bp: ply, r: '', rp: 0 }; rows.push(cur); }
    else { if (!cur) { cur = { n: rows.length + 1, b: '', bp: 0, r: '', rp: 0 }; rows.push(cur); } cur.r = m.t; cur.rp = ply; }
  }
  const log = $('log');
  log.innerHTML = rows.map(row => `<li class="n">${row.n}.</li><span class="mv b" data-ply="${row.bp}">${row.b}</span><span class="mv r" data-ply="${row.rp}">${row.r}</span>`).join('');
  log.scrollTop = log.scrollHeight;
}
// Click a move to review that position (local games — online keeps only the live state).
$('log').onclick = (e) => {
  const mv = e.target.closest('.mv');
  if (!mv || net || !+mv.dataset.ply || +mv.dataset.ply > liveIndex()) return;
  nav(+mv.dataset.ply);
};

const fmtDelta = (d) => (d >= 0 ? '+' : '−') + Math.abs(Math.round(d));
function renderBanner(res) {
  const el = $('banner');
  if (!state.gameOver || editing || !isLive()) { el.hidden = true; return; }
  // An adjudicated (abandonment) result overrides the board score.
  const forced = net && state.winner ? state.winner : null;
  const side = forced || (res.B > res.R ? BLUE : res.R > res.B ? RED : null);
  const winner = side === BLUE ? 'Blue wins' : side === RED ? 'Red wins' : 'Draw';
  const cls = side === BLUE ? 'tb' : side === RED ? 'tr' : '';
  const win = side === BLUE ? 'win-b' : side === RED ? 'win-r' : 'win-d';
  const unit = res.metric === 'squares' ? '' : ' pieces';
  const lines = [];
  if (net && state.endReason === 'abandon') lines.push(`${side === BLUE ? 'Red' : 'Blue'} left the game`);
  else if (net && state.endReason === 'resign') lines.push(`${side === BLUE ? 'Red' : 'Blue'} resigned`);
  lines.push(`Blue ${res.B} · Red ${res.R}${unit}`);
  if (net && state.deltas) lines.push(`rating ${fmtDelta(state.deltas.B)} / ${fmtDelta(state.deltas.R)}`);
  else if (net && state.rated && state.ratingError) lines.push('rating could not be recorded');
  el.hidden = false;
  const analyse = net ? '' : '<button class="linklike" id="analyse-btn">analyse this position ▸</button>';
  el.innerHTML = `<div class="card ${win}"><b class="${cls}">${winner}</b><p>${lines.join('<br>')}</p><button class="btn" id="again-btn">${net ? 'Rematch' : 'New game'}</button>${analyse}</div>`;
  $('again-btn').onclick = newGame;
  if (!net) $('analyse-btn').onclick = () => enterEdit(E.cloneBoard(state.board));
}

// ── interaction (click-to-move and drag-and-drop share one commit path) ──────
function commitPlay(fr, fc, tr, tc) {
  if (net) { sendNet({ type: 'move', from: [fr, fc], to: [tr, tc] }); state.selected = null; state.targets = []; render(); }
  else doMove({ fr, fc, tr, tc });
}
let suppressClick = false;
function suppressTrailingClick() {
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
}
boardEl.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }   // a drag already handled this
  const b = e.target.closest('.sq'); if (!b) return;
  const [r, c] = toBoard(+b.dataset.dr, +b.dataset.dc, curSize);
  if (editing) return editClick(r, c);
  if (!canPlay()) return;
  if (state.selected && state.targets.some(t => t[0] === r && t[1] === c)) {
    commitPlay(state.selected.r, state.selected.c, r, c);
    return;
  }
  const p = state.board[r][c].piece;
  if (p && p.color === state.turn) { state.selected = { r, c }; state.targets = E.legalDest(state.board, r, c, cfg); }
  else { state.selected = null; state.targets = []; }
  render();
});

// Drag-and-drop: a click that moves past a threshold lifts the piece; the trailing
// native click is suppressed. Works in play and in the analysis board's move tool.
let drag = null;
const DRAG_MIN = 4;
function draggableAt(r, c) {
  if (editing) return tool === 'move' && !!editBoard[r][c].piece;
  return canPlay() && !!(state.board[r][c].piece && state.board[r][c].piece.color === state.turn);
}
function ghostFor(piece, sqEl) {
  const rect = sqEl.getBoundingClientRect();
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.style.width = rect.width + 'px'; g.style.height = rect.height + 'px';
  g.innerHTML = glyph(piece.type, piece.color);
  document.body.appendChild(g);
  return g;
}
boardEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  suppressClick = false;
  const sqEl = e.target.closest('.sq'); if (!sqEl) return;
  const [r, c] = toBoard(+sqEl.dataset.dr, +sqEl.dataset.dc, curSize);
  if (!draggableAt(r, c)) return;
  const piece = (editing ? editBoard : state.board)[r][c].piece;
  drag = { r, c, sqEl, piece, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, active: false, ghost: null };
});
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_MIN) return;
    drag.active = true;
    if (editing) { edSel = { r: drag.r, c: drag.c }; edTargets = E.legalDest(editBoard, drag.r, drag.c, E.sanitizeCfg(cfg)); }
    else { state.selected = { r: drag.r, c: drag.c }; state.targets = E.legalDest(state.board, drag.r, drag.c, cfg); }
    render();
    const pcw = drag.sqEl.querySelector('.pcw'); if (pcw) pcw.style.opacity = '.25';
    drag.ghost = ghostFor(drag.piece, drag.sqEl);
    try { boardEl.setPointerCapture(drag.pointerId); } catch { /* older browsers */ }
  }
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  e.preventDefault();
});
window.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag; drag = null;
  if (d.ghost) d.ghost.remove();
  const pcw = d.sqEl.querySelector('.pcw'); if (pcw) pcw.style.opacity = '';
  try { boardEl.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
  if (!d.active) return;   // it was a click; let the click handler select
  suppressTrailingClick();
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = hit && hit.closest ? hit.closest('.sq') : null;
  if (!sqEl || !boardEl.contains(sqEl)) return render();
  const [r, c] = toBoard(+sqEl.dataset.dr, +sqEl.dataset.dc, curSize);
  if (editing) {
    if (edSel && edTargets.some(t => t[0] === r && t[1] === c)) { analysisMove(edSel.r, edSel.c, r, c); edSel = null; edTargets = []; }
    render();
  } else if (state.selected && state.targets.some(t => t[0] === r && t[1] === c)) {
    commitPlay(state.selected.r, state.selected.c, r, c);
  } else render();
});
window.addEventListener('pointercancel', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (drag.ghost) drag.ghost.remove();
  const pcw = drag.sqEl.querySelector('.pcw'); if (pcw) pcw.style.opacity = '';
  drag = null; render();
});
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || (document.activeElement && document.activeElement.tagName === 'INPUT')) return;
  if (e.key === 'Escape') {
    if (!$('rules-flap').hidden) return toggleRulesFlap(false);
    if (editing) return cancelEdit();
    state.selected = null; state.targets = []; render(); return;
  }
  if ((e.key === 'f' || e.key === 'F') && document.body.dataset.screen === 'game') {
    flipped = !flipped; store.set('janken-flip', flipped ? '1' : '0'); render(); drawAnnos(); return;
  }
  if (editing || net) return;
  if (e.key === 'ArrowLeft') { nav(viewPly - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { nav(viewPly + 1); e.preventDefault(); }
  else if (e.key === 'Home') { nav(0); e.preventDefault(); }
  else if (e.key === 'End') { nav(liveIndex()); e.preventDefault(); }
});
function nav(to) { if (net) return; viewPly = Math.max(0, Math.min(liveIndex(), to)); state.selected = null; state.targets = []; render(); }

// ── annotations — right-click arrows and highlights, lichess-style ──────────
// Stored in board coordinates so they follow a flip. Left-click clears.
const annos = new Set();
let annoStart = null;
const ANNO_COLORS = { accent: 'var(--accent)', red: 'var(--red)', blue: 'var(--blue)', green: '#3fb950' };
const annoColor = (e) => e.shiftKey ? (e.altKey ? 'green' : 'red') : (e.altKey ? 'blue' : 'accent');
function drawAnnos() {
  const svg = $('anno'), size = curSize;
  if (!size || !annos.size) { svg.innerHTML = ''; return; }
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const defs = Object.entries(ANNO_COLORS).map(([key, color]) =>
    `<marker id="ah-${key}" viewBox="0 0 8 8" refX="5.4" refY="4" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${color}"/></marker>`).join('');
  const parts = [`<defs>${defs}</defs>`];
  for (const key of annos) {
    const seg = key.split(':');
    if (seg[0] === 'd') {
      const [dr, dc] = toBoard(+seg[1], +seg[2], size);
      parts.push(`<circle cx="${dc + 0.5}" cy="${dr + 0.5}" r="0.42" fill="none" stroke="${ANNO_COLORS[seg[3]]}" stroke-width="0.09" opacity="0.85"/>`);
    } else {
      const [fr, fc] = toBoard(+seg[1], +seg[2], size), [tr, tc] = toBoard(+seg[3], +seg[4], size);
      const x1 = fc + 0.5, y1 = fr + 0.5, x2 = tc + 0.5, y2 = tr + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      parts.push(`<line x1="${x1 + ux * 0.28}" y1="${y1 + uy * 0.28}" x2="${x2 - ux * 0.34}" y2="${y2 - uy * 0.34}" stroke="${ANNO_COLORS[seg[5]]}" stroke-width="0.17" stroke-linecap="round" opacity="0.8" marker-end="url(#ah-${seg[5]})"/>`);
    }
  }
  svg.innerHTML = parts.join('');
}
boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
boardEl.addEventListener('pointerdown', (e) => {
  if (e.button === 0) { if (annos.size) { annos.clear(); drawAnnos(); } return; }
  if (e.button !== 2) return;
  const sq = e.target.closest('.sq'); if (!sq) return;
  const [r, c] = toBoard(+sq.dataset.dr, +sq.dataset.dc, curSize);
  annoStart = { r, c, color: annoColor(e) };
});
boardEl.addEventListener('pointerup', (e) => {
  if (e.button !== 2 || !annoStart) return;
  const start = annoStart; annoStart = null;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sq = el && el.closest ? el.closest('.sq') : null;
  if (!sq || !boardEl.contains(sq)) return;
  const [r, c] = toBoard(+sq.dataset.dr, +sq.dataset.dc, curSize);
  const key = start.r === r && start.c === c
    ? `d:${r}:${c}:${start.color}`
    : `a:${start.r}:${start.c}:${r}:${c}:${start.color}`;
  if (annos.has(key)) annos.delete(key); else annos.add(key);
  drawAnnos();
});

// ── board resize grip ────────────────────────────────────────────────────────
const wrapEl = $('board-wrap');
function applyBoardSize(px) {
  px = Math.max(260, Math.min(px, 900));
  wrapEl.style.flexBasis = px + 'px';
  wrapEl.style.maxWidth = `min(${px}px, 100%, 88vh)`;
  return px;
}
{
  const savedPx = Number(store.get('janken-boardpx'));
  if (savedPx) applyBoardSize(savedPx);
}
$('board-grip').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startX = e.clientX, startW = boardEl.getBoundingClientRect().width;
  const onMove = (ev) => applyBoardSize(startW + (ev.clientX - startX));
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    store.set('janken-boardpx', String(Math.round(boardEl.getBoundingClientRect().width)));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
});
$('board-grip').addEventListener('dblclick', () => {
  wrapEl.style.flexBasis = ''; wrapEl.style.maxWidth = '';
  store.set('janken-boardpx', '');
});

// ── game lifecycle ──────────────────────────────────────────────────────────
function freshLocal(board) {
  const gm = E.newGame(cfg, board);
  gm.startedAt = Date.now();
  Object.assign(state, {
    board: gm.board,
    startPos: gm.startPos,
    startOwners: gm.startOwners,
    startedAt: gm.startedAt,
    turn: gm.turn,
    acts: gm.acts,
    moves: gm.moves,
    passStreak: gm.passStreak,
    gameOver: gm.gameOver,
    lastMove: gm.lastMove,
    dry: gm.dry,
    selected: null,
    targets: [],
    justMovedTo: null,
    thinking: false,
    rated: false,
    pos: board ? gm.startPos : null,
    own: board ? gm.startOwners : null,
    winner: null,
    endReason: gm.endReason,
    deltas: null,
  });
}
function newGame() {
  gen++;
  if (net) {
    sendNet({
      type: 'new',
      cfg,
      ...(state.pos ? { pos: state.pos } : {}),
      ...(state.own ? { own: state.own } : {}),
    });
    return;
  }
  if (curSize !== cfg.size) build(cfg.size);
  freshLocal();
  positions = [snap()]; viewPly = 0;
  renderLegend(); render(); maybeBot();
}
function startLocal(m) { leaveOnline(); gen++; mode = m; $('online').hidden = true; $('players').hidden = true; showGame(); newGame(); }

// ── online ───────────────────────────────────────────────────────────────────
const genRoom = () => { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };
function startOnline(room, opts = {}) {
  leaveOnline(); gen++; mode = 'online'; lastServerMoves = -1; resetChat();
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
    pos: opts.pos || null,
    own: opts.own || null,
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
  else if (session.hostConfig) params.set('cfg', btoa(JSON.stringify({
    ...E.sanitizeCfg(cfg),
    ...(session.pos ? { pos: session.pos } : {}),
    ...(session.own ? { own: session.own } : {}),
  })));
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
    if (account && (session.role === 'B' || session.role === 'R')) {
      sendNet({ type: 'auth', id: account.id, secret: account.secret });
    }
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
  } else if (message.type === 'chat') {
    addChat(message);
  }
}

// ── in-game chat (ephemeral — kept only in memory, cleared with the room) ─────
let chatLog = [];
function resetChat() { chatLog = []; renderChat(); }
function renderChat() {
  const box = $('chat-log'); if (!box) return;
  box.innerHTML = '';
  if (!chatLog.length) {
    const empty = document.createElement('div'); empty.className = 'chat-empty';
    empty.textContent = 'Say hello — messages stay in this tab for this game only.';
    box.appendChild(empty);
    return;
  }
  for (const m of chatLog.slice(-120)) {
    const line = document.createElement('div');
    line.className = 'chat-line ' + (m.role === BLUE ? 'b' : m.role === RED ? 'r' : 's');
    const who = document.createElement('span'); who.className = 'who'; who.textContent = m.name || (m.role === BLUE ? 'Blue' : m.role === RED ? 'Red' : 'Spectator');
    const msg = document.createElement('span'); msg.className = 'msg'; msg.textContent = m.text;
    line.append(who, msg);
    box.appendChild(line);
  }
  box.scrollTop = box.scrollHeight;
}
function addChat(m) {
  if (!m || typeof m.text !== 'string') return;
  chatLog.push({ role: m.role, name: m.name, text: m.text });
  if (chatLog.length > 200) chatLog = chatLog.slice(-200);
  renderChat();
  if (document.activeElement !== $('chat-input')) blip(320, 0.05, 0.03);   // soft ping, honours the sound pref
}
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = (input.value || '').trim();
  if (!text) return;
  if (sendNet({ type: 'chat', text })) input.value = '';
});
$('resign-btn').onclick = () => {
  if (!net || state.gameOver) return;
  if (!window.confirm('Resign this game? Your opponent wins.')) return;
  sendNet({ type: 'resign' });
};
let lastServerMoves = -1;
function applyServerState(s) {
  if (!s || !s.cfg || !Array.isArray(s.board)) return;
  const rematch = (state.startedAt && s.startedAt && state.startedAt !== s.startedAt)
    || (state.gameOver && !s.gameOver && (!s.moves || s.moves.length === 0));
  if (rematch) resetChat();
  Object.assign(cfg, E.sanitizeCfg(s.cfg));
  if (curSize !== cfg.size) build(cfg.size);
  const moves = Array.isArray(s.moves) ? s.moves : [];
  if (lastServerMoves >= 0 && moves.length > lastServerMoves) {
    if (s.gameOver) soundEnd();
    else if ((moves[moves.length - 1].capture || '') || (moves[moves.length - 1].t || '').includes('×')) soundCap();
    else soundMove();
  }
  lastServerMoves = moves.length;
  Object.assign(state, {
    board: s.board,
    startPos: s.startPos || s.pos || null,
    startOwners: s.startOwners || s.own || null,
    startedAt: s.startedAt || state.startedAt || Date.now(),
    turn: s.turn,
    acts: s.acts || 0,
    moves,
    gameOver: !!s.gameOver,
    lastMove: s.lastMove || null,
    passStreak: 0,
    dry: 0,
    thinking: false,
    selected: null,
    targets: [],
    rated: !!s.rated,
    pos: s.pos || null,
    own: s.own || null,
    winner: s.winner || null,
    endReason: s.endReason || null,
    deltas: s.deltas || null,
    ratingError: !!s.ratingError,
  });
  net.names = s.names || {}; net.seats = s.seats || {}; net.online = s.online || {};
  net.ratings = s.ratings || {}; net.accounts = s.accounts || {};
  net.error = '';
  if (account && (net.role === 'B' || net.role === 'R') && net.accounts[net.role] === account.id) setMyRating(net.ratings[net.role]);
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
  $('rtag').hidden = !state.rated;
  $('oshare').value = location.origin + '/#r=' + net.room;
  const seated = net.role === 'B' || net.role === 'R';
  $('chat').hidden = false;                              // spectators can read along
  $('chat-form').hidden = !seated;                      // but only players type
  $('resign-btn').hidden = !(seated && net.seats.B && net.seats.R && !state.gameOver);
  const blue = $('pl-b').parentElement, red = $('pl-r').parentElement;
  blue.classList.toggle('offline', !!net.seats.B && net.online.B === false);
  red.classList.toggle('offline', !!net.seats.R && net.online.R === false);
  const ratings = net.ratings || {}, accounts = net.accounts || {};
  const tag = (role, fallback) => {
    const base = net.names[role] || (net.seats[role] ? fallback : '— open');
    const you = net.role === role ? ' (you)' : '';
    const rating = typeof ratings[role] === 'number' ? ` · ${Math.round(ratings[role])}` : '';
    return base + you + rating;
  };
  const linkify = (el, id) => { el.classList.toggle('linkable', !!id); el.onclick = id ? () => showProfile(id) : null; };
  $('pl-b').textContent = tag(BLUE, 'Blue'); linkify($('pl-b'), accounts.B);
  $('pl-r').textContent = tag(RED, 'Red'); linkify($('pl-r'), accounts.R);
}
function leaveOnline() {
  gen++;
  const session = net;
  net = null;
  resetChat();
  if (!session) return;
  session.stopped = true;
  if (session.timer) clearTimeout(session.timer);
  if (session.ws) try { session.ws.close(1000, 'left room'); } catch { /* already closed */ }
}

// ── analysis board ────────────────────────────────────────────────────────────
function buildPalette() {
  const pal = $('palette'); pal.innerHTML = '';
  const mv = document.createElement('button'); mv.type = 'button'; mv.className = 'pal move'; mv.textContent = '✥'; mv.title = 'Move pieces'; mv.dataset.move = '1';
  mv.onclick = () => { tool = 'move'; markTool(); render(); }; pal.appendChild(mv);
  for (const color of [BLUE, RED]) for (const type of ['rock', 'paper', 'scissors']) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pal'; b.dataset.type = type; b.dataset.color = color; b.innerHTML = glyph(type, color);
    b.onclick = () => { tool = { type, color }; edSel = null; edTargets = []; markTool(); render(); }; pal.appendChild(b);
  }
  const er = document.createElement('button'); er.type = 'button'; er.className = 'pal erase'; er.textContent = 'erase'; er.dataset.erase = '1';
  er.onclick = () => { tool = 'erase'; edSel = null; edTargets = []; markTool(); render(); }; pal.appendChild(er); markTool();
  paletteBuilt = true;
}
function markTool() {
  for (const b of $('palette').children) {
    b.classList.toggle('on', tool === 'move' ? b.dataset.move === '1'
      : tool === 'erase' ? b.dataset.erase === '1'
        : (b.dataset.type === tool.type && b.dataset.color === tool.color));
  }
}
function enterEdit(startBoard) {
  gen++; leaveOnline(); mode = 'human'; showGame();
  if (curSize !== cfg.size) build(cfg.size);
  if (!paletteBuilt) buildPalette();
  editing = true; tool = 'move'; edSel = null; edTargets = []; markTool();
  editBoard = startBoard || E.blocksBoard(cfg.size, cfg.perType, cfg.layout);
  $('ed-first').value = cfg.first;
  $('panel').hidden = true; $('editpanel').hidden = false; $('online').hidden = true; $('players').hidden = true;
  render();
}
function cancelEdit() { editing = false; edSel = null; edTargets = []; $('editpanel').hidden = true; $('panel').hidden = false; showHome(); }
// Sandbox move: legality follows the current rules, but either side may move at any time.
function analysisMove(fr, fc, tr, tc) {
  const safe = E.sanitizeCfg(cfg), b = editBoard, p = b[fr][fc].piece;
  const cap = !!b[tr][tc].piece;
  b[fr][fc].piece = null;
  if (safe.territory && safe.trail) {
    const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
    for (let r = fr + dr, c = fc + dc; r !== tr || c !== tc; r += dr, c += dc) {
      if (b[r][c].owner === null) b[r][c].owner = p.color;
    }
  }
  b[tr][tc] = { owner: safe.territory ? p.color : b[tr][tc].owner, piece: p };
  if (cap) soundCap(); else soundMove();
}
function editClick(r, c) {
  if (tool === 'move') {
    if (edSel && edTargets.some((t) => t[0] === r && t[1] === c)) {
      analysisMove(edSel.r, edSel.c, r, c);
      edSel = null; edTargets = [];
    } else if (editBoard[r][c].piece) {
      edSel = { r, c }; edTargets = E.legalDest(editBoard, r, c, E.sanitizeCfg(cfg));
    } else { edSel = null; edTargets = []; }
    return render();
  }
  editBoard[r][c] = tool === 'erase' ? { owner: null, piece: null } : { owner: tool.color, piece: { type: tool.type, color: tool.color } };
  render();
}
function bothSidesPresent() {
  const counts = E.pieceCounts(editBoard);
  if (counts.B && counts.R) return true;
  const hint = document.querySelector('#editpanel .hint');
  const original = hint.textContent;
  hint.textContent = 'Both sides need at least one piece.';
  setTimeout(() => { hint.textContent = original; }, 1800);
  return false;
}
function playFromEdit(nextMode) {
  if (!bothSidesPresent()) return;
  cfg.first = $('ed-first').value; adoptRules();
  editing = false; edSel = null; edTargets = [];
  $('editpanel').hidden = true; $('panel').hidden = false;
  mode = nextMode;
  freshLocal(E.cloneBoard(editBoard));
  positions = [snap()]; viewPly = 0;
  renderLegend(); render(); maybeBot();
}
$('ed-cancel').onclick = cancelEdit;
$('ed-start').onclick = () => playFromEdit('human');
$('ed-bot').onclick = () => playFromEdit('bot');
$('ed-chal').onclick = () => {
  if (!bothSidesPresent()) return;
  cfg.first = $('ed-first').value; adoptRules();
  const pos = E.encodePos(editBoard);
  const own = E.encodeOwners(editBoard);
  editing = false; edSel = null; edTargets = [];
  $('editpanel').hidden = true; $('panel').hidden = false;
  startOnline(genRoom(), { host: true, pos, own });
};
$('ed-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(`${cfg.size}:${E.encodePos(editBoard)}`);
    const b = $('ed-copy'); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy position', 1200);
  } catch { }
};
$('ed-clear').onclick = () => { editBoard = E.emptyBoard(cfg.size); edSel = null; edTargets = []; render(); };
$('ed-blocks').onclick = () => { editBoard = E.blocksBoard(cfg.size, cfg.perType, cfg.layout); edSel = null; edTargets = []; render(); };
$('ed-mirror').onclick = () => {
  edSel = null; edTargets = [];
  const S = editBoard.length;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (editBoard[r][c].piece && editBoard[r][c].piece.color === RED) editBoard[r][c] = { owner: null, piece: null };
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) { const p = editBoard[r][c].piece; if (p && p.color === BLUE) { const rr = S - 1 - r, cc = S - 1 - c; if (!(editBoard[rr][cc].piece && editBoard[rr][cc].piece.color === BLUE)) editBoard[rr][cc] = { owner: RED, piece: { type: p.type, color: RED } }; } }
  render();
};

// ── screens / homepage ────────────────────────────────────────────────────────
let previewPiece = 'rock';
function previewGlyph(type, color, x, y, size) {
  return glyph(type, color).replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
}
function previewStart(rules) {
  let seed = rules.size * 1009 + rules.perType * 97;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  return E.blocksBoard(rules.size, rules.perType, rules.layout, random);
}
// ── rules, rendered from the live config ────────────────────────────────────
// One renderer feeds both the board-side flap and the how-to-play dialog, so the rules a
// player reads are always derived from the variant in front of them.
function renderRulesInto(bodyEl, lineEl, titleEl, rules) {
  const safe = E.sanitizeCfg(rules);
  const preset = E.presetOf(safe);
  if (titleEl) titleEl.textContent = E.presetLabel(preset);
  if (lineEl) lineEl.textContent = E.variantLabel(safe);
  bodyEl.innerHTML = '';
  for (const { h, p } of E.rulesSummary(safe)) {
    const heading = document.createElement('h3'); heading.textContent = h;
    const text = document.createElement('p'); text.textContent = p;
    bodyEl.append(heading, text);
  }
}
function openRulesDialog() {
  store.set('janken-seen', '1');
  $('rules-link').classList.remove('attention');
  renderRulesInto($('rules-body'), $('rules-line'), $('rules-variant'), cfg);
  $('rules').showModal();
}
function renderRulesFlap() {
  if ($('rules-flap').hidden) return;
  renderRulesInto($('rf-body'), $('rf-line'), $('rf-title'), cfg);
}
function toggleRulesFlap(force) {
  const flap = $('rules-flap');
  const open = force === undefined ? flap.hidden : force;
  flap.hidden = !open;
  $('rules-tab').setAttribute('aria-expanded', String(open));
  if (open) { store.set('janken-seen', '1'); $('rules-tab').classList.remove('attention'); renderRulesFlap(); }
}
$('rules-tab').onclick = () => toggleRulesFlap();
$('rf-close').onclick = () => toggleRulesFlap(false);
$('rules-link').onclick = openRulesDialog;

// `rules` defaults to the live config; hovering a preset chip passes that preset instead,
// so the whole stage previews a variant before you commit to it.
function renderVariantPreview(rules = cfg, presetKey = null) {
  const safe = E.sanitizeCfg(rules);
  const shown = presetKey || (customising ? 'custom' : E.presetOf(safe));
  $('preset-name').textContent = E.presetLabel(shown);
  $('preset-tagline').textContent = E.PRESET_INFO[shown]?.tagline || '';
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
  const movement = E.movementFor(safe, previewPiece);
  const movementPattern = E.pattern(previewPiece, safe);
  const farthest = new Map();
  for (const [row, col] of targets) {
    const dr = Math.sign(row - origin), dc = Math.sign(col - origin);
    const distance = Math.max(Math.abs(row - origin), Math.abs(col - origin));
    const key = movementPattern.slide || movement === 'longking'
      ? `${dr}:${dc}`
      : `${row}:${col}`;
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
  const formationOwners = [];
  const formationPieces = [];
  const start = previewStart(safe);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const cellState = start[row][col];
    if (cellState.owner) {
      formationOwners.push(`<rect class="pv-own-${cellState.owner}" x="${pad + col * cell}" y="${pad + row * cell}" width="${cell}" height="${cell}"/>`);
    }
    if (cellState.piece && (row !== origin || col !== origin)) {
      const small = Math.max(8, cell * 0.56);
      formationPieces.push(previewGlyph(
        cellState.piece.type,
        cellState.piece.color,
        center(col) - small / 2,
        center(row) - small / 2,
        small,
      ));
    }
  }
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
    <g class="pv-ownership">${formationOwners.join('')}</g>
    <path class="pv-grid" d="${gridLines.join(' ')}"/>
    <g class="pv-formation">${formationPieces.join('')}</g>
    ${arrows.join('')}${dots.join('')}
    <circle class="pv-origin" cx="${ox}" cy="${oy}" r="${Math.max(7, cell * 0.42)}"/>
    ${previewGlyph(previewPiece, BLUE, ox - iconSize / 2, oy - iconSize / 2, iconSize)}
  `;
  for (const tab of $('preview-tabs').children) {
    tab.setAttribute('aria-pressed', String(tab.dataset.previewPiece === previewPiece));
  }
  $('preview-description').textContent = `${PIECE_NAMES[previewPiece]} moves as a ${E.MOVEMENT_LABELS[movement].toLowerCase()}: ${moveDescription(previewPiece, safe)}. ${targets.length} legal destination${targets.length === 1 ? '' : 's'} from the centre.`;
  $('preview-map').innerHTML = ['rock', 'paper', 'scissors'].map((type) => {
    const move = E.movementFor(safe, type);
    const title = `${PIECE_NAMES[type]} ${E.MOVEMENT_SENTENCES[move]}`;
    return `<button type="button" data-preview-piece="${type}" class="${type === previewPiece ? 'on' : ''}" title="${title}">`
      + `<span class="pm-glyph">${legendGlyph(type)}</span><span class="pm-move">${E.MOVEMENT_LABELS[move]}</span>`
      + `<span class="pm-desc">${E.MOVEMENT_DESCRIPTIONS[move]}</span></button>`;
  }).join('');
  for (const button of $('preview-map').children) {
    button.onclick = () => { previewPiece = button.dataset.previewPiece; renderVariantPreview(); };
  }
  const capture = safe.capture === 'rps' ? 'RPS captures' : 'capture any piece';
  const goal = safe.territory ? (safe.retread ? 'territory + re-tread' : 'new territory only') : 'elimination';
  const facts = [
    `${safe.size}×${safe.size}`,
    `${safe.perType} / type`,
    `${'●'.repeat(safe.actionsPerTurn)} ${safe.actionsPerTurn} action${safe.actionsPerTurn === 1 ? '' : 's'}`,
    `${safe.first === BLUE ? 'Blue' : 'Red'} first`,
    capture,
    goal,
    `${safe.layout} start`,
  ];
  if (safe.trail) facts.push('ink trail');
  $('preview-facts').innerHTML = facts.map((fact) => `<span>${fact}</span>`).join('');
}
for (const tab of $('preview-tabs').children) {
  tab.onclick = () => { previewPiece = tab.dataset.previewPiece; renderVariantPreview(); };
}

let lobbyTimer = null, lobbyRequest = null, lobbyFailures = 0;
let showcaseStarted = false;
function ensureShowcase() {
  if (showcaseStarted) return;
  showcaseStarted = true;
  const load = () => import('/showcase.js')
    .then(({ initShowcase }) => initShowcase())
    .catch(() => { showcaseStarted = false; });
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 1200 });
  else setTimeout(load, 80);
}
function showGame() { document.body.dataset.screen = 'game'; currentProfile = null; $('home').hidden = true; $('game').hidden = false; $('profilepage').hidden = true; stopLobbyPoll(); }
function showHome() { gen++; leaveOnline(); toggleRulesFlap(false); Object.assign(cfg, ownRules); editing = false; currentProfile = null; $('editpanel').hidden = true; $('panel').hidden = false; document.body.dataset.screen = 'home'; $('home').hidden = false; $('game').hidden = true; $('profilepage').hidden = true; if (location.hash) location.hash = ''; fillHome(); renderAccountUI(); startLobbyPoll(); ensureShowcase(); }

// ── profile screen ───────────────────────────────────────────────────────────
function statEl(value, label) {
  const wrap = document.createElement('span'); wrap.className = 'pf-stat';
  const b = document.createElement('b'); b.textContent = value;
  const s = document.createElement('span'); s.textContent = label;
  wrap.append(b, s); return wrap;
}
let currentProfile = null;
async function showProfile(id) {
  if (!/^[a-z0-9]{1,32}$/i.test(id || '')) return;
  if (currentProfile === id && document.body.dataset.screen === 'profile') return;
  currentProfile = id;
  gen++; leaveOnline(); editing = false; stopLobbyPoll();
  document.body.dataset.screen = 'profile';
  $('home').hidden = true; $('game').hidden = true; $('profilepage').hidden = false;
  if (location.hash !== '#u=' + id) location.hash = 'u=' + id;
  $('pf-name').textContent = '…'; $('pf-rating').textContent = '—';
  $('pf-stats').textContent = ''; $('pf-matches').innerHTML = ''; $('pf-empty').hidden = true;
  let data;
  try { data = await api('/api/profile?id=' + encodeURIComponent(id)); }
  catch { $('pf-name').textContent = 'Profile unavailable'; return; }
  const a = data.account;
  $('pf-name').textContent = a.name + (account && account.id === a.id ? ' (you)' : '');
  $('pf-rating').textContent = Math.round(a.rating);
  const stats = $('pf-stats');
  stats.append(
    statEl(a.games, 'games'),
    statEl(`${a.wins}–${a.draws}–${a.losses}`, 'w · d · l'),
    statEl(a.games ? Math.round(a.wins / a.games * 100) + '%' : '—', 'win rate'),
    statEl(Math.round(a.peak), 'peak'),
    statEl(new Date(a.created_at).toISOString().slice(0, 10), 'since'),
  );
  const rows = Array.isArray(data.matches) ? data.matches : [];
  $('pf-empty').hidden = rows.length > 0;
  for (const m of rows) {
    const mine = m.blue === a.id ? 'B' : 'R';
    const oppId = mine === 'B' ? m.red : m.blue;
    const oppName = mine === 'B' ? m.red_name : m.blue_name;
    const delta = mine === 'B' ? m.delta_b : m.delta_r;
    const res = m.winner === null ? 'd' : m.winner === mine ? 'w' : 'l';
    const li = document.createElement('li'); li.className = 'pf-row';
    const resEl = document.createElement('span'); resEl.className = 'res ' + res; resEl.textContent = res.toUpperCase();
    const opp = document.createElement('button'); opp.type = 'button'; opp.className = 'opp linklike';
    opp.textContent = oppName || 'unknown'; opp.onclick = () => showProfile(oppId);
    const variant = document.createElement('span'); variant.className = 'var';
    variant.textContent = m.variant + (m.reason === 'abandon' ? ' · abandoned' : '');
    const dlt = document.createElement('span'); dlt.className = 'dlt'; dlt.textContent = fmtDelta(delta);
    const when = document.createElement('span'); when.className = 'when';
    when.textContent = new Date(m.played_at).toISOString().slice(5, 10).replace('-', '/');
    li.append(resEl, opp, variant, dlt, when);
    $('pf-matches').appendChild(li);
  }
  if (account && account.id === a.id) setMyRating(a.rating);
}
$('pf-back').onclick = () => showHome();

// ── account UI ───────────────────────────────────────────────────────────────
function renderAccountUI() {
  $('acct-btn').hidden = !!account;
  $('acct-chip').hidden = !account;
  if (account) $('acct-chip').textContent = `★ ${Math.round(myRating || 1200)}`;
}
async function createAccount() {
  try {
    const created = await api('/api/account', { name });
    account = { id: created.id, secret: created.secret };
    store.set('janken-acct', JSON.stringify(account));
    setMyRating(created.rating);
    renderAccountUI();
    if (net && net.connected) sendNet({ type: 'auth', id: account.id, secret: account.secret });
  } catch { /* the button stays; user can retry */ }
}
$('acct-btn').onclick = createAccount;
$('acct-chip').onclick = () => account && showProfile(account.id);

function buildAcctBox() {
  const box = $('acct-box'); box.innerHTML = '';
  const hint = document.createElement('p'); hint.className = 'hint';
  if (account) {
    const code = document.createElement('input');
    code.readOnly = true; code.className = 'acct-code'; code.value = `${account.id}.${account.secret}`;
    code.setAttribute('aria-label', 'Transfer code');
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn sm'; copy.textContent = 'Copy';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(code.value); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1200); } catch { } };
    const row = document.createElement('div'); row.className = 'acct-row'; row.append(code, copy);
    hint.textContent = 'Change your username anytime in the “you are” field on Home; rated profiles update automatically. The transfer code moves your rating to another device — keep it private.';
    box.append(row, hint);
  } else {
    const paste = document.createElement('input');
    paste.className = 'acct-code'; paste.placeholder = 'paste a transfer code…';
    paste.setAttribute('aria-label', 'Restore account');
    const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'btn sm'; restore.textContent = 'Restore';
    restore.onclick = async () => {
      const [id, secret] = (paste.value || '').trim().split('.');
      if (!id || !secret) return;
      try {
        const { account: verified } = await api('/api/account/verify', { id, secret });
        account = { id: verified.id, secret };
        store.set('janken-acct', JSON.stringify(account));
        name = verified.name; store.set('janken-name', name); $('name-input').value = name;
        setMyRating(verified.rating);
        renderAccountUI(); buildAcctBox();
      } catch { restore.textContent = 'Invalid'; setTimeout(() => restore.textContent = 'Restore', 1400); }
    };
    const row = document.createElement('div'); row.className = 'acct-row'; row.append(paste, restore);
    hint.textContent = 'Your “you are” name is editable anytime. “Get rated” creates a persistent profile, or restore one with its transfer code.';
    box.append(row, hint);
  }
}

function buildMovementSelectors() {
  const descriptions = {
    king: '1 square, any way',
    rook: 'slide straight',
    bishop: 'slide diagonal',
    knight: 'L-shaped jump',
    queen: 'slide any way',
    cross: '1 square straight',
    longking: 'king + 2-square jump',
  };
  for (const type of ['rock', 'paper', 'scissors']) {
    const select = $(`s-move-${type}`);
    select.innerHTML = E.MOVEMENT_TYPES
      .map((move) => `<option value="${move}">${E.MOVEMENT_LABELS[move]} — ${descriptions[move]}</option>`)
      .join('');
  }
}
buildMovementSelectors();

function fillHome() {
  $('s-size').value = cfg.size; $('s-size-v').textContent = `${cfg.size}×${cfg.size}`;
  $('s-per').value = cfg.perType; $('s-per-v').textContent = cfg.perType;
  $('s-acts').value = cfg.actionsPerTurn; $('s-acts-v').textContent = cfg.actionsPerTurn;
  $('s-move-rock').value = E.movementFor(cfg, 'rock');
  $('s-move-paper').value = E.movementFor(cfg, 'paper');
  $('s-move-scissors').value = E.movementFor(cfg, 'scissors');
  $('s-cap').value = cfg.capture;
  $('s-terr').value = cfg.territory ? 'territory' : 'elimination';
  $('s-retread').checked = cfg.retread; $('s-trail').checked = cfg.trail;
  $('s-layout').value = cfg.layout; $('s-first').value = cfg.first;
  $('s-coords').checked = cfg.coords; $('s-hints').checked = cfg.hints; $('s-sound').checked = cfg.sound;
  $('name-input').value = name;
  $('retread-row').hidden = !cfg.territory;
  $('trail-row').hidden = !cfg.territory;
  updateVariantLine(); markPreset(); renderVariantPreview();
  if (customising || E.presetOf(E.sanitizeCfg(cfg)) === 'custom') $('config-details').open = true;
}
function readHome() {
  cfg.size = +$('s-size').value; cfg.perType = +$('s-per').value; cfg.actionsPerTurn = +$('s-acts').value;
  cfg.rockMove = $('s-move-rock').value;
  cfg.paperMove = $('s-move-paper').value;
  cfg.scissorsMove = $('s-move-scissors').value;
  cfg.capture = $('s-cap').value; cfg.layout = $('s-layout').value;
  cfg.territory = $('s-terr').value === 'territory'; cfg.retread = $('s-retread').checked && cfg.territory;
  cfg.trail = $('s-trail').checked && cfg.territory;
  cfg.first = $('s-first').value; cfg.coords = $('s-coords').checked; cfg.hints = $('s-hints').checked;
  Object.assign(cfg, E.sanitizeCfg(cfg));
  adoptRules(); updateVariantLine(); markPreset(); renderVariantPreview();
}
function updateVariantLine() { $('variant-line').textContent = E.variantLabel(E.sanitizeCfg(cfg)); }
// Explicitly chosen via the Custom tab; keeps Custom active even while the config
// still matches a named preset. Cleared by picking a preset tab.
let customising = false;
function markPreset() {
  const cur = customising ? 'custom' : E.presetOf(E.sanitizeCfg(cfg));
  for (const ch of document.querySelectorAll('#presets .chip')) ch.classList.toggle('on', ch.dataset.preset === cur);
}

$('s-size').oninput = () => { $('s-size-v').textContent = `${$('s-size').value}×${$('s-size').value}`; readHome(); };
$('s-per').oninput = () => { $('s-per-v').textContent = $('s-per').value; readHome(); };
$('s-acts').oninput = () => { $('s-acts-v').textContent = $('s-acts').value; readHome(); };
for (const id of ['s-move-rock', 's-move-paper', 's-move-scissors', 's-cap', 's-first', 's-retread', 's-trail', 's-layout']) $(id).onchange = readHome;
$('s-move-rotate').onclick = () => {
  const rock = $('s-move-rock').value;
  $('s-move-rock').value = $('s-move-scissors').value;
  $('s-move-scissors').value = $('s-move-paper').value;
  $('s-move-paper').value = rock;
  readHome();
};
// View preferences live in the Preferences dialog so they can change mid-game too.
for (const id of ['s-coords', 's-hints', 's-sound']) $(id).onchange = () => {
  cfg.coords = $('s-coords').checked; cfg.hints = $('s-hints').checked; cfg.sound = $('s-sound').checked; saveCfg();
  if (document.body.dataset.screen === 'game') render();
};
$('s-terr').onchange = () => { const elim = $('s-terr').value !== 'territory'; $('retread-row').hidden = elim; $('trail-row').hidden = elim; readHome(); };
let renameTimer = null;
$('name-input').oninput = () => {
  name = ($('name-input').value || '').replace(/[^\w \-]/g, '').slice(0, 20) || randomGuest();
  store.set('janken-name', name);
  if (account) {
    clearTimeout(renameTimer);
    renameTimer = setTimeout(() => api('/api/account/name', { ...account, name }).catch(() => { }), 800);
  }
};
function choosePreset(key) {
  if (key !== 'custom' && E.PRESETS[key]) {
    customising = false;
    Object.assign(cfg, E.sanitizeCfg(E.PRESETS[key])); adoptRules(); fillHome();
    $('config-details').open = false;
  } else {
    customising = true;
    markPreset(); renderVariantPreview();
    $('config-details').open = true;
  }
}
// The variant list is generated from the engine's preset library, so adding a variant is a
// one-file change. Hover or focus previews a variant on the whole stage without selecting it.
function buildPresets() {
  const box = $('presets'); box.innerHTML = '';
  for (const key of E.PRESET_KEYS) {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'chip'; chip.dataset.preset = key;
    chip.textContent = E.PRESET_INFO[key].label;
    chip.title = E.PRESET_INFO[key].tagline;
    chip.onclick = () => choosePreset(key);
    if (key !== 'custom') {
      const peek = () => renderVariantPreview(E.PRESETS[key], key);
      const back = () => renderVariantPreview();
      chip.onpointerenter = peek; chip.onfocus = peek;
      chip.onpointerleave = back; chip.onblur = back;
    }
    box.appendChild(chip);
  }
}
buildPresets();

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
      li.innerHTML = `<span class="gr-host"></span><span class="gr-var"></span><span class="gr-rating"></span><button class="btn sm">Join</button>`;
      const host = li.querySelector('.gr-host');
      host.textContent = g.host || 'guest';
      if (g.hostId) { host.classList.add('linkable'); host.onclick = () => showProfile(g.hostId); }
      li.querySelector('.gr-var').textContent = g.variant || '';
      li.querySelector('.gr-rating').textContent = typeof g.rating === 'number' ? '★ ' + Math.round(g.rating) : '';
      li.querySelector('button.btn').onclick = () => startOnline(g.room);
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
// Matchmaking-lite: join the open game whose host rating sits closest to yours.
$('quick-btn').onclick = async () => {
  readHome();
  const base = myRating || 1200;
  try {
    const { games } = await api('/api/lobby');
    const open = (Array.isArray(games) ? games : []).filter((g) => g && /^[a-z0-9_-]{1,40}$/i.test(g.room || ''));
    const rated = open.filter((g) => typeof g.rating === 'number');
    const pool = rated.length ? rated : open;
    pool.sort((a, b) => Math.abs((a.rating ?? 1200) - base) - Math.abs((b.rating ?? 1200) - base));
    if (pool.length) startOnline(pool[0].room);
    else startOnline(genRoom(), { host: true });
  } catch { startOnline(genRoom(), { host: true }); }
};
$('custom-btn').onclick = () => { readHome(); enterEdit(); };

// ── appearance ────────────────────────────────────────────────────────────────
const PSTYLES = [['line', 'Line'], ['solid', 'Solid'], ['pixel', 'Pixel'], ['kanji', 'Kanji']];
function buildPStyle() {
  const el = $('pstyle'); el.innerHTML = '';
  for (const [val, label] of PSTYLES) {
    const o = document.createElement('button'); o.type = 'button'; o.className = 'opt'; o.dataset.style = val;
    o.innerHTML = `<div class="row">${glyph('rock', 'R', val)}${glyph('paper', 'B', val)}${glyph('scissors', 'R', val)}</div><div class="nm">${label}</div>`;
    o.onclick = () => {
      cfg.pieceStyle = val; saveCfg(); markPStyle(); renderVariantPreview(); renderHero();
      if (curSize) renderLegend();
      if (paletteBuilt) buildPalette();
      if (document.body.dataset.screen === 'game') render();
    };
    el.appendChild(o);
  }
  markPStyle();
}
function markPStyle() { for (const o of $('pstyle').children) o.classList.toggle('on', o.dataset.style === cfg.pieceStyle); }
$('pieces-btn').onclick = () => { buildPStyle(); buildAcctBox(); $('pieces').showModal(); };

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
$('flip-btn').onclick = () => { flipped = !flipped; store.set('janken-flip', flipped ? '1' : '0'); render(); drawAnnos(); };
$('copy-btn').onclick = async () => {
  const text = exportJpgn(state, {
    event: net ? (state.rated ? 'JANKEN Rated Game' : 'JANKEN Online Game') : 'JANKEN Local Game',
    site: location.origin + '/',
    room: net?.room,
    names: net?.names,
    ratings: net?.ratings,
  });
  try {
    await navigator.clipboard.writeText(text);
    const b = $('copy-btn'); b.textContent = 'JPGN copied';
    setTimeout(() => { b.textContent = 'Copy JPGN'; $('export-menu').open = false; }, 900);
  } catch { }
};
$('gif-btn').onclick = async () => {
  const button = $('gif-btn');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Rendering…';
  try {
    // GIF code is loaded only on demand; it adds no parsing cost to the homepage.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { exportGameGif } = await import('/gif.js');
    const blob = exportGameGif(state);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `janken-${stamp}.gif`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    button.textContent = 'GIF downloaded';
    setTimeout(() => {
      button.textContent = 'Download GIF';
      button.disabled = false;
      $('export-menu').open = false;
    }, 1000);
  } catch {
    button.textContent = 'Could not export';
    setTimeout(() => { button.textContent = 'Download GIF'; button.disabled = false; }, 1400);
  }
};
$('ocopy').onclick = async () => { try { await navigator.clipboard.writeText($('oshare').value); const b = $('ocopy'); b.textContent = 'copied'; setTimeout(() => b.textContent = 'copy link', 1200); } catch { } };

function applyTheme(t) { document.documentElement.dataset.theme = t; document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#000000' : '#ffffff'); store.set('janken-theme', t); }
$('theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// footer commit
fetch('/version.json').then(r => r.json()).then(v => { if (v && v.short) { const a = $('commit-link'); a.href = v.url; a.textContent = v.short; } }).catch(() => { });

// The hero shows the beats-cycle in the player's chosen piece style.
function renderHero() {
  $('hero-glyphs').innerHTML = ['rock', 'scissors', 'paper']
    .map((t) => glyph(t, 'N')).join('<span class="hg-sep">▸</span>');
}

// ── boot ────────────────────────────────────────────────────────────────────
applyTheme(store.get('janken-theme') || 'dark');
renderHero();
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
  const profileId = (location.hash.match(/u=([a-z0-9]+)/i) || [])[1];
  if (room) { if (!net || net.room !== room) startOnline(room); }
  else if (profileId) showProfile(profileId);
  else if (net || document.body.dataset.screen === 'profile') showHome();
});
const hashRoom = (location.hash.match(/r=([a-z0-9_-]+)/i) || [])[1];
const hashProfile = (location.hash.match(/u=([a-z0-9]+)/i) || [])[1];
if (hashRoom) { fillHome(); renderAccountUI(); startOnline(hashRoom); }
else if (hashProfile) { fillHome(); renderAccountUI(); showProfile(hashProfile); }
else showHome();
if (!store.get('janken-seen')) {
  $('rules-link').classList.add('attention');
  $('rules-tab').classList.add('attention');
}
