// JANKEN — rock·paper·scissors chess. A territory game.
// Rock = king (step 1), Paper = rook (slide straight), Scissors = bishop (slide diagonal).
// Land on a square → paint it your colour forever. Land on an enemy → capture it.
// Board fills up; most squares wins. Files a…, ranks size…1 (chess-standard).

const BLUE = 'B', RED = 'R';
const other = (c) => (c === BLUE ? RED : BLUE);
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

// ── settings (persisted) ────────────────────────────────────────────────────
const DEFAULTS = { size: 9, perType: 2, opponent: 'human', botSide: RED, first: BLUE, capture: 'chess', coords: true, hints: true };
const cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('janken-cfg') || '{}'));
let flipped = localStorage.getItem('janken-flip') === '1';
const saveCfg = () => localStorage.setItem('janken-cfg', JSON.stringify(cfg));

// ── piece glyphs (line-art, tinted by currentColor) ─────────────────────────
const GLYPH = {
  rock: `<path d="M50 20 C70 20 84 33 84 51 C84 71 66 82 48 82 C28 82 16 69 16 49 C16 32 32 20 50 20 Z"/>
         <path d="M33 56 L47 44 L59 53" stroke-width="5"/>`,
  paper: `<path d="M31 17 H60 L74 31 V83 H31 Z"/><path d="M60 17 V31 H74" stroke-width="5"/>
          <path d="M40 46 H64 M40 58 H64 M40 70 H56" stroke-width="5"/>`,
  scissors: `<circle cx="33" cy="73" r="9" stroke-width="6"/><circle cx="67" cy="73" r="9" stroke-width="6"/>
             <path d="M40 67 L76 21"/><path d="M60 67 L24 21"/><circle cx="50" cy="44" r="3.4" fill="currentColor" stroke="none"/>`,
};
const glyph = (type, color) =>
  `<svg class="pc pc-${color}" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="7">${GLYPH[type]}</svg>`;

const LETTER = { rock: 'R', paper: 'P', scissors: 'S' };
const fileL = (c) => String.fromCharCode(97 + c);
const sqName = (r, c, size) => fileL(c) + (size - r);

// ── movement ────────────────────────────────────────────────────────────────
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KING = [...ORTHO, ...DIAG];
const canCap = (att, def) => cfg.capture === 'chess' ? true : BEATS[att.type] === def.type;

function legalDest(board, r, c) {
  const p = board[r][c].piece;
  if (!p) return [];
  const S = board.length, inB = (a, b) => a >= 0 && a < S && b >= 0 && b < S, out = [];
  if (p.type === 'rock') {
    for (const [dr, dc] of KING) {
      const nr = r + dr, nc = c + dc;
      if (!inB(nr, nc)) continue;
      const t = board[nr][nc].piece;
      if (t && (t.color === p.color || !canCap(p, t))) continue;
      out.push([nr, nc]);
    }
  } else {
    for (const [dr, dc] of (p.type === 'paper' ? ORTHO : DIAG)) {
      let nr = r + dr, nc = c + dc;
      while (inB(nr, nc)) {
        const t = board[nr][nc].piece;
        if (!t) out.push([nr, nc]);
        else { if (t.color !== p.color && canCap(p, t)) out.push([nr, nc]); break; }
        nr += dr; nc += dc;
      }
    }
  }
  return out;
}

// ── board construction ──────────────────────────────────────────────────────
const emptyBoard = (S) => Array.from({ length: S }, () => Array.from({ length: S }, () => ({ owner: null, piece: null })));
const cloneBoard = (b) => b.map(row => row.map(c => ({ owner: c.owner, piece: c.piece ? { ...c.piece } : null })));

function blocksBoard(size, per) {
  const b = emptyBoard(size);
  const c0 = Math.floor((size - per) / 2);
  const rows = ['rock', 'paper', 'scissors'];              // Blue: back rank rocks → scissors facing out
  for (let i = 0; i < rows.length; i++)
    for (let k = 0; k < per; k++) {
      const r = size - 1 - i, c = c0 + k;
      b[r][c] = { owner: BLUE, piece: { type: rows[i], color: BLUE } };
      const rr = size - 1 - r, cc = size - 1 - c;           // 180° rotation → Red
      b[rr][cc] = { owner: RED, piece: { type: rows[i], color: RED } };
    }
  return b;
}

function scoreOf(board) {
  let B = 0, R = 0, open = 0;
  for (const row of board) for (const c of row) { if (c.owner === BLUE) B++; else if (c.owner === RED) R++; else open++; }
  return { B, R, open };
}
function hasMove(board, color) {
  for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
    const p = board[r][c].piece;
    if (p && p.color === color && legalDest(board, r, c).length) return true;
  }
  return false;
}

// ── state / history ─────────────────────────────────────────────────────────
const state = { board: blocksBoard(9, 2), turn: BLUE, selected: null, targets: [], lastMove: null, justMovedTo: null, moves: [], passStreak: 0, gameOver: false, thinking: false };
let positions = [];   // snapshot strings; positions[0] = start, last = live
let viewPly = 0;      // which position is displayed
let editing = false, editBoard = null, tool = { type: 'rock', color: BLUE };

const snap = () => JSON.stringify({ board: state.board, turn: state.turn, lastMove: state.lastMove, moves: state.moves, passStreak: state.passStreak, gameOver: state.gameOver });
function loadLive(s) {
  const d = JSON.parse(s);
  Object.assign(state, { board: d.board, turn: d.turn, lastMove: d.lastMove, moves: d.moves, passStreak: d.passStreak, gameOver: d.gameOver, selected: null, targets: [], justMovedTo: null });
}
const liveIndex = () => positions.length - 1;
const isLive = () => viewPly === liveIndex();
const botTurn = () => cfg.opponent === 'bot' && state.turn === cfg.botSide;
const canPlay = () => !state.gameOver && !state.thinking && !botTurn();

function settleTurn() {
  if (scoreOf(state.board).open === 0) { state.gameOver = true; return; }
  let guard = 0;
  while (!hasMove(state.board, state.turn)) {
    state.passStreak++;
    if (state.passStreak >= 2) { state.gameOver = true; return; }
    state.turn = other(state.turn);
    if (++guard > 3) { state.gameOver = true; return; }
  }
}

function doMove(m) {
  const p = state.board[m.fr][m.fc].piece;
  const cap = !!state.board[m.tr][m.tc].piece;
  state.board[m.fr][m.fc].piece = null;
  state.board[m.tr][m.tc] = { owner: p.color, piece: p };
  state.lastMove = { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc };
  state.justMovedTo = { r: m.tr, c: m.tc };
  state.moves.push({ c: p.color, t: `${LETTER[p.type]} ${sqName(m.fr, m.fc, state.board.length)}${cap ? '×' : '–'}${sqName(m.tr, m.tc, state.board.length)}` });
  state.passStreak = 0;
  state.selected = null; state.targets = [];
  state.turn = other(p.color);
  settleTurn();
  positions.push(snap());
  viewPly = liveIndex();
  render();
  maybeBot();
}

// ── bot (greedy one-ply, territory-maximising) ──────────────────────────────
function allMoves(board, color) {
  const res = [];
  for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
    const p = board[r][c].piece;
    if (p && p.color === color) for (const [tr, tc] of legalDest(board, r, c)) res.push({ fr: r, fc: c, tr, tc });
  }
  return res;
}
function botPick(color) {
  const moves = allMoves(state.board, color);
  if (!moves.length) return null;
  const mid = (state.board.length - 1) / 2;
  let best = [], bestVal = -Infinity;
  for (const m of moves) {
    const b = cloneBoard(state.board);
    const cap = !!b[m.tr][m.tc].piece, p = b[m.fr][m.fc].piece;
    b[m.fr][m.fc].piece = null; b[m.tr][m.tc] = { owner: color, piece: p };
    const s = scoreOf(b);
    let v = (color === BLUE ? s.B - s.R : s.R - s.B);
    if (cap) v += 2.2;
    v += 0.05 * (mid - Math.abs(mid - m.tr)) + 0.05 * (mid - Math.abs(mid - m.tc));
    v += Math.random() * 0.25;
    if (v > bestVal) { bestVal = v; best = [m]; } else if (v === bestVal) best.push(m);
  }
  return best[(Math.random() * best.length) | 0];
}
function maybeBot() {
  if (!botTurn() || state.gameOver || editing) return;
  state.thinking = true; render();
  setTimeout(() => { state.thinking = false; const m = botPick(cfg.botSide); if (m) doMove(m); else render(); }, 340);
}

// ── DOM build ────────────────────────────────────────────────────────────────
const boardEl = document.getElementById('board');
const $ = (id) => document.getElementById(id);
let slots = [];        // slots[dr][dc] = { btn, rank, file, pcw }
let curSize = 0;

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
function render() {
  const size = curSize;
  let board, lastMove, mode;
  if (editing) { board = editBoard; lastMove = null; mode = 'edit'; }
  else if (isLive()) { board = state.board; lastMove = state.lastMove; mode = canPlay() ? 'play' : 'lock'; }
  else { const d = JSON.parse(positions[viewPly]); board = d.board; lastMove = d.lastMove; mode = 'review'; }

  boardEl.classList.toggle('editing', mode === 'edit');
  boardEl.classList.toggle('review', mode === 'review');

  for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
    const [r, c] = toBoard(dr, dc, size);
    const cell = board[r][c], s = slots[dr][dc];
    let cls = 'sq' + (((r + c) % 2 === 0) ? ' light' : '');
    if (cell.owner === BLUE) cls += ' own-B'; else if (cell.owner === RED) cls += ' own-R';
    if (lastMove && ((lastMove.fr === r && lastMove.fc === c) || (lastMove.tr === r && lastMove.tc === c))) cls += ' last';
    if (mode === 'play') {
      if (state.selected && state.selected.r === r && state.selected.c === c) cls += ' sel';
      if (cfg.hints && state.targets.some(t => t[0] === r && t[1] === c)) cls += cell.piece ? ' target-cap' : ' target';
    }
    if (state.justMovedTo && state.justMovedTo.r === r && state.justMovedTo.c === c && isLive() && !editing) cls += ' pop';
    s.btn.className = cls;
    s.pcw.innerHTML = cell.piece ? glyph(cell.piece.type, cell.piece.color) : '';
    const showR = cfg.coords && dc === 0, showF = cfg.coords && dr === size - 1;
    s.rank.hidden = !showR; if (showR) s.rank.textContent = size - r;
    s.file.hidden = !showF; if (showF) s.file.textContent = fileL(c);
  }
  state.justMovedTo = null;
  renderHUD(board);
}

function renderHUD(board) {
  const s = scoreOf(board), tot = board.length * board.length;
  $('seg-b').style.width = (s.B / tot * 100) + '%';
  $('seg-r').style.width = (s.R / tot * 100) + '%';
  $('seg-n').style.width = (s.open / tot * 100) + '%';
  $('ct-b').textContent = s.B; $('ct-r').textContent = s.R; $('ct-n').textContent = s.open;

  $('turn').classList.toggle('red', state.turn === RED);
  $('turn-label').textContent = state.gameOver ? 'Game over'
    : state.thinking ? (cfg.botSide === RED ? 'Red' : 'Blue') + ' thinking…'
      : (state.turn === BLUE ? 'Blue' : 'Red') + ' to move' + (!isLive() ? ' · reviewing' : '');

  $('nav-prev').disabled = viewPly <= 0;
  $('nav-start').disabled = viewPly <= 0;
  $('nav-next').disabled = viewPly >= liveIndex();
  $('nav-end').disabled = viewPly >= liveIndex();
  $('takeback').disabled = positions.length <= 1 || state.thinking;
  $('ply').textContent = viewPly === 0 ? 'start' : `${viewPly} / ${liveIndex()}`;

  renderLog(); renderBanner(s);
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

function renderBanner(s) {
  const el = $('banner');
  if (!state.gameOver || editing || !isLive()) { el.hidden = true; return; }
  const winner = s.B > s.R ? 'Blue wins' : s.R > s.B ? 'Red wins' : 'Draw';
  const cls = s.B > s.R ? 'tb' : s.R > s.B ? 'tr' : '';
  el.hidden = false;
  el.innerHTML = `<div class="card"><b class="${cls}">${winner}</b><p>Blue ${s.B} · Red ${s.R}${s.open ? ` · ${s.open} open` : ''}</p><button class="btn" id="again-btn">New game</button></div>`;
  $('again-btn').onclick = newGame;
}

// ── interaction ─────────────────────────────────────────────────────────────
boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq'); if (!b) return;
  const [r, c] = toBoard(+b.dataset.dr, +b.dataset.dc, curSize);
  if (editing) return editClick(r, c);
  if (!isLive() || !canPlay()) return;
  if (state.selected && state.targets.some(t => t[0] === r && t[1] === c)) {
    return doMove({ fr: state.selected.r, fc: state.selected.c, tr: r, tc: c });
  }
  const p = state.board[r][c].piece;
  if (p && p.color === state.turn) { state.selected = { r, c }; state.targets = legalDest(state.board, r, c); }
  else { state.selected = null; state.targets = []; }
  render();
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') { if (editing) return cancelEdit(); state.selected = null; state.targets = []; render(); return; }
  if (editing) return;
  if (e.key === 'ArrowLeft') { nav(viewPly - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { nav(viewPly + 1); e.preventDefault(); }
  else if (e.key === 'Home') { nav(0); e.preventDefault(); }
  else if (e.key === 'End') { nav(liveIndex()); e.preventDefault(); }
});

function nav(to) { viewPly = Math.max(0, Math.min(liveIndex(), to)); state.selected = null; state.targets = []; render(); }

function newGame() {
  const size = cfg.size;
  if (curSize !== size) build(size);
  state.board = blocksBoard(size, cfg.perType);
  state.turn = cfg.first;
  state.selected = null; state.targets = []; state.lastMove = null; state.justMovedTo = null;
  state.moves = []; state.passStreak = 0; state.gameOver = false; state.thinking = false;
  settleTurn();
  positions = [snap()]; viewPly = 0;
  render(); maybeBot();
}

function takeback() {
  if (positions.length <= 1) return;
  positions.pop(); loadLive(positions[liveIndex()]);
  // in bot mode, keep stepping back until it is the human's turn again (or the start)
  if (cfg.opponent === 'bot') while (positions.length > 1 && state.turn === cfg.botSide) { positions.pop(); loadLive(positions[liveIndex()]); }
  state.thinking = false; viewPly = liveIndex();
  render();
  if (botTurn() && !state.gameOver) maybeBot();
}

// ── position editor ─────────────────────────────────────────────────────────
function buildPalette() {
  const pal = $('palette'); pal.innerHTML = '';
  const items = [];
  for (const color of [BLUE, RED]) for (const type of ['rock', 'paper', 'scissors']) items.push({ type, color });
  for (const it of items) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pal';
    b.dataset.type = it.type; b.dataset.color = it.color; b.innerHTML = glyph(it.type, it.color);
    b.onclick = () => { tool = { type: it.type, color: it.color }; markTool(); };
    pal.appendChild(b);
  }
  const er = document.createElement('button'); er.type = 'button'; er.className = 'pal erase'; er.textContent = 'erase'; er.dataset.erase = '1';
  er.onclick = () => { tool = 'erase'; markTool(); };
  pal.appendChild(er);
  markTool();
}
function markTool() {
  for (const b of $('palette').children) {
    const on = tool === 'erase' ? b.dataset.erase === '1' : (b.dataset.type === tool.type && b.dataset.color === tool.color);
    b.classList.toggle('on', on);
  }
}
function enterEdit() {
  if (curSize !== cfg.size) build(cfg.size);
  editing = true;
  editBoard = blocksBoard(cfg.size, cfg.perType);
  $('panel').hidden = true; $('editpanel').hidden = false;
  render();
}
function cancelEdit() {
  editing = false; $('editpanel').hidden = true; $('panel').hidden = false;
  if (curSize !== state.board.length) build(state.board.length);
  render();
}
function editClick(r, c) {
  editBoard[r][c] = tool === 'erase' ? { owner: null, piece: null } : { owner: tool.color, piece: { type: tool.type, color: tool.color } };
  render();
}
function startFromEdit() {
  state.board = cloneBoard(editBoard);
  state.turn = cfg.first;
  state.selected = null; state.targets = []; state.lastMove = null; state.justMovedTo = null;
  state.moves = []; state.passStreak = 0; state.gameOver = false; state.thinking = false;
  settleTurn();
  positions = [snap()]; viewPly = 0;
  editing = false; $('editpanel').hidden = true; $('panel').hidden = false;
  render(); maybeBot();
}
$('ed-cancel').onclick = cancelEdit;
$('ed-start').onclick = startFromEdit;
$('ed-clear').onclick = () => { editBoard = emptyBoard(cfg.size); render(); };
$('ed-blocks').onclick = () => { editBoard = blocksBoard(cfg.size, cfg.perType); render(); };
$('ed-mirror').onclick = () => {
  const S = editBoard.length;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (editBoard[r][c].piece && editBoard[r][c].piece.color === RED) editBoard[r][c] = { owner: null, piece: null };
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
    const p = editBoard[r][c].piece;
    if (p && p.color === BLUE) { const rr = S - 1 - r, cc = S - 1 - c; if (!(editBoard[rr][cc].piece && editBoard[rr][cc].piece.color === BLUE)) editBoard[rr][cc] = { owner: RED, piece: { type: p.type, color: RED } }; }
  }
  render();
};

// ── controls ────────────────────────────────────────────────────────────────
$('new-btn').onclick = newGame;
$('takeback').onclick = takeback;
$('nav-prev').onclick = () => nav(viewPly - 1);
$('nav-next').onclick = () => nav(viewPly + 1);
$('nav-start').onclick = () => nav(0);
$('nav-end').onclick = () => nav(liveIndex());
$('help-btn').onclick = () => $('rules').showModal();
$('flip-btn').onclick = () => { flipped = !flipped; localStorage.setItem('janken-flip', flipped ? '1' : '0'); render(); };

$('copy-btn').onclick = async () => {
  const rows = []; let cur = null;
  for (const m of state.moves) { if (m.c === BLUE) { cur = [rows.length + 1, m.t, '']; rows.push(cur); } else { if (!cur) { cur = [rows.length + 1, '', '']; rows.push(cur); } cur[2] = m.t; } }
  const text = `JANKEN ${curSize}×${curSize}\n` + rows.map(r => `${r[0]}. ${r[1]}${r[2] ? '   ' + r[2] : ''}`).join('\n');
  try { await navigator.clipboard.writeText(text); const b = $('copy-btn'); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); } catch { }
};

// theme
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#17171b' : '#f3f3f0');
  localStorage.setItem('janken-theme', t);
}
$('theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// settings dialog
const dlg = $('settings');
function fillForm() {
  $('s-size').value = cfg.size; $('s-size-v').textContent = `${cfg.size}×${cfg.size}`;
  $('s-per').value = cfg.perType; $('s-per-v').textContent = cfg.perType;
  $('s-opp').value = cfg.opponent; $('s-botside').value = cfg.botSide;
  $('s-first').value = cfg.first; $('s-cap').value = cfg.capture;
  $('s-coords').checked = cfg.coords; $('s-hints').checked = cfg.hints;
  $('s-botside-row').style.display = cfg.opponent === 'bot' ? '' : 'none';
}
function readForm() {
  cfg.size = +$('s-size').value; cfg.perType = +$('s-per').value;
  cfg.opponent = $('s-opp').value; cfg.botSide = $('s-botside').value;
  cfg.first = $('s-first').value; cfg.capture = $('s-cap').value;
  cfg.coords = $('s-coords').checked; cfg.hints = $('s-hints').checked;
  saveCfg();
}
$('settings-btn').onclick = () => { fillForm(); dlg.showModal(); };
$('s-size').oninput = () => $('s-size-v').textContent = `${$('s-size').value}×${$('s-size').value}`;
$('s-per').oninput = () => $('s-per-v').textContent = $('s-per').value;
$('s-opp').onchange = () => $('s-botside-row').style.display = $('s-opp').value === 'bot' ? '' : 'none';
$('s-setup').onclick = () => { readForm(); dlg.close('setup'); enterEdit(); };
dlg.addEventListener('close', () => { if (dlg.returnValue === 'apply') { readForm(); newGame(); } });

// ── boot ────────────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('janken-theme') || 'dark');
document.querySelectorAll('.lg .glyph').forEach(g => g.innerHTML = glyph(g.dataset.p, 'B').replace('pc-B', 'pc'));
buildPalette();
build(cfg.size);
newGame();
if (!localStorage.getItem('janken-seen')) { $('rules').showModal(); localStorage.setItem('janken-seen', '1'); }
