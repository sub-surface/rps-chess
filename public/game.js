// JANKEN client — homepage, local play (over-the-board / bot / bot-vs-bot), and online rooms.
// All rules live in engine.js (shared with the server), so hints match server validation.
import * as E from '/engine.js';
import { annotateMoves, exportJpgn } from '/notation.js';
import { glyph, PIECE_STYLE_IDS, PIECE_STYLES } from '/pieces.js';
import { mountFact } from '/facts.js';
import * as TB from '/tablebase.js';
const { BLUE, RED, other } = E;

// ── config + identity (persisted) ───────────────────────────────────────────
const DEFAULTS = {
  ...E.PRESETS.standard,
  coords: true, hints: true, sound: true, pieceStyle: 'sprite', coordStyle: 'chess', zen: false,
};
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
const legacyMelee = rulesCfg.size === 9
  && rulesCfg.perType === 2
  && ['rock', 'paper', 'scissors'].every((type) => E.movementFor(rulesCfg, type) === 'king')
  && rulesCfg.capture === 'chess'
  && !rulesCfg.territory
  && rulesCfg.layout === 'rows'
  && rulesCfg.actionsPerTurn === 1
  && rulesCfg.first === BLUE;
if (legacyStandard) {
  Object.assign(rulesCfg, E.PRESETS.standard);
} else if (legacyMelee) {
  // Melee was formerly the all-kings chess-capture/elimination preset. Keep players who
  // selected that exact ruleset on Melee as it evolves into the enclosure variant.
  Object.assign(rulesCfg, E.PRESETS.melee);
}
const cfg = {
  ...DEFAULTS,
  ...rulesCfg,
  coords: savedCfg.coords !== false,
  hints: savedCfg.hints !== false,
  sound: savedCfg.sound !== false,
  // A retired style ID resolves to the current default rather than rendering blank, which is what
  // makes culling a family safe for a browser that has one persisted.
  pieceStyle: PIECE_STYLE_IDS.includes(savedCfg.pieceStyle) ? savedCfg.pieceStyle : DEFAULTS.pieceStyle,
  coordStyle: E.COORD_STYLES.includes(savedCfg.coordStyle) ? savedCfg.coordStyle : 'chess',
  zen: savedCfg.zen === true,
  botLevel: savedCfg.botLevel === 'perfect' ? 'perfect' : 'normal',
};
// `cfg` is the live config the board plays under, so joining an online room overwrites its
// rules. `ownRules` is the variant this player chose, and only it is ever persisted —
// otherwise a visit to someone else's 13×13 game would quietly replace your saved preset.
let ownRules = E.sanitizeCfg(cfg);
const saveCfg = () => store.set('janken-cfg', JSON.stringify({
  ...ownRules,
  coords: cfg.coords, hints: cfg.hints, sound: cfg.sound, pieceStyle: cfg.pieceStyle,
  coordStyle: cfg.coordStyle, zen: cfg.zen, botLevel: cfg.botLevel,
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

// ── sounds — synthesized on demand, still no assets ──────────────────────────
// Each piece sounds like the thing it is: a rock knocks, paper rustles, scissors snip. Rock and
// scissors are pitched noise bursts because a stone knock and a blade closing are both broadband
// transients that no oscillator imitates; paper is a longer, softer band of the same noise.
let audioCtx = null;
let noiseBuffer = null;
const audio = () => {
  if (!cfg.sound) return null;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch { return null; }
};
function blip(freq, dur = 0.06, gain = 0.05, type = 'sine') {
  const ctx = audio();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch { /* audio is optional */ }
}
// One second of white noise, generated once and replayed at different rates and bandwidths.
function noise(ctx) {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const frames = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}
// `sweep` bends the filter across the burst: downward reads as a knock settling, upward as a
// blade closing. `q` decides how tonal the burst is — a high Q on a short burst is a woodblock.
function thud(freq, dur, gain, { q = 1, sweep = 1, type = 'bandpass' } = {}) {
  const ctx = audio();
  if (!ctx) return;
  try {
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise(ctx);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;   // a touch of variation per move
    filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, freq * sweep), ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter); filter.connect(g); g.connect(ctx.destination);
    src.start(); src.stop(ctx.currentTime + dur);
  } catch { /* audio is optional */ }
}
const PIECE_SOUNDS = {
  rock: () => { thud(320, 0.09, 0.07, { q: 3.4, sweep: 0.35 }); blip(140, 0.05, 0.03, 'triangle'); },
  paper: () => thud(2600, 0.14, 0.035, { q: 0.7, sweep: 0.6, type: 'highpass' }),
  scissors: () => { thud(1900, 0.05, 0.055, { q: 6, sweep: 2.2 }); setTimeout(() => thud(2400, 0.045, 0.045, { q: 6, sweep: 0.5 }), 42); },
};
// A move sounds like the piece that moved; a capture adds the loser's sound just behind it, so a
// trade is audibly two objects rather than one louder click.
const soundMove = (type) => (PIECE_SOUNDS[type] || (() => blip(220, 0.05, 0.045)))();
const soundCap = (type, taken) => {
  soundMove(type);
  if (PIECE_SOUNDS[taken]) setTimeout(() => PIECE_SOUNDS[taken](), 55);
  else blip(150, 0.09, 0.05, 'square');
};
const soundEnd = () => { blip(392, 0.09, 0.05); setTimeout(() => blip(523, 0.14, 0.05), 100); };

// ── piece glyphs ─────────────────────────────────────────────────────────────
const pieceGlyph = (type, color, style = cfg.pieceStyle) => glyph(type, color, style);
const legendGlyph = (type) => pieceGlyph(type, 'B').replace('pc-B', 'pc');
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
  repetitions: {},
  thinking: false,
  cfg,
};
let positions = [], viewPly = 0;
let mode = 'human';        // 'human' | 'bot' | 'botbot' | (online → net set)
let net = null;
let gen = 0;               // bumps to cancel stale bot timeouts / sockets
let editing = false, editBoard = null, tool = 'move';
let analysisDraft = null;
let edSel = null, edTargets = [];
const BOTSIDE = RED;

const liveIndex = () => positions.length - 1;
const isLive = () => viewPly === liveIndex();
const canNavigateHistory = () => !net || net.role === 'S';
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
  repetitions: state.repetitions,
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
    repetitions: d.repetitions || {},
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

// ── tablebase oracle ────────────────────────────────────────────────────────
// Loaded whenever the rules in play happen to be solved, which is what lets the analysis panel
// state a verdict and the bot play one. `oracle` is null for almost every game and that is the
// normal case, not a failure: nothing is fetched for a board the tables do not cover.
let oracle = null;
let oracleFor = '';
function syncOracle() {
  const key = JSON.stringify(E.sanitizeCfg(cfg));
  if (key === oracleFor) return;
  oracleFor = key;
  oracle = null;
  TB.oracleFor(cfg).then((found) => {
    // A slower load for a config the player has since left must not overwrite the current one.
    if (oracleFor !== key) return;
    oracle = found;
    if (editing) renderTbVerdict();
  }).catch(() => { /* a missing table is a missing bonus, never a broken game */ });
}

// ── bot ──────────────────────────────────────────────────────────────────────
// A perfect move when the tables cover these rules and the player asked for one: a top-valued
// move, chosen at random among equals so a rematch is not the same game twice.
function perfectPick(color) {
  if (cfg.botLevel !== 'perfect' || !oracle) return null;
  const top = TB.topMoves(TB.rankMoves(TB.movesFrom(oracle.table, state.board, color, E.sanitizeCfg(cfg))));
  return top.length ? top[(Math.random() * top.length) | 0] : null;
}
function metricDiff(board, color) {
  if (cfg.territory) { const s = E.scoreOf(board); return color === BLUE ? s.B - s.R : s.R - s.B; }
  const p = E.pieceCounts(board); return color === BLUE ? p.B - p.R : p.R - p.B;
}
function botPick(color) {
  const perfect = perfectPick(color);
  if (perfect) return perfect;
  const moves = E.allMoves(state.board, color, cfg);
  if (!moves.length) return null;
  const mid = (state.board.length - 1) / 2;
  let best = [], bv = -Infinity;
  for (const m of moves) {
    const b = E.cloneBoard(state.board);
    const target = E.captureTarget(b, m, cfg);
    const cap = !!target, p = b[m.fr][m.fc].piece;
    b[m.fr][m.fc].piece = null;
    if (target) b[target.row][target.col].piece = null;
    if (cfg.territory && cfg.trail && E.pattern(p.type, cfg).slide) {
      const dr = Math.sign(m.tr - m.fr), dc = Math.sign(m.tc - m.fc);
      for (let r = m.fr + dr, c = m.fc + dc; r !== m.tr || c !== m.tc; r += dr, c += dc) {
        if (b[r][c].owner === null) b[r][c].owner = color;
      }
    }
    b[m.tr][m.tc] = { owner: cfg.territory ? color : b[m.tr][m.tc].owner, piece: p };
    const enclosed = cfg.territory && cfg.enclosure
      ? E.captureEnclosures(b, color)
      : { squares: 0, pieces: 0 };
    let v = metricDiff(b, color);
    if (cap) v += cfg.territory ? 2.2 : 3.0;
    if (enclosed.pieces) v += enclosed.pieces * 3;
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
  const last = state.moves[state.moves.length - 1] || {};
  if (state.gameOver) soundEnd(); else if (cap) soundCap(last.piece, last.capture); else soundMove(last.piece);
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
  syncOracle();
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
      s.pcw.innerHTML = cell.piece ? pieceGlyph(cell.piece.type, cell.piece.color) : '';
      s.pieceKey = pieceKey;
    }
    const square = E.sqName(r, c, size, cfg.coordStyle);
    const label = cell.piece
      ? `${cell.piece.color === BLUE ? 'Blue' : 'Red'} ${cell.piece.type} on ${square}`
      : `Empty ${square}`;
    if (s.label !== label) { s.btn.setAttribute('aria-label', label); s.label = label; }
    const showR = cfg.coords && dc === 0, showF = cfg.coords && dr === size - 1;
    const [edge, foot] = E.axisLabels(r, c, size, cfg.coordStyle);
    s.rank.hidden = !showR; if (showR) s.rank.textContent = edge;
    s.file.hidden = !showF; if (showF) s.file.textContent = foot;
  }
  state.justMovedTo = null;
  renderHUD(board);
  refreshFavicon();
  if (editing) renderTbVerdict();
}

// ── the analysis board's tablebase readout ──────────────────────────────────
// Exact, or absent. Nothing here evaluates a position: if the shipped tables do not cover the
// rules on the board, the panel says nothing rather than guessing, and it stays out of live play
// so a solved verdict can never become a hint mid-game.
const TB_WORDS = { 1: 'Win', 0: 'Draw', '-1': 'Loss' };
const edFirst = () => ($('ed-first').value === RED ? RED : BLUE);
function renderTbVerdict() {
  const box = $('ed-tb');
  const safe = E.sanitizeCfg(cfg);
  const verdict = oracle && TB.probe(oracle.table, editBoard, edFirst());
  if (!verdict) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  const mover = edFirst() === BLUE ? 'Blue' : 'Red';
  const ranked = TB.rankMoves(TB.movesFrom(oracle.table, editBoard, edFirst(), safe));
  const top = TB.topMoves(ranked);
  const word = TB_WORDS[String(verdict.value)];
  const detail = verdict.value === 0
    ? 'no forced result for either side'
    : `${verdict.dtm} ${verdict.dtm === 1 ? 'ply' : 'plies'} under best play`;
  box.hidden = false;
  box.innerHTML = `<div class="tbv-head"><b class="tbv-${word.toLowerCase()}">${word} for ${mover}</b>`
    + `<span>${detail}</span></div>`
    + `<p class="tbv-src">Solved ${oracle.label} tablebase · exact, positional</p>`
    + (top.length
      ? `<p class="tbv-best">Best: ${top.slice(0, 4).map((m) => tbMoveText(m, safe)).join(' · ')}`
        + `${top.length > 4 ? ` and ${top.length - 4} more` : ''}</p>`
      : '');
}
const tbMoveText = (move, safe) => {
  const from = E.sqName(move.fr, move.fc, safe.size, cfg.coordStyle);
  const to = E.sqName(move.tr, move.tc, safe.size, cfg.coordStyle);
  return `${move.piece.type[0].toUpperCase()}${from}${move.captured ? '×' : '–'}${to}`;
};
// Redrawing a favicon is cheap but not free, and render() runs on every hover; only the facts the
// icon actually shows are worth reacting to.
let faviconKey = '';
function refreshFavicon() {
  const key = `${document.body.dataset.screen}:${state.turn}:${state.gameOver ? 1 : 0}`;
  if (key === faviconKey) return;
  faviconKey = key;
  paintFavicon();
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

  const scrub = !canNavigateHistory();
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
  const key = cfg.coordStyle + '|' + state.moves
    .map((move) => `${move.c}:${move.piece}:${move.from}:${move.to}:${move.capture || ''}:${move.t || ''}`)
    .join('|');
  if (key === lastLogKey) return;
  lastLogKey = key;
  const rows = [];
  for (const entry of annotateMoves(state.moves, cfg.size, cfg.coordStyle)) {
    let row = rows[rows.length - 1];
    if (!row || row.n !== entry.round) {
      row = { n: entry.round, B: [], R: [] };
      rows.push(row);
    }
    if (row[entry.color]) row[entry.color].push(entry);
  }
  const log = $('log');
  const fragment = document.createDocumentFragment();
  const multi = (cfg.actionsPerTurn || 1) > 1;
  for (const row of rows) {
    const number = document.createElement('li');
    number.className = 'n';
    number.textContent = `${row.n}.`;
    fragment.append(number);
    for (const color of [BLUE, RED]) {
      const cell = document.createElement('span');
      cell.className = 'turn-moves';
      for (const entry of row[color]) {
        const move = document.createElement('span');
        move.className = `mv ${color === BLUE ? 'b' : 'r'}`;
        move.dataset.ply = entry.ply;
        move.textContent = `${multi ? `${entry.action}:` : ''}${entry.display || '?'}`;
        cell.append(move);
      }
      fragment.append(cell);
    }
  }
  log.replaceChildren(fragment);
  log.scrollTop = log.scrollHeight;
}
// Local games and online spectators can jump straight to any recorded action.
$('log').onclick = (e) => {
  const mv = e.target.closest('.mv');
  if (!mv || !canNavigateHistory() || !+mv.dataset.ply || +mv.dataset.ply > liveIndex()) return;
  nav(+mv.dataset.ply);
};

const fmtDelta = (d) => (d >= 0 ? '+' : '−') + Math.abs(Math.round(d));
function renderBanner(res) {
  const el = $('banner');
  if (!state.gameOver || editing || !isLive()) { el.hidden = true; return; }
  // An adjudicated (abandonment) result overrides the board score.
  const repetitionDraw = state.endReason === 'repetition';
  const forced = net && state.winner ? state.winner : null;
  const side = repetitionDraw ? null : forced || (res.B > res.R ? BLUE : res.R > res.B ? RED : null);
  const winner = side === BLUE ? 'Blue wins' : side === RED ? 'Red wins' : 'Draw';
  const cls = side === BLUE ? 'tb' : side === RED ? 'tr' : '';
  const win = side === BLUE ? 'win-b' : side === RED ? 'win-r' : 'win-d';
  const unit = res.metric === 'squares' ? '' : ' pieces';
  const lines = [];
  if (net && state.endReason === 'abandon') lines.push(`${side === BLUE ? 'Red' : 'Blue'} left the game`);
  else if (net && state.endReason === 'resign') lines.push(`${side === BLUE ? 'Red' : 'Blue'} resigned`);
  else if (repetitionDraw) lines.push('Position repeated three times');
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
  g.innerHTML = pieceGlyph(piece.type, piece.color);
  document.body.appendChild(g);
  return g;
}
// Pointer events can arrive several times per frame. Painting the ghost once per frame, by
// transform, keeps a drag off the layout path entirely — the difference is visible on a phone.
let dragFrame = 0;
function moveGhost(x, y) {
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = 0;
    if (drag?.ghost) drag.ghost.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  });
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
    drag.ghost.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
    try { boardEl.setPointerCapture(drag.pointerId); } catch { /* older browsers */ }
  }
  moveGhost(e.clientX, e.clientY);
  e.preventDefault();
});
window.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag; drag = null;
  if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = 0; }
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
  if (e.key === 'z' || e.key === 'Z') { setZen(!cfg.zen); return; }
  if (editing || !canNavigateHistory()) return;
  if (e.key === 'ArrowLeft') { nav(viewPly - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { nav(viewPly + 1); e.preventDefault(); }
  else if (e.key === 'Home') { nav(0); e.preventDefault(); }
  else if (e.key === 'End') { nav(liveIndex()); e.preventDefault(); }
});
function nav(to) {
  if (!canNavigateHistory()) return;
  viewPly = Math.max(0, Math.min(liveIndex(), to));
  state.selected = null;
  state.targets = [];
  render();
}

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
    repetitions: gm.repetitions,
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
    unlisted: !!opts.unlisted,
    notice: '',
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
    ...(session.unlisted ? { unlisted: true } : {}),
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
  const previousServerMoves = lastServerMoves;
  const wasFollowingLive = isLive();
  const reviewedPly = viewPly;
  const rematch = (state.startedAt && s.startedAt && state.startedAt !== s.startedAt)
    || (state.gameOver && !s.gameOver && (!s.moves || s.moves.length === 0));
  if (rematch) resetChat();
  Object.assign(cfg, E.sanitizeCfg(s.cfg));
  if (curSize !== cfg.size) build(cfg.size);
  const moves = Array.isArray(s.moves) ? s.moves : [];
  if (lastServerMoves >= 0 && moves.length > lastServerMoves) {
    const last = moves[moves.length - 1] || {};
    if (s.gameOver) soundEnd();
    else if ((last.capture || '') || (last.t || '').includes('×')) soundCap(last.piece, last.capture);
    else soundMove(last.piece);
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
    unlisted: !!s.unlisted,
  });
  net.names = s.names || {}; net.seats = s.seats || {}; net.online = s.online || {};
  net.ratings = s.ratings || {}; net.accounts = s.accounts || {};
  net.error = '';
  if (account && (net.role === 'B' || net.role === 'R') && net.accounts[net.role] === account.id) setMyRating(net.ratings[net.role]);
  if (net.role === 'S') {
    const frame = () => JSON.stringify({
      board: E.cloneBoard(state.board),
      lastMove: state.lastMove ? { ...state.lastMove } : null,
    });
    const canAppend = !rematch
      && previousServerMoves >= 0
      && moves.length === previousServerMoves + 1
      && positions.length === previousServerMoves + 1;
    const canRefresh = !rematch
      && previousServerMoves === moves.length
      && positions.length === moves.length + 1;
    if (canAppend) {
      positions.push(frame());
    } else if (canRefresh) {
      positions[positions.length - 1] = frame();
    } else {
      try {
        positions = E.replayFrames({
          cfg,
          startPos: state.startPos,
          startOwners: state.startOwners,
          moves,
        }).map((item) => JSON.stringify(item));
      } catch {
        positions = [frame()];
      }
    }
    viewPly = (rematch || wasFollowingLive)
      ? liveIndex()
      : Math.min(reviewedPly, liveIndex());
  } else {
    positions = [snap()];
    viewPly = 0;
  }
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
  $('oprivate').hidden = !state.unlisted;
  $('onotice').textContent = net.notice || '';
  $('onotice').hidden = !net.notice;
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
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pal'; b.dataset.type = type; b.dataset.color = color; b.innerHTML = pieceGlyph(type, color);
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
function updateAnalysisRuleMenu() {
  const preset = E.presetOf(E.sanitizeCfg(cfg));
  $('ed-rule-label').textContent = `Rules · ${E.presetLabel(preset)} ▾`;
  $('ed-rule-label').title = E.variantLabel(cfg);
  for (const button of $('ed-rule-list').querySelectorAll('[data-preset]')) {
    button.classList.toggle('on', button.dataset.preset === preset);
  }
}
function applyAnalysisPreset(key) {
  if (!E.PRESETS[key]) return;
  const previousSize = cfg.size;
  customising = false;
  Object.assign(cfg, E.sanitizeCfg(E.PRESETS[key]));
  adoptRules();
  if (cfg.size !== previousSize) {
    build(cfg.size);
    editBoard = E.blocksBoard(cfg.size, cfg.perType, cfg.layout);
  }
  edSel = null;
  edTargets = [];
  $('ed-first').value = cfg.first;
  $('ed-rule-menu').open = false;
  updateAnalysisRuleMenu();
  renderLegend();
  render();
}
function openAnalysisRuleEditor() {
  analysisDraft = { board: E.cloneBoard(editBoard), size: editBoard.length };
  editing = false;
  edSel = null;
  edTargets = [];
  $('editpanel').hidden = true;
  $('panel').hidden = false;
  showHome({ keepAnalysisDraft: true });
  choosePreset('custom');
  $('analysis-btn').textContent = 'return to analysis';
  requestAnimationFrame(() => $('config-details').scrollIntoView({ behavior: 'smooth', block: 'center' }));
}
function buildAnalysisRuleMenu() {
  const list = $('ed-rule-list');
  list.innerHTML = '';
  for (const key of E.PRESET_KEYS.filter((preset) => preset !== 'custom')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.preset = key;
    button.textContent = E.PRESET_INFO[key].label;
    button.title = E.PRESET_INFO[key].tagline;
    button.onclick = () => applyAnalysisPreset(key);
    list.append(button);
  }
  const custom = document.createElement('button');
  custom.type = 'button';
  custom.className = 'custom';
  custom.textContent = 'Customise rules…';
  custom.onclick = openAnalysisRuleEditor;
  list.append(custom);
}
buildAnalysisRuleMenu();
function enterEdit(startBoard) {
  analysisDraft = null;
  $('analysis-btn').textContent = 'analysis';
  gen++; leaveOnline(); mode = 'human'; showGame();
  if (curSize !== cfg.size) build(cfg.size);
  if (!paletteBuilt) buildPalette();
  editing = true; tool = 'move'; edSel = null; edTargets = []; markTool();
  editBoard = startBoard || E.blocksBoard(cfg.size, cfg.perType, cfg.layout);
  $('ed-first').value = cfg.first;
  $('panel').hidden = true; $('editpanel').hidden = false; $('online').hidden = true; $('players').hidden = true;
  updateAnalysisRuleMenu();
  render();
}
function cancelEdit() { editing = false; edSel = null; edTargets = []; $('editpanel').hidden = true; $('panel').hidden = false; showHome(); }
// Sandbox move: legality follows the current rules, but either side may move at any time.
function analysisMove(fr, fc, tr, tc) {
  const safe = E.sanitizeCfg(cfg), b = editBoard, p = b[fr][fc].piece;
  const target = E.captureTarget(b, { fr, fc, tr, tc }, safe);
  const cap = !!target;
  b[fr][fc].piece = null;
  if (target) b[target.row][target.col].piece = null;
  if (safe.territory && safe.trail && E.pattern(p.type, safe).slide) {
    const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
    for (let r = fr + dr, c = fc + dc; r !== tr || c !== tc; r += dr, c += dc) {
      if (b[r][c].owner === null) b[r][c].owner = p.color;
    }
  }
  b[tr][tc] = { owner: safe.territory ? p.color : b[tr][tc].owner, piece: p };
  const enclosed = safe.territory && safe.enclosure
    ? E.captureEnclosures(b, p.color)
    : { pieces: 0 };
  if (cap || enclosed.pieces) soundCap(p.type, target?.piece?.type); else soundMove(p.type);
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
  editBoard = E.mirrorArmy(editBoard, BLUE);
  edSel = null; edTargets = []; render();
};
$('ed-rotate').onclick = () => {
  editBoard = E.rotateBoard(editBoard);
  edSel = null; edTargets = []; render();
};

// ── screens / homepage ────────────────────────────────────────────────────────
let previewPiece = 'rock';
function previewGlyph(type, color, x, y, size) {
  return pieceGlyph(type, color).replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
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
  const capture = safe.capture === 'rps'
    ? 'RPS captures'
    : safe.capture === 'checkers' ? 'leap captures' : 'capture any piece';
  const goal = safe.enclosure
    ? 'enclosure · first past half'
    : safe.territory
      ? (safe.retread ? 'territory + re-tread' : 'new territory only')
      : 'elimination';
  const facts = [
    `${safe.size}×${safe.size}`,
    `${safe.perType} / type`,
    `${'●'.repeat(safe.actionsPerTurn)} ${safe.actionsPerTurn} action${safe.actionsPerTurn === 1 ? '' : 's'}`,
    `${safe.first === BLUE ? 'Blue' : 'Red'} first`,
    capture,
    goal,
    `${safe.layout} start`,
    safe.threefold ? '3-fold draw' : 'no repetition draw',
  ];
  if (safe.trail) facts.push('ink trail');
  if (safe.enclosure) facts.push('surround capture');
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
function showHome(options = {}) {
  if (!options?.keepAnalysisDraft) {
    analysisDraft = null;
    $('analysis-btn').textContent = 'analysis';
  }
  gen++; leaveOnline(); toggleRulesFlap(false); Object.assign(cfg, ownRules); editing = false; currentProfile = null; $('editpanel').hidden = true; $('panel').hidden = false; document.body.dataset.screen = 'home'; $('home').hidden = false; $('game').hidden = true; $('profilepage').hidden = true; if (location.hash) location.hash = ''; fillHome(); renderAccountUI(); startLobbyPoll(); ensureShowcase();
}

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

const MOVEMENT_PRESETS = {
  kings: ['king', 'king', 'king'],
  longkings: ['longking', 'longking', 'longking'],
  field: ['rook', 'knight', 'bishop'],
  queens: ['queen', 'queen', 'queen'],
};
const movementPresetOf = (rules) => {
  const moves = ['rock', 'paper', 'scissors'].map((type) => E.movementFor(rules, type));
  return Object.entries(MOVEMENT_PRESETS)
    .find(([, preset]) => preset.every((move, index) => move === moves[index]))?.[0] || 'custom';
};
function setMovementInputs(moves) {
  ['rock', 'paper', 'scissors'].forEach((type, index) => {
    $(`s-move-${type}`).value = moves[index];
  });
}

function syncBoardInputs() {
  const perMax = E.maxPerTypeForBoard(cfg.size, cfg.layout);
  $('s-size').value = cfg.size;
  $('s-size-v').textContent = `${cfg.size}×${cfg.size}`;
  $('s-per').max = perMax;
  $('s-per').value = cfg.perType;
  $('s-per-v').textContent = cfg.perType;
}

function fillHome() {
  syncBoardInputs();
  $('s-acts').value = cfg.actionsPerTurn; $('s-acts-v').textContent = cfg.actionsPerTurn;
  $('s-move-rock').value = E.movementFor(cfg, 'rock');
  $('s-move-paper').value = E.movementFor(cfg, 'paper');
  $('s-move-scissors').value = E.movementFor(cfg, 'scissors');
  $('s-move-preset').value = movementPresetOf(cfg);
  $('s-cap').value = cfg.capture;
  $('s-threefold').checked = cfg.threefold;
  $('s-terr').value = cfg.territory ? 'territory' : 'elimination';
  $('s-retread').checked = cfg.retread; $('s-trail').checked = cfg.trail; $('s-enclosure').checked = cfg.enclosure;
  $('s-layout').value = cfg.layout; $('s-first').value = cfg.first;
  $('s-coords').checked = cfg.coords; $('s-hints').checked = cfg.hints; $('s-sound').checked = cfg.sound;
  $('s-coordstyle').value = cfg.coordStyle;
  $('s-botlevel').value = cfg.botLevel;
  $('name-input').value = name;
  $('retread-row').hidden = !cfg.territory;
  $('trail-row').hidden = !cfg.territory;
  $('enclosure-row').hidden = !cfg.territory;
  updateVariantLine(); markPreset(); renderVariantPreview();
  if (customising || E.presetOf(E.sanitizeCfg(cfg)) === 'custom') $('config-details').open = true;
}
function readHome() {
  cfg.size = +$('s-size').value; cfg.perType = +$('s-per').value; cfg.actionsPerTurn = +$('s-acts').value;
  cfg.rockMove = $('s-move-rock').value;
  cfg.paperMove = $('s-move-paper').value;
  cfg.scissorsMove = $('s-move-scissors').value;
  cfg.capture = $('s-cap').value; cfg.layout = $('s-layout').value;
  cfg.threefold = $('s-threefold').checked;
  cfg.territory = $('s-terr').value === 'territory'; cfg.retread = $('s-retread').checked && cfg.territory;
  cfg.trail = $('s-trail').checked && cfg.territory;
  cfg.enclosure = $('s-enclosure').checked && cfg.territory;
  cfg.first = $('s-first').value; cfg.coords = $('s-coords').checked; cfg.hints = $('s-hints').checked;
  Object.assign(cfg, E.sanitizeCfg(cfg));
  syncBoardInputs();
  $('s-move-preset').value = movementPresetOf(cfg);
  adoptRules(); updateVariantLine(); markPreset(); renderVariantPreview();
}
function updateVariantLine() {
  const safe = E.sanitizeCfg(cfg);
  $('variant-line').textContent = E.variantLabel(safe);
  $('play-variant').textContent = E.presetLabel(customising ? 'custom' : E.presetOf(safe));
  $('play-variant').title = E.variantLabel(safe);
}
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
for (const id of ['s-first', 's-threefold', 's-retread', 's-trail', 's-enclosure', 's-layout']) $(id).onchange = readHome;
for (const id of ['s-move-rock', 's-move-paper', 's-move-scissors']) $(id).onchange = () => {
  if ($('s-cap').value === 'checkers' && movementPresetOf({
    rockMove: $('s-move-rock').value,
    paperMove: $('s-move-paper').value,
    scissorsMove: $('s-move-scissors').value,
  }) !== 'longkings') {
    $('s-cap').value = 'rps';
  }
  readHome();
};
$('s-move-preset').onchange = () => {
  const preset = MOVEMENT_PRESETS[$('s-move-preset').value];
  if (!preset) return;
  setMovementInputs(preset);
  if ($('s-cap').value === 'checkers' && $('s-move-preset').value !== 'longkings') {
    $('s-cap').value = 'rps';
  }
  readHome();
};
$('s-cap').onchange = () => {
  if ($('s-cap').value === 'checkers') {
    setMovementInputs(MOVEMENT_PRESETS.longkings);
    $('s-move-preset').value = 'longkings';
  }
  readHome();
};
$('s-move-rotate').onclick = () => {
  const rock = $('s-move-rock').value;
  $('s-move-rock').value = $('s-move-scissors').value;
  $('s-move-scissors').value = $('s-move-paper').value;
  $('s-move-paper').value = rock;
  readHome();
};
// View preferences live in the Preferences dialog so they can change mid-game too.
for (const id of ['s-coords', 's-hints', 's-sound', 's-coordstyle', 's-botlevel']) $(id).onchange = () => {
  cfg.coords = $('s-coords').checked; cfg.hints = $('s-hints').checked; cfg.sound = $('s-sound').checked;
  cfg.coordStyle = $('s-coordstyle').value === 'grid' ? 'grid' : 'chess';
  cfg.botLevel = $('s-botlevel').value === 'perfect' ? 'perfect' : 'normal';
  saveCfg();
  if (document.body.dataset.screen === 'game') render();
};
// The verdict is stated for whoever is to move, so changing that changes the answer.
$('ed-first').onchange = () => { if (editing) renderTbVerdict(); };
$('s-terr').onchange = () => {
  const elim = $('s-terr').value !== 'territory';
  $('retread-row').hidden = elim;
  $('trail-row').hidden = elim;
  $('enclosure-row').hidden = elim;
  readHome();
};
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

for (const b of document.querySelectorAll('[data-mode]')) b.onclick = () => {
  readHome();
  const m = b.dataset.mode;
  if (m === 'online') startOnline(genRoom(), { host: true });
  else if (m === 'friend') {
    // Copy inside the click so the clipboard write keeps its user gesture.
    const room = genRoom();
    const link = `${location.origin}/#r=${room}`;
    const copied = navigator.clipboard?.writeText(link).then(() => true, () => false) ?? Promise.resolve(false);
    startOnline(room, { host: true, unlisted: true });
    copied.then((ok) => {
      if (net && net.room === room) {
        net.notice = ok ? 'Private room — link copied, send it to a friend.' : 'Private room — copy the link below and send it.';
        updateOnlineUI();
      }
    });
  } else startLocal(m);
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
$('change-variant').onclick = () => {
  $('presets').scrollIntoView({ behavior: 'smooth', block: 'center' });
  const chip = document.querySelector('#presets .chip.on') || $('presets').firstElementChild;
  if (chip) chip.focus({ preventScroll: true });
};
$('play-btn').onclick = showHome;
// From a game, analyse the position in front of you; from anywhere else, the variant's opening.
$('analysis-btn').onclick = () => {
  if (editing) return;
  if (analysisDraft) {
    const draft = analysisDraft;
    const board = draft.size === cfg.size ? E.cloneBoard(draft.board) : undefined;
    enterEdit(board);
    return;
  }
  const live = document.body.dataset.screen === 'game' && Array.isArray(state.board);
  enterEdit(live ? E.cloneBoard(state.board) : undefined);
};

// ── appearance ────────────────────────────────────────────────────────────────
function buildPStyle() {
  const el = $('pstyle'); el.innerHTML = '';
  for (const { id, label } of PIECE_STYLES) {
    const o = document.createElement('button'); o.type = 'button'; o.className = 'opt'; o.dataset.style = id;
    o.innerHTML = `<div class="row">${pieceGlyph('rock', 'R', id)}${pieceGlyph('paper', 'B', id)}${pieceGlyph('scissors', 'R', id)}</div><div class="nm">${label}</div>`;
    o.onclick = () => {
      cfg.pieceStyle = id; saveCfg(); markPStyle(); renderVariantPreview(); renderHero();
      if (curSize) renderLegend();
      if (paletteBuilt) buildPalette();
      if (document.body.dataset.screen === 'game') render();
    };
    el.appendChild(o);
  }
  markPStyle();
}
function markPStyle() { for (const o of $('pstyle').children) o.classList.toggle('on', o.dataset.style === cfg.pieceStyle); }

// ── GIF piece rasterizer ─────────────────────────────────────────────────────
// Turns the active pieces.js glyph into a block of palette indices for gif.js, which never learns
// where the artwork came from. Browsers do not rasterize SVG identically, so this is deliberately
// the untested path: gif.js still draws its own geometry whenever the hook is absent.
//
// Returns null on any failure — an unsupported OffscreenCanvas, a sprite sheet that has not
// finished loading, a tainted read — and a null stamp simply falls back to the geometric renderer.
// Rasterizing is asynchronous — an SVG has to decode before it can be drawn — while gif.js renders
// synchronously, so all six stamps are prepared up front and the hook itself is a map lookup.
async function pieceStamper(palette, cell) {
  const nearest = (r, g, b) => {
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i];
      const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return best;
  };
  const stamps = new Map();
  const rasterize = async (type, color) => {
    const svg = pieceGlyph(type, color)
      .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}" `);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = new OffscreenCanvas(cell, cell);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, cell, cell);
    const { data } = context.getImageData(0, 0, cell, cell);
    const stamp = new Uint8Array(cell * cell).fill(255);
    let painted = 0;
    for (let i = 0; i < cell * cell; i++) {
      if (data[i * 4 + 3] < 128) continue;
      stamp[i] = nearest(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      painted++;
    }
    if (painted) stamps.set(`${type}:${color}`, stamp);
  };
  try {
    for (const type of ['rock', 'paper', 'scissors']) {
      for (const color of [BLUE, RED]) await rasterize(type, color);
    }
  } catch { /* an unsupported canvas or a slow sheet: gif.js falls back to its own geometry */ }
  // No stamps at all means no hook, so the export takes exactly the path the tests assert.
  return stamps.size ? ((type, color) => stamps.get(`${type}:${color}`) || null) : null;
}
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
    const { exportGameGif, frameGeometry, PALETTES } = await import('/gif.js');
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const { cell } = frameGeometry(state.board.length);
    const blob = exportGameGif(state, {
      theme,
      drawPiece: await pieceStamper(PALETTES[theme], cell),
    });
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

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#000000' : '#ffffff');
  store.set('janken-theme', t);
  paintFavicon();
}
$('theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// ── zen mode ────────────────────────────────────────────────────────────────
// One body attribute; the CSS decides what counts as chrome. Persisted, because someone who wants
// a bare board wants it on the next visit too.
function setZen(on) {
  cfg.zen = !!on;
  document.body.classList.toggle('zen', cfg.zen);
  $('zen-btn').classList.toggle('on', cfg.zen);
  saveCfg();
}
$('zen-btn').onclick = () => setZen(!cfg.zen);
setZen(cfg.zen);

// ── favicon ─────────────────────────────────────────────────────────────────
// Drawn rather than shipped, so it can follow the theme and say whose turn it is at a glance in a
// crowded tab strip: the ring is the side to move, and it fills solid once the game is over.
const FAVICON_HUES = { B: '#4c8dff', R: '#ff5c5c' };
let faviconLink = null;
function paintFavicon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const playing = document.body.dataset.screen === 'game';
  const turn = playing && !state.gameOver ? state.turn : null;
  const accent = FAVICON_HUES[turn] || (dark ? '#f4f4f4' : '#111111');
  const done = playing && state.gameOver;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`
    + `<rect width="32" height="32" rx="7" fill="${dark ? '#0b0b0b' : '#fbfbfb'}"/>`
    + `<circle cx="16" cy="16" r="8.5" fill="${done ? accent : 'none'}" stroke="${accent}" stroke-width="3"/>`
    + (done ? '' : `<circle cx="16" cy="16" r="2.6" fill="${accent}"/>`)
    + `</svg>`;
  faviconLink = faviconLink || document.querySelector('link[rel~="icon"]');
  if (faviconLink) faviconLink.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
}

// footer commit
fetch('/version.json').then(r => r.json()).then(v => { if (v && v.short) { const a = $('commit-link'); a.href = v.url; a.textContent = v.short; } }).catch(() => { });

// The hero shows the beats-cycle in the player's chosen piece style.
function renderHero() {
  $('hero-glyphs').innerHTML = ['rock', 'scissors', 'paper']
    .map((t) => pieceGlyph(t, 'N')).join('<span class="hg-sep">▸</span>');
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
mountFact($('dyk'));
