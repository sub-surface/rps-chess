// JANKEN bot — one opponent for every ruleset, shared by the browser, the tests and the tuner.
//
// The bot is never told what a variant is worth. It asks the engine: the capture graph comes from
// `captureTarget()`, a piece's worth starts from what it can actually reach on an empty board of
// this size, and the search applies moves with `applyMove()` rather than a copy of it. A rule the
// engine gained yesterday is therefore a rule the bot already plays under — including the ones
// this file has never heard of.
//
// Where a ruleset has been measured, `bot-tuning.js` carries weights that beat the derived ones.
// Where it has not, the derivation stands on its own. That asymmetry is the whole design: tuning
// is an optimisation, never a rule, so an entry that no longer matches any live ruleset is simply
// never found and the bot falls back to what it can work out for itself.
import * as E from './engine.js';
import * as TB from './tablebase.js';
import { TUNING } from './bot-tuning.js';

const TYPES = ['rock', 'paper', 'scissors'];
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const now = () => (typeof performance === 'object' && performance.now ? performance.now() : Date.now());

// A decisive score. Plies are subtracted from it so a win in two beats the same win in six, and
// nothing an evaluation can produce comes close to reaching it.
export const MATE = 1_000_000;
const MAX_DEPTH = 32;
const QUIESCE_DEPTH = 4;

// ── strength ────────────────────────────────────────────────────────────────
// A level is a budget, not a different program: every level runs the same search and the weaker
// ones simply stop sooner and settle for a move near the best rather than the best. `slack` is in
// units of one average piece, so it means the same thing on a board where a piece is worth 100
// points as on one where it is worth 8.
export const DEFAULT_LEVEL = 'normal';
export const LEVEL_INFO = {
  casual: { label: 'Casual', nodes: 600, ms: 45, slack: 0.5 },
  normal: { label: 'Normal', nodes: 9000, ms: 250, slack: 0.08 },
  strong: { label: 'Strong', nodes: 60000, ms: 700, slack: 0 },
  // Perfect is Strong plus the tablebase: on the one board that is solved it stops guessing.
  perfect: { label: 'Perfect', nodes: 60000, ms: 700, slack: 0 },
};
export const LEVELS = Object.keys(LEVEL_INFO);
// A persisted level from a browser that knew other names must still resolve, exactly as a retired
// piece style does.
export const levelOf = (name) => (LEVELS.includes(name) ? name : DEFAULT_LEVEL);

// ── the rules, as a key ─────────────────────────────────────────────────────
// The fields `presetOf()` compares, in its order: two configs with the same fingerprint play the
// same game. `rulesVersion` stays out for the same reason it stays out of `presetOf()` — it is an
// edition, not a variant. The leading tag is the shape of the weight vector, so changing what a
// weight means retires every tuned entry rather than silently reinterpreting it.
export const WEIGHT_SCHEMA = 'b1';
export const RULE_FIELDS = [
  'size', 'perType', 'rockMove', 'paperMove', 'scissorsMove', 'capture', 'forcedCapture',
  'territory', 'retread', 'trail', 'enclosure', 'threefold', 'layout', 'actionsPerTurn', 'first',
];
const fieldText = (value) => (value === true ? '1' : value === false ? '0' : String(value));
export function fingerprintOf(cfg) {
  const safe = E.sanitizeCfg(cfg);
  return `${WEIGHT_SCHEMA}|${RULE_FIELDS.map((field) => fieldText(safe[field])).join('|')}`;
}

// ── what the rules imply ────────────────────────────────────────────────────
// Who takes whom, asked of the engine on a board built for the question. Two squares apart with
// the victim between them is the shape a checkers leap needs; every other capture rule answers on
// adjacent squares. Deriving this means a future capture rule — a fourth type, a longer cycle —
// arrives in the bot's material values without anybody editing them.
export function captureGraph(cfg) {
  const safe = E.sanitizeCfg(cfg);
  const leap = safe.capture === 'checkers';
  const takes = {};
  for (const attacker of TYPES) {
    takes[attacker] = [];
    for (const defender of TYPES) {
      const board = E.emptyBoard(3);
      board[0][0].piece = { type: attacker, color: E.BLUE };
      board[0][1].piece = { type: defender, color: E.RED };
      const move = { fr: 0, fc: 0, tr: 0, tc: leap ? 2 : 1 };
      if (E.captureTarget(board, move, safe)) takes[attacker].push(defender);
    }
  }
  return takes;
}

// The average number of squares a piece of this type can move to with the board to itself. It is
// the one measure of a piece that survives every variant: a knight on a 3×3 is nearly stuck, the
// same knight on a 13×13 is not, and no table of hardcoded piece values knows that.
export function mobilityOf(cfg, type) {
  const safe = E.sanitizeCfg(cfg);
  const board = E.emptyBoard(safe.size);
  let total = 0;
  for (let row = 0; row < safe.size; row++) for (let col = 0; col < safe.size; col++) {
    board[row][col].piece = { type, color: E.BLUE };
    total += E.legalDest(board, row, col, safe).length;
    board[row][col].piece = null;
  }
  return total / (safe.size * safe.size);
}

// Which weights a tuner may move. Anything else in a tuning entry is ignored, so a file written by
// a future tuner cannot reach in and change something this version does not understand.
export const TUNABLE = ['material', 'area', 'mobility', 'center', 'prey'];

const profiles = new Map();

// Everything the bot believes about a ruleset, derived once and cached. Callers hold the result;
// nothing here depends on the position, so a profile is valid for a whole game.
export function profileFor(cfg) {
  const fingerprint = fingerprintOf(cfg);
  const cached = profiles.get(fingerprint);
  if (cached) return cached;
  const safe = E.sanitizeCfg(cfg);
  const takes = captureGraph(safe);
  const eaten = {};
  for (const type of TYPES) eaten[type] = TYPES.filter((other) => takes[other].includes(type));

  // Mobility sets the shape of the material values and the square root flattens it: a queen
  // reaches four times as far as a king but is nothing like four times the piece, because in this
  // game what a piece may take matters more than where it may go.
  const mobility = Object.fromEntries(TYPES.map((type) => [type, mobilityOf(safe, type)]));
  const mean = TYPES.reduce((sum, type) => sum + mobility[type], 0) / TYPES.length || 1;
  const base = Object.fromEntries(TYPES.map((type) =>
    [type, clamp(Math.sqrt(mobility[type] / mean), 0.55, 1.8)]));

  // Two scoreboards, two scales. In elimination a piece is the unit of everything; under
  // territory the unit is a square and a piece is worth roughly the ground it will still paint.
  const territory = safe.territory;
  const weights = {
    material: territory ? 8 : 100,
    area: territory ? 1 : 0,
    mobility: territory ? 0.15 : 1.2,
    center: territory ? 0.4 : 2.5,
    // How much a piece's worth swings with the enemy material it eats and is eaten by. Under
    // chess capture everything takes everything, so the swing is exactly zero and the term
    // switches itself off.
    prey: takes.rock.length === TYPES.length ? 0 : 0.35,
  };

  // A measured entry replaces derived weights field by field, and only where it is a finite
  // number. A malformed or half-written file therefore costs nothing that was already known.
  const tuned = TUNING?.[fingerprint] || null;
  let tunedFields = 0;
  if (tuned && tuned.weights) {
    for (const field of TUNABLE) {
      const value = tuned.weights[field];
      if (typeof value === 'number' && Number.isFinite(value)) { weights[field] = value; tunedFields++; }
    }
  }

  const profile = {
    fingerprint,
    cfg: safe,
    takes,
    eaten,
    mobility,
    base,
    weights,
    // One average piece, in evaluation points: the unit `slack` is quoted in.
    scale: weights.material || 1,
    tuned: tunedFields ? (tuned.label || 'measured') : null,
    // Search costs rise with the board and with any rule that makes legality expensive to ask.
    // Budgets are quoted for a 9×9 and divided by this, so a bigger board searches shallower in
    // roughly the same time rather than freezing the page.
    cost: clamp((safe.size * safe.size) / 81, 0.4, 3) * (safe.forcedCapture ? 1.7 : 1)
      * (safe.territory && safe.enclosure ? 1.4 : 1),
  };
  profiles.set(fingerprint, profile);
  return profile;
}

// ── evaluation ──────────────────────────────────────────────────────────────
// Positive is good for `me`, whoever is to move. Four terms, and every one of them is either the
// scoreboard itself or something the scoreboard is made of.
export function evaluate(game, me, profile, movesForTurn) {
  const board = game.board;
  const safe = profile.cfg;
  const weights = profile.weights;
  const size = board.length;
  const mid = (size - 1) / 2;
  const them = E.other(me);
  const count = { [E.BLUE]: { rock: 0, paper: 0, scissors: 0, all: 0 }, [E.RED]: { rock: 0, paper: 0, scissors: 0, all: 0 } };
  let center = 0;

  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const piece = board[row][col].piece;
    if (!piece) continue;
    const side = count[piece.color];
    side[piece.type]++;
    side.all++;
    // 1 in the middle, 0 in a corner. Centre is worth having in every variant here: it is reach
    // in elimination and it is unpainted ground in territory.
    const central = 1 - (Math.abs(mid - row) + Math.abs(mid - col)) / (2 * mid);
    center += piece.color === me ? central : -central;
  }

  // A piece is worth more when the enemy is full of what it eats and empty of what eats it. This
  // is the one place the RPS cycle enters the evaluation, and it is why a bot playing Azel's wall
  // values the scissors screen differently from the rocks behind it.
  let material = 0;
  for (const side of [me, them]) {
    const enemy = count[E.other(side)];
    const total = enemy.all || 1;
    for (const type of TYPES) {
      if (!count[side][type]) continue;
      let prey = 0, predators = 0;
      for (const victim of profile.takes[type]) prey += enemy[victim];
      for (const hunter of profile.eaten[type]) predators += enemy[hunter];
      const worth = profile.base[type] * (1 + weights.prey * (prey - predators) / total);
      material += (side === me ? 1 : -1) * count[side][type] * worth;
    }
  }

  let score = weights.material * material + weights.center * center;
  if (safe.territory) {
    const painted = E.scoreOf(board);
    score += weights.area * (me === E.BLUE ? painted.B - painted.R : painted.R - painted.B);
  }
  if (weights.mobility) {
    // Being able to move is not a nicety in this game — running out of moves ends it — so both
    // sides are counted, never just the one to move.
    const mine = game.turn === me && movesForTurn
      ? movesForTurn.length
      : E.allMoves(board, me, safe).length;
    const theirs = game.turn === them && movesForTurn
      ? movesForTurn.length
      : E.allMoves(board, them, safe).length;
    score += weights.mobility * (mine - theirs);
  }
  return score;
}

// The game is over: who won is the scoreboard, exactly as the banner reads it. A repetition draw
// is the one ending that ignores the score.
function terminalScore(game, me, ply) {
  if (game.endReason === 'repetition') return 0;
  const res = E.result(game);
  const lead = me === E.BLUE ? res.B - res.R : res.R - res.B;
  if (lead > 0) return MATE - ply;
  if (lead < 0) return -MATE + ply;
  return 0;
}

// ── search ──────────────────────────────────────────────────────────────────
// A node is a real game object, so `applyMove()` does the painting, the enclosing, the multi-action
// turn bookkeeping and the ending. The search never decides any of that for itself.
function cloneGame(game, cfg) {
  return {
    board: E.cloneBoard(game.board),
    cfg,
    turn: game.turn,
    acts: game.acts || 0,
    dry: game.dry || 0,
    moves: [],
    passStreak: 0,
    gameOver: !!game.gameOver,
    endReason: game.endReason || null,
    winner: null,
    lastMove: null,
    // Counts travel down a line so the search can see a threefold coming; a fresh object per node
    // keeps sibling lines from sharing one tally.
    repetitions: cfg.threefold ? { ...(game.repetitions || {}) } : {},
  };
}

const play = (game, move, cfg) => {
  const next = cloneGame(game, cfg);
  E.applyMove(next, move);
  return next;
};

// Ordering is what makes the pruning worth having: the same budget buys two or three more plies
// when the move that refutes a line is tried first. Captures lead, biggest victim first, then the
// two "killer" quiet moves that already cut this ply elsewhere in the tree, then whatever has
// been cutting anywhere (the history table), and finally the moves that land nearer the middle.
const moveIndex = (move, size) => (move.fr * size + move.fc) * size * size + move.tr * size + move.tc;

function order(ctx, game, moves, ply, capturesOnly) {
  const profile = ctx.profile;
  const size = game.board.length;
  const mid = (size - 1) / 2;
  const killers = ctx.killers[ply];
  const scored = [];
  for (const move of moves) {
    const victim = E.captureTarget(game.board, move, profile.cfg);
    if (capturesOnly && !victim) continue;
    const index = moveIndex(move, size);
    let key = victim ? 1e9 + 1e6 * profile.base[victim.piece.type] : 0;
    if (!victim && killers) {
      if (killers[0] === index) key = 9e8;
      else if (killers[1] === index) key = 8e8;
      else key = Math.min(ctx.history[index], 7e8);
    }
    key += 2 - (Math.abs(mid - move.tr) + Math.abs(mid - move.tc)) / (mid || 1);
    scored.push({ move, key, index, victim });
  }
  scored.sort((a, b) => b.key - a.key);
  return scored;
}

// A quiet move that caused a cutoff is worth trying first next time, both at this ply and, more
// weakly, anywhere. Captures are already first, so remembering them would only crowd the table.
function remember(ctx, entry, ply, depth) {
  if (entry.victim) return;
  const killers = ctx.killers[ply] || (ctx.killers[ply] = [-1, -1]);
  if (killers[0] !== entry.index) { killers[1] = killers[0]; killers[0] = entry.index; }
  ctx.history[entry.index] += depth * depth;
}

// Stand pat, then only captures. Without this the bot walks a piece next to something that eats it
// on the last ply it can see, which is the most visible way a shallow search looks stupid. Under a
// capture obligation there is no standing pat: declining is not legal, so the position is searched
// however hopeless it looks.
function quiesce(ctx, game, alpha, beta, ply, depth, moves) {
  if (game.gameOver) return terminalScore(game, ctx.me, ply);
  if (ctx.spend()) return 0;
  ctx.quiet++;
  const cfg = ctx.cfg;
  const legal = moves || E.allMoves(game.board, game.turn, cfg);
  if (!legal.length) return terminalScore(game, ctx.me, ply);
  const maximizing = game.turn === ctx.me;
  const obliged = cfg.forcedCapture && legal.some((move) => E.captureTarget(game.board, move, cfg));
  const stand = evaluate(game, ctx.me, ctx.profile, legal);
  if (depth <= 0) return stand;
  if (!obliged) {
    if (maximizing) { if (stand >= beta) return stand; alpha = Math.max(alpha, stand); }
    else { if (stand <= alpha) return stand; beta = Math.min(beta, stand); }
    // Delta pruning. `swing` is more than any single capture can be worth here, so a node this
    // far outside the window cannot come back into it and its whole capture tree is skipped. On
    // an open territory board that is most of the search.
    if (maximizing ? stand + ctx.swing <= alpha : stand - ctx.swing >= beta) return stand;
  }

  const captures = order(ctx, game, legal, ply, true);
  if (!captures.length) return stand;
  let best = obliged ? (maximizing ? -Infinity : Infinity) : stand;
  for (const entry of captures) {
    const child = play(game, entry.move, cfg);
    const value = quiesce(ctx, child, alpha, beta, ply + 1, depth - 1);
    if (ctx.stopped) return Number.isFinite(best) ? best : stand;
    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

// Alpha-beta over both sides of a turn that does not always alternate: with more than one action
// a turn, the child of a maximizing node is often maximizing too, so the side to move decides the
// direction rather than the parity of the depth.
function search(ctx, game, depth, alpha, beta, ply) {
  if (game.gameOver) return terminalScore(game, ctx.me, ply);
  if (ctx.spend()) return 0;
  const cfg = ctx.cfg;
  const moves = E.allMoves(game.board, game.turn, cfg);
  if (!moves.length) return terminalScore(game, ctx.me, ply);
  if (depth <= 0) return quiesce(ctx, game, alpha, beta, ply, QUIESCE_DEPTH, moves);

  const maximizing = game.turn === ctx.me;
  let best = maximizing ? -Infinity : Infinity;
  for (const entry of order(ctx, game, moves, ply, false)) {
    const child = play(game, entry.move, cfg);
    const value = search(ctx, child, depth - 1, alpha, beta, ply + 1);
    if (ctx.stopped) return Number.isFinite(best) ? best : value;
    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) { remember(ctx, entry, ply, depth); break; }
  }
  return best;
}

// Iterative deepening: play the best move of the deepest iteration that finished. Depth is never
// chosen in advance, which is what lets one budget cover a 3×3 skirmish and a 13×13 campaign.
export function searchRoot(game, options = {}) {
  const cfg = E.sanitizeCfg(game.cfg);
  const profile = options.profile || profileFor(cfg);
  const level = LEVEL_INFO[levelOf(options.level)];
  const root = cloneGame(game, cfg);
  const legal = E.allMoves(root.board, root.turn, cfg);
  if (!legal.length) return null;

  // A level's budget is quoted for a 9×9 and divided by what a node costs here; an explicit
  // budget is taken at face value, because a caller measuring the search wants the axis it asked
  // for rather than a corrected one.
  const limit = Math.max(1, options.nodes ?? Math.round(level.nodes / profile.cost));
  const deadline = now() + (options.ms ?? level.ms);
  const cells = cfg.size * cfg.size;
  const ctx = {
    me: root.turn,
    cfg,
    profile,
    nodes: 0,
    quiet: 0,        // how much of the budget went on resolving captures rather than on depth
    stopped: false,
    killers: [],
    history: new Int32Array(cells * cells),
    // An upper bound on what one capture can swing the evaluation by: the best piece on the board
    // plus, under territory, the ground a single move could paint.
    swing: profile.weights.material * 1.8
      + (cfg.territory ? profile.weights.area * (cfg.size + 2) : 0),
    spend() {
      this.nodes++;
      if (this.nodes >= limit) this.stopped = true;
      else if ((this.nodes & 511) === 0 && now() > deadline) this.stopped = true;
      return this.stopped;
    },
  };

  const slack = (options.slack ?? level.slack) * profile.scale;
  let ordered = order(ctx, root, legal, 0, false).map((entry) => entry.move);
  let ranked = ordered.map((move) => ({ move, score: 0 }));
  let depth = 0;
  for (let target = 1; target <= MAX_DEPTH; target++) {
    const iteration = [];
    // The window opens just below the best score so far, so anything still in contention for the
    // slack pick keeps an exact score while hopeless moves are cut.
    let alpha = -Infinity;
    for (const move of ordered) {
      const child = play(root, move, cfg);
      const score = search(ctx, child, target - 1, alpha, Infinity, 1);
      if (ctx.stopped) break;
      iteration.push({ move, score });
      if (score > alpha + slack) alpha = score - slack - 1e-6;
    }
    if (iteration.length !== ordered.length) {
      // The budget ran out part way through. Only fully searched moves were kept, so if this was
      // the first iteration they are still worth more than the generated order — a tiny budget on
      // a wide board should play the best of what it managed to look at, not a coin toss.
      if (!depth && iteration.length) {
        iteration.sort((a, b) => b.score - a.score);
        ranked = iteration;
      }
      break;
    }
    iteration.sort((a, b) => b.score - a.score);
    ranked = iteration;
    ordered = iteration.map((entry) => entry.move);
    depth = target;
    if (ctx.stopped) break;
    if (Math.abs(ranked[0].score) > MATE - 1000) break;   // solved; deeper cannot improve on it
  }

  return { ranked, depth, nodes: ctx.nodes, quiet: ctx.quiet, profile, slack };
}

// ── the decision ────────────────────────────────────────────────────────────
const pick = (list, random) => list[Math.min(list.length - 1, (random() * list.length) | 0)];

// The move the bot plays, and how it came by it. `oracle` is a loaded tablebase for these exact
// rules when one exists, which is the only way any level plays a move it can prove.
export function chooseMove(game, options = {}) {
  const cfg = E.sanitizeCfg(game.cfg);
  const random = options.random || Math.random;
  const level = levelOf(options.level);
  if (game.gameOver) return null;
  const legal = E.allMoves(game.board, game.turn, cfg);
  if (!legal.length) return null;

  if (level === 'perfect' && options.oracle?.table) {
    const table = options.oracle.table;
    const top = TB.topMoves(TB.rankMoves(TB.movesFrom(table, game.board, game.turn, cfg)));
    if (top.length) {
      const chosen = pick(top, random);
      return {
        move: { fr: chosen.fr, fc: chosen.fc, tr: chosen.tr, tc: chosen.tc },
        source: 'tablebase',
        depth: Infinity,
        nodes: 0,
        score: chosen.after ? -chosen.after.value : 0,
      };
    }
  }
  if (legal.length === 1) return { move: legal[0], source: 'forced', depth: 0, nodes: 0, score: 0 };

  const result = searchRoot(game, { ...options, level });
  if (!result || !result.ranked.length) return null;
  const best = result.ranked[0].score;
  // Equal-scoring moves are chosen between at random so a rematch is not the same game twice; a
  // weaker level widens that band until it is settling for good enough rather than best.
  const candidates = result.ranked.filter((entry) => entry.score >= best - result.slack);
  const chosen = pick(candidates, random);
  return {
    move: chosen.move,
    source: 'search',
    depth: result.depth,
    nodes: result.nodes,
    score: chosen.score,
    considered: candidates.length,
  };
}
