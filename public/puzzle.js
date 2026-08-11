// A focused tablebase exercise. It shares the picker with Home and Atlas, but keeps all answer
// hints out of the board until the player asks, so solving feels like playing rather than browsing.
import * as E from './engine.js';
import { glyph, PIECE_STYLE_IDS } from './pieces.js';
import * as TB from './tablebase.js';
import { mountFact } from './facts.js';

const $ = (id) => document.getElementById(id);
const cfg = E.sanitizeCfg(E.PRESETS.skirmish);
const state = {
  oracle: null,
  puzzle: null,
  board: null,
  selected: null,
  targets: [],
  feedback: '',
  revealed: false,
};

const prefs = (() => {
  try { return JSON.parse(localStorage.getItem('janken-cfg') || '{}') || {}; } catch { return {}; }
})();
const pieceStyle = PIECE_STYLE_IDS.includes(prefs.pieceStyle) ? prefs.pieceStyle : 'sprite';
const pieceGlyph = (type, color) => glyph(type, color, pieceStyle);

const puzzleStore = () => {
  try { return JSON.parse(localStorage.getItem('janken-puzzle') || '{}') || {}; } catch { return {}; }
};
const savePuzzle = (data) => {
  try { localStorage.setItem('janken-puzzle', JSON.stringify(data)); } catch { /* storage is optional */ }
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]').setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
  try { localStorage.setItem('janken-theme', theme); } catch { /* storage is optional */ }
}

function setFeedback(message, kind = '') {
  state.feedback = message;
  const toast = $('puzzle-toast');
  toast.hidden = !message;
  toast.textContent = message;
  toast.className = `puzzle-toast${kind ? ` ${kind}` : ''}`;
}

function resetSelection() {
  state.selected = null;
  state.targets = [];
}

function movesForPosition() {
  if (!state.puzzle || !state.board) return [];
  return TB.rankMoves(TB.movesFrom(state.oracle.table, state.board, state.puzzle.turn, cfg));
}

function loadPuzzle(kind) {
  const puzzle = kind === 'daily'
    ? TB.dailyPuzzle(state.oracle.table, cfg, state.oracle.id)
    : TB.findPuzzle(state.oracle.table, cfg, TB.rngFrom((Math.random() * 0xffffffff) >>> 0));
  if (!puzzle) {
    $('puzzle-prompt').textContent = 'No puzzle available';
    $('puzzle-note').textContent = 'The tablebase did not find a suitable exercise. Please try another.';
    return;
  }
  state.puzzle = { ...puzzle, kind, done: false };
  state.board = E.cloneBoard(puzzle.board);
  state.revealed = false;
  resetSelection();
  setFeedback('');
  render();
}

function recordDailySuccess() {
  if (state.puzzle.kind !== 'daily') return;
  const today = TB.puzzleDay();
  const saved = puzzleStore();
  if (saved.day === today) return;
  const streak = (saved.streak || 0) + 1;
  savePuzzle({ day: today, streak, best: Math.max(streak, saved.best || 0) });
}

function attempt(move) {
  if (state.puzzle.done) return;
  const correct = state.puzzle.best.some((best) => best.fr === move.fr && best.fc === move.fc
    && best.tr === move.tr && best.tc === move.tc);
  if (!correct) {
    resetSelection();
    setFeedback('Not quite — that gives the win away. Try again.', 'wrong');
    render();
    return;
  }
  state.board = move.board;
  state.puzzle.done = true;
  resetSelection();
  recordDailySuccess();
  setFeedback('Correct ✦ The win survives.', 'right');
  render();
}

function clickSquare(row, col) {
  if (!state.puzzle || state.puzzle.done) return;
  const target = state.targets.find((move) => move.tr === row && move.tc === col);
  if (target) { attempt(target); return; }
  const piece = state.board[row][col].piece;
  if (piece?.color !== state.puzzle.turn) { resetSelection(); render(); return; }
  state.selected = { row, col };
  state.targets = movesForPosition().filter((move) => move.fr === row && move.fc === col);
  render();
}

function renderBoard() {
  const board = $('puzzle-board');
  board.innerHTML = '';
  if (!state.board) return;
  const targetKeys = new Set(state.targets.map((move) => `${move.tr}:${move.tc}`));
  for (let row = 0; row < TB.SIZE; row++) for (let col = 0; col < TB.SIZE; col++) {
    const cell = state.board[row][col];
    const piece = cell.piece;
    const selected = state.selected?.row === row && state.selected?.col === col;
    const target = targetKeys.has(`${row}:${col}`);
    const square = E.sqName(row, col, TB.SIZE);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pz-sq ${(row + col) % 2 ? 'dark' : 'light'}${selected ? ' selected' : ''}`
      + `${target ? (piece ? ' target capture' : ' target') : ''}`;
    button.disabled = state.puzzle.done;
    button.setAttribute('aria-label', piece
      ? `${piece.color === E.BLUE ? 'Blue' : 'Red'} ${piece.type} on ${square}`
      : `Empty ${square}`);
    if (piece) button.innerHTML = pieceGlyph(piece.type, piece.color);
    button.addEventListener('click', () => clickSquare(row, col));
    board.appendChild(button);
  }
}

function render() {
  const puzzle = state.puzzle;
  if (!puzzle) return;
  const store = puzzleStore();
  const side = puzzle.turn === E.BLUE ? 'Blue' : 'Red';
  $('puzzle-tag').textContent = puzzle.kind === 'daily' ? `daily · ${TB.puzzleDay()}` : 'random';
  $('puzzle-streak').textContent = store.streak
    ? `streak ${store.streak}${store.best > store.streak ? ` · best ${store.best}` : ''}`
    : '';
  $('puzzle-prompt').textContent = `${side} to play and win in ${puzzle.dtm}`;
  $('puzzle-note').textContent = puzzle.done
    ? 'That move preserves the tablebase win. Pick another puzzle when you are ready.'
    : `${puzzle.legal} legal moves · ${puzzle.best.length === 1 ? 'one keeps' : `${puzzle.best.length} keep`} the win.`;
  $('puzzle-reveal').textContent = state.revealed ? 'move shown' : 'show the move';
  $('puzzle-reveal').disabled = puzzle.done || state.revealed;
  renderBoard();
}

function reveal() {
  if (!state.puzzle || state.puzzle.done || state.revealed) return;
  state.revealed = true;
  const names = state.puzzle.best.map((move) => move.san).join(', ');
  setFeedback(`Winning move${state.puzzle.best.length === 1 ? '' : 's'}: ${names}.`, 'shown');
  render();
}

async function boot() {
  applyTheme(localStorage.getItem('janken-theme') || 'dark');
  $('theme-btn').addEventListener('click', () => applyTheme(
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
  ));
  $('puzzle-daily').addEventListener('click', () => loadPuzzle('daily'));
  $('puzzle-next').addEventListener('click', () => loadPuzzle('random'));
  $('puzzle-reveal').addEventListener('click', reveal);
  mountFact($('dyk'));
  try {
    state.oracle = await TB.oracleFor(cfg);
    if (!state.oracle) throw new Error('Skirmish tablebase is unavailable');
    loadPuzzle('daily');
  } catch {
    $('puzzle-prompt').textContent = 'The puzzle is taking a breather';
    $('puzzle-note').textContent = 'The solved tablebase could not be loaded. Please try again shortly.';
  }
}

boot();
