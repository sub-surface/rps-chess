// Homepage "variant theatre": replays real games of the variant currently on show, and falls
// back to a deterministic bot game under those exact rules when the feed has none. Loaded lazily
// from game.js, which is also the only thing that tells it which variant is on show.
//
// The recent-game feed is fetched once per visit and never on a restart: switching variants is a
// filter over what is already in hand plus a locally simulated game, so dragging a slider costs
// no network at all.
import * as E from './engine.js';

const $ = (id) => document.getElementById(id);
const PIECE_LETTER = { rock: 'R', paper: 'P', scissors: 'S' };

const seeded = (initial) => {
  let seed = initial >>> 0;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
};

// Two configs describe the same variant when every rules field agrees. Comparing the sanitized
// objects rather than a preset name keeps a Custom ruleset matchable too, which is the case that
// actually needs it: a dragged slider is Custom by definition.
const RULES_FIELDS = [
  'size', 'perType', 'rockMove', 'paperMove', 'scissorsMove', 'capture', 'forcedCapture',
  'territory', 'retread', 'trail', 'enclosure', 'threefold', 'layout', 'actionsPerTurn', 'first',
];
const rulesKey = (cfg) => {
  const safe = E.sanitizeCfg(cfg);
  return RULES_FIELDS.map((field) => String(safe[field])).join('|');
};

function botGame(rawCfg, seed, title) {
  const cfg = E.sanitizeCfg(rawCfg);
  const random = seeded(seed);
  const board = E.blocksBoard(cfg.size, cfg.perType, cfg.layout, random);
  const game = E.newGame(cfg, board);
  game.startedAt = Date.now();
  for (let ply = 0; !game.gameOver && ply < 220; ply++) {
    const moves = E.allMoves(game.board, game.turn, cfg);
    if (!moves.length) break;
    // A small tactical preference keeps the sample legible without making startup
    // pay for a search tree: captures, fresh territory, then centralisation.
    const ranked = moves.map((move) => {
      const target = game.board[move.tr][move.tc];
      const capture = E.captureTarget(game.board, move, cfg) ? 100 : 0;
      const territory = cfg.territory && target.owner === null ? 16 : 0;
      const centre = (cfg.size - 1) / 2;
      const central = cfg.size - (Math.abs(move.tr - centre) + Math.abs(move.tc - centre));
      return { move, score: capture + territory + central + random() * 8 };
    }).sort((a, b) => b.score - a.score);
    const choice = ranked[Math.floor(random() * Math.min(3, ranked.length))].move;
    E.applyMove(game, choice);
  }
  return {
    id: `bot-${seed}`,
    cfg,
    startPos: game.startPos,
    startOwners: game.startOwners,
    moves: game.moves,
    names: { B: 'Blue bot', R: 'Red bot' },
    variant: title || E.variantLabel(cfg),
    source: 'bot',
  };
}

function snapshots(record, limit = 64) {
  const cfg = E.sanitizeCfg(record.cfg);
  const pieces = E.decodePos(record.startPos || record.pos, cfg.size);
  const board = pieces && E.decodeOwners(record.startOwners || record.own, pieces);
  if (!board) return [];
  const game = E.newGame(cfg, board);
  const all = [{ board: E.cloneBoard(game.board), lastMove: null }];
  for (const recorded of record.moves || []) {
    const move = {
      fr: recorded.from?.[0],
      fc: recorded.from?.[1],
      tr: recorded.to?.[0],
      tc: recorded.to?.[1],
    };
    if (game.gameOver || !E.isLegal(game.board, move, game.turn, cfg)) break;
    E.applyMove(game, move);
    all.push({ board: E.cloneBoard(game.board), lastMove: { ...game.lastMove } });
  }
  if (all.length <= limit) return all;
  const sampled = [all[0]];
  const stride = (all.length - 1) / (limit - 1);
  for (let index = 1; index < limit - 1; index++) sampled.push(all[Math.round(index * stride)]);
  sampled.push(all.at(-1));
  return sampled;
}

function miniGlyph(piece, x, y, cell) {
  const colour = piece.color === E.BLUE ? 'sc-B' : 'sc-R';
  const cx = x + cell / 2, cy = y + cell / 2, r = cell * 0.24;
  if (piece.type === 'rock') {
    return `<path class="sc-piece ${colour}" d="M${cx-r},${cy+r*.3} L${cx-r*.55},${cy-r*.65} L${cx},${cy-r} L${cx+r*.8},${cy-r*.35} L${cx+r},${cy+r*.55} L${cx+r*.35},${cy+r} L${cx-r*.55},${cy+r*.9} Z"/>`;
  }
  if (piece.type === 'paper') {
    return `<g class="sc-piece ${colour}" fill="none"><rect x="${cx-r*.7}" y="${cy-r}" width="${r*1.4}" height="${r*2}"/><path d="M${cx-r*.42},${cy-r*.25} H${cx+r*.42} M${cx-r*.42},${cy+r*.25} H${cx+r*.42}"/></g>`;
  }
  return `<g class="sc-piece ${colour}" fill="none"><path d="M${cx-r*.7},${cy-r} L${cx+r*.3},${cy+r*.25} M${cx+r*.7},${cy-r} L${cx-r*.3},${cy+r*.25}"/><circle cx="${cx-r*.42}" cy="${cy+r*.62}" r="${r*.3}"/><circle cx="${cx+r*.42}" cy="${cy+r*.62}" r="${r*.3}"/></g>`;
}

function renderSnapshot(snapshot) {
  const board = snapshot.board;
  const size = board.length;
  const cell = 180 / size;
  const squares = [];
  const pieces = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const square = board[row][col];
    const classes = ['sc-square', (row + col) % 2 ? 'dark' : 'light'];
    if (square.owner) classes.push(`own-${square.owner}`);
    if (snapshot.lastMove
      && ((snapshot.lastMove.fr === row && snapshot.lastMove.fc === col)
        || (snapshot.lastMove.tr === row && snapshot.lastMove.tc === col))) classes.push('last');
    const x = col * cell, y = row * cell;
    squares.push(`<rect class="${classes.join(' ')}" x="${x}" y="${y}" width="${cell}" height="${cell}"/>`);
    if (square.piece) pieces.push(miniGlyph(square.piece, x, y, cell));
  }
  const grid = [];
  for (let index = 0; index <= size; index++) {
    const at = index * cell;
    grid.push(`M${at},0 V180 M0,${at} H180`);
  }
  $('showcase-board').innerHTML = `${squares.join('')}<path class="sc-grid" d="${grid.join(' ')}"/>${pieces.join('')}`;
}

function fallbackGames() {
  const day = Math.floor(Date.now() / 86_400_000);
  const random = seeded(day ^ 0x51a7cafe);
  const movementPool = [...E.MOVEMENT_TYPES];
  for (let index = movementPool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [movementPool[index], movementPool[swap]] = [movementPool[swap], movementPool[index]];
  }
  const lab = E.sanitizeCfg({
    ...E.PRESETS.standard,
    rockMove: movementPool[0],
    paperMove: movementPool[1],
    scissorsMove: movementPool[2],
    actionsPerTurn: random() > 0.58 ? 2 : 1,
    layout: random() > 0.68 ? 'corners' : 'rows',
  });
  return [
    botGame(E.PRESETS.standard, 0x5eed, 'Standard · all kings'),
    botGame(E.PRESETS.kings, 0xc0ffee, "King's Field · rook / knight / bishop"),
    botGame(lab, day ^ 0xdecafbad, `Daily lab · ${E.movementLabel(lab)}`),
  ];
}

// A stable seed per ruleset, so hovering away from a variant and back shows the same game
// rather than a fresh one every pass.
const seedFor = (key) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  return hash >>> 0;
};

// What to play for a given ruleset: real games of it first, then one bot game under exactly
// those rules. `null` means no variant has been named yet, which is the mixed opening programme.
function programmeFor(cfg, recent) {
  if (!cfg) {
    const bots = fallbackGames();
    const feed = recent.slice(0, 2);
    if (!feed.length) return bots;
    return feed.length > 1 ? [feed[0], bots[0], feed[1], bots[1], bots[2]] : [feed[0], ...bots];
  }
  const key = rulesKey(cfg);
  const matching = recent.filter((game) => rulesKey(game.cfg) === key).slice(0, 3);
  const label = E.presetLabel(E.presetOf(cfg));
  const filler = botGame(cfg, seedFor(key), `${label} · ${E.variantLabel(cfg)}`);
  return [...matching, filler];
}

// Replaying a record is the expensive part, so each one is simulated once and its
// frames cached on the record — the replayability filter and playback share the result.
const framesFor = (record) => (record.frames || (record.frames = snapshots(record)));

// The variant on show, and the one hook the page has into this module. `showcaseVariant()` may
// be called before the theatre exists — the request is simply remembered and honoured on start,
// which is what makes a hover during first paint behave the same as one a second later.
let wanted = null;
let restart = null;
let restartTimer = null;
export function showcaseVariant(cfg) {
  const next = cfg ? E.sanitizeCfg(cfg) : null;
  if (rulesKey(wanted || {}) === rulesKey(next || {}) && !!wanted === !!next) return;
  wanted = next;
  if (!restart) return;
  // One debounce, shared by every caller: a dragged slider fires this on every tick and must
  // still start exactly one game.
  const root = $('showcase');
  if (root) root.dataset.restarting = '1';
  clearTimeout(restartTimer);
  restartTimer = setTimeout(restart, 260);
}

export async function initShowcase() {
  const root = $('showcase');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  let recent = [];
  let records = programmeFor(wanted, recent);
  let recordIndex = 0;
  let frames = framesFor(records[0]);
  let frameIndex = 0;
  let timer = null;
  let manuallyPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let inView = true;

  const updateCaption = () => {
    const record = records[recordIndex];
    const names = record.names || {};
    $('showcase-players').textContent = `${names.B || 'Blue'} · ${names.R || 'Red'}`;
    $('showcase-variant').textContent = `${record.source === 'bot' ? 'bot variation' : 'recent game'} · ${record.variant || E.variantLabel(record.cfg)}`;
  };
  const updateToggle = () => {
    const paused = manuallyPaused;
    $('showcase-toggle').textContent = paused ? '▷' : 'Ⅱ';
    $('showcase-toggle').setAttribute('aria-label', paused ? 'Play replay' : 'Pause replay');
    $('showcase-toggle').title = paused ? 'Play replay' : 'Pause replay';
  };
  const active = () => !manuallyPaused && inView && !document.hidden
    && document.body.dataset.screen === 'home';
  const schedule = (delay = 440) => {
    clearTimeout(timer);
    if (active()) timer = setTimeout(advance, delay);
  };
  const selectRecord = (index, guard = 0) => {
    recordIndex = (index + records.length) % records.length;
    frames = framesFor(records[recordIndex]);
    frameIndex = 0;
    // A programme of unreplayable records would otherwise recurse for ever.
    if (!frames.length && guard < records.length) return selectRecord(recordIndex + 1, guard + 1);
    updateCaption();
    if (frames.length) renderSnapshot(frames[0]);
  };
  // Every ruleset change restarts the theatre rather than mutating a game in flight: a board
  // that changed size mid-replay would be showing a position that never existed.
  restart = () => {
    records = programmeFor(wanted, recent);
    root.dataset.restarting = '';
    selectRecord(0);
    schedule(500);
  };
  const advance = () => {
    if (!active()) return;
    if (frameIndex + 1 < frames.length) {
      frameIndex++;
      renderSnapshot(frames[frameIndex]);
      schedule();
    } else {
      selectRecord(recordIndex + 1);
      schedule(1500);
    }
  };

  $('showcase-toggle').onclick = () => {
    manuallyPaused = !manuallyPaused;
    updateToggle();
    if (active()) schedule(100);
    else clearTimeout(timer);
  };
  document.addEventListener('visibilitychange', () => schedule(100));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      inView = !!entry?.isIntersecting;
      schedule(100);
    }, { threshold: 0.1 }).observe(root);
  }

  selectRecord(0);
  updateToggle();
  schedule(600);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('/api/showcase', { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return;
    const body = await response.json();
    recent = Array.isArray(body.games)
      ? body.games.filter((game) => framesFor(game).length > 1)
      : [];
    if (!recent.length) return;
    recent.forEach((game) => { game.source = 'recent'; });
    restart();
  } catch { /* Offline and first-run states simply keep the bot theatre. */ }
}
