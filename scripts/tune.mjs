// Measures how well the bot plays, tunes it where measuring says it can be better, and writes
// both answers out: public/bot-tuning.js (weights the bot loads) and public/atlas/bots.json (the
// figures /atlas prints).
//
//   node scripts/tune.mjs                       # the committed run
//   node scripts/tune.mjs --variants standard,painters
//   node scripts/tune.mjs --no-tune             # measure only, leave the weights alone
//   node scripts/tune.mjs --positions 200 --reference 40000 --games 16
//
// One idea runs through the whole file: **grade a move against a better opinion of the same
// position**. On the 3×3 that better opinion is the solved table, so the grade is exact and a
// mistake is a mistake. Everywhere else it is the same search given thirty times the budget, so
// the grade is an opinion — a good one, and the only one available on a 13×13 board. Both produce
// the same number, a *regret*: how much worse the move played was than the best one available.
// The 3×3 row is where the two meet, which is what makes the rest of the ladder readable.
//
// Deterministic: same seeds, same bytes, no timestamps. A run that changes the output without a
// rules or bot change means something drifted, which is worth noticing rather than committing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as E from '../public/engine.js';
import * as TB from '../public/tablebase.js';
import * as L from '../public/lab.js';
import * as Bot from '../public/bot.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const flag = (name) => process.argv.includes(`--${name}`);
const argument = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const number = (name, fallback) => Number(argument(name, fallback));

const SEED = number('seed', 0x7ab1e5ee);
const POSITIONS = number('positions', 100);
// The reference must be far deeper than anything it grades or it cannot see the mistakes: a judge
// that is only one ply wiser than the defendant finds nobody guilty.
const REFERENCE = number('reference', 25000);
// The solved board is cheap to grade, so it is sampled hard — its interval is the one figure here
// that is a fact about the game rather than about a search.
const TRUTH_POSITIONS = number('truth', 400);
const GAMES = number('games', 12);
const PLY_CAP = number('plycap', 200);
const TUNE_BUDGET = number('tunebudget', 1200);
// A ×4 ladder. The bottom rung barely finishes one ply on a big board; the top is roughly what the
// Normal level gets through in its slice of a move.
const RUNGS = argument('rungs', '100,400,1600,6400').split(',').map(Number);
const SIZES = argument('sizes', '3,5,7,9').split(',').map(Number);
const TUNE_LIST = argument('variants', 'standard,painters,kings,azel').split(',');

const pct = (value) => `${(100 * value).toFixed(1)}%`;
const mean = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
// A mean with a 95% interval. Regret is not a proportion, so Wilson does not apply to it.
function meanCi(list) {
  const m = mean(list);
  if (list.length < 2) return { mean: m, lo: m, hi: m, n: list.length };
  const variance = list.reduce((sum, value) => sum + (value - m) ** 2, 0) / (list.length - 1);
  const half = 1.96 * Math.sqrt(variance / list.length);
  return { mean: m, lo: m - half, hi: m + half, n: list.length };
}
const round = (value, places = 4) => Number(value.toFixed(places));

// ── players ─────────────────────────────────────────────────────────────────
// A player is a budget plus, optionally, a weight vector to try. Everything is node-limited and
// never clock-limited: a measurement that moves with the machine it ran on is not a measurement.
const player = (nodes, weights = null) => ({ nodes, weights });

function profileWith(cfg, weights) {
  const profile = Bot.profileFor(cfg);
  if (!weights) return profile;
  return { ...profile, weights: { ...profile.weights, ...weights }, scale: weights.material ?? profile.scale };
}

const askFor = (game, who, random) => Bot.chooseMove(game, {
  level: 'strong',
  nodes: who.nodes,
  ms: Infinity,
  slack: 0,
  random,
  profile: profileWith(game.cfg, who.weights),
});

// ── sample positions ────────────────────────────────────────────────────────
// Positions a game actually reaches, not positions a random generator can describe. Both sides
// play weakly and variously — a small budget with a wide slack — and the walk is snapshotted at
// intervals, so the set spans openings, middlegames and endings without being hand-picked.
function samplePositions(cfg, count, seed) {
  const safe = E.sanitizeCfg(cfg);
  const out = [];
  let game = null;
  let random = null;
  let plies = 0;
  for (let attempt = 0; out.length < count && attempt < count * 400; attempt++) {
    if (!game || game.gameOver || plies > PLY_CAP) {
      random = TB.rngFrom(TB.seedFrom(`${seed}:${out.length}:${attempt}`));
      game = E.newGame(safe, safe.layout === 'scattered'
        ? E.blocksBoard(safe.size, safe.perType, safe.layout, random)
        : undefined);
      plies = 0;
    }
    const legal = E.allMoves(game.board, game.turn, safe);
    if (!legal.length) { game = null; continue; }
    // Every third position is kept, once the opening is behind us and there is a real choice.
    if (plies >= 2 && legal.length > 1 && attempt % 3 === 0) {
      out.push({ board: E.cloneBoard(game.board), turn: game.turn, ply: plies });
    }
    const pick = Bot.chooseMove(game, {
      level: 'casual', nodes: 250, ms: Infinity, slack: 0.9, random,
    });
    if (!pick) { game = null; continue; }
    E.applyMove(game, pick.move);
    plies++;
  }
  return out;
}

const gameAt = (cfg, position) => ({
  board: E.cloneBoard(position.board),
  cfg,
  turn: position.turn,
  acts: 0,
  dry: 0,
  moves: [],
  passStreak: 0,
  gameOver: false,
  endReason: null,
  repetitions: {},
});

const sameMove = (a, b) => a.fr === b.fr && a.fc === b.fc && a.tr === b.tr && a.tc === b.tc;

// ── the two references ──────────────────────────────────────────────────────
// A deep search's whole ranking, kept so that every candidate can be graded against it without
// searching again. This is what makes tuning affordable: the expensive opinion is bought once.
function deepReference(cfg, position) {
  const result = Bot.searchRoot(gameAt(cfg, position), { nodes: REFERENCE, ms: Infinity, slack: 0 });
  if (!result || result.ranked.length < 2) return null;
  const scale = result.profile.scale || 1;
  const best = result.ranked[0].score;
  const worst = result.ranked[result.ranked.length - 1].score;
  // A position where every move is as good as every other grades every player at zero and says
  // nothing. Only positions with something to get wrong are kept, and the method block says how
  // many were dropped — a bot's accuracy means nothing without knowing what it was asked.
  if ((best - worst) / scale < 0.5) return null;
  return {
    best,
    scale,
    // Regret in pieces: how far short of the best move this one falls, in units of one average
    // piece, so a 3×3 and a 13×13 row can sit in the same column.
    regretOf(move) {
      const found = result.ranked.find((entry) => sameMove(entry.move, move));
      return found ? Math.min(4, (best - found.score) / scale) : 4;
    },
    isBest(move) {
      const found = result.ranked.find((entry) => sameMove(entry.move, move));
      return !!found && found.score >= best - 1e-9;
    },
  };
}

// The same grade, from the solved table instead of an opinion: a move either holds the game's
// theoretical value or throws part of it away, and the cost of throwing it away is exactly one
// step down the win/draw/loss ladder.
function tableReference(table, cfg, position) {
  const verdict = TB.probe(table, position.board, position.turn);
  if (!verdict) return null;
  const moves = TB.movesFrom(table, position.board, position.turn, cfg);
  if (moves.length < 2) return null;
  const best = Math.max(...moves.map(TB.moverValue));
  const top = TB.topMoves(TB.rankMoves(moves));
  const holding = moves.filter((move) => TB.moverValue(move) === best).length;
  // Same rule as the deep reference: if no legal move throws anything away, there is nothing here
  // to be right about.
  if (holding === moves.length) return null;
  return {
    best,
    legal: moves.length,
    // What a mover picking uniformly at random would score here — exact, not sampled, and the
    // only honest floor to read a bot's agreement against.
    randomHolds: holding / moves.length,
    randomBest: top.length / moves.length,
    regretOf(move) {
      const found = moves.find((entry) => sameMove(entry, move));
      return found ? (best - TB.moverValue(found)) / 2 : 1;   // 1 = win thrown to a loss
    },
    holds(move) {
      const found = moves.find((entry) => sameMove(entry, move));
      return !!found && TB.moverValue(found) === best;
    },
    isBest: (move) => top.some((entry) => sameMove(entry, move)),
  };
}

// ── grading ─────────────────────────────────────────────────────────────────
function gradeAgainst(cfg, positions, references, who, seed) {
  const regrets = [];
  let best = 0, blunders = 0, nodes = 0, depth = 0, graded = 0;
  positions.forEach((position, index) => {
    const reference = references[index];
    if (!reference) return;
    const random = TB.rngFrom(TB.seedFrom(`${seed}:grade:${index}`));
    const pick = askFor(gameAt(cfg, position), who, random);
    if (!pick) return;
    const regret = reference.regretOf(pick.move);
    regrets.push(regret);
    if (reference.isBest(pick.move)) best++;
    if (regret >= 0.5) blunders++;
    nodes += pick.nodes;
    depth += pick.depth === Infinity ? 0 : pick.depth;
    graded++;
  });
  const n = graded || 1;
  return {
    graded,
    regret: meanCi(regrets),
    best: L.wilson(best, n),
    blunder: L.wilson(blunders, n),
    meanNodes: Math.round(nodes / n),
    meanDepth: round(depth / n, 2),
  };
}

// ── head-to-head ────────────────────────────────────────────────────────────
// The check that keeps tuning honest: a weight vector that grades better must also win games, or
// it has only learned to agree with the reference.
function match(cfg, a, b, { games = GAMES, seed = SEED } = {}) {
  const safe = E.sanitizeCfg(cfg);
  let wins = 0, draws = 0, losses = 0, plies = 0;
  for (let index = 0; index < games; index++) {
    const random = TB.rngFrom(TB.seedFrom(`${seed}:match:${index}`));
    const board = safe.layout === 'scattered'
      ? E.blocksBoard(safe.size, safe.perType, safe.layout, random) : undefined;
    const game = E.newGame(safe, board);
    const aSide = index % 2 === 0 ? E.BLUE : E.RED;     // colours swap, so first move is shared out
    let count = 0;
    while (!game.gameOver && count < PLY_CAP) {
      const pick = askFor(game, game.turn === aSide ? a : b, random);
      if (!pick) break;
      E.applyMove(game, pick.move);
      count++;
    }
    plies += count;
    const res = E.result(game);
    const lead = aSide === E.BLUE ? res.B - res.R : res.R - res.B;
    if (game.endReason === 'repetition' || lead === 0) draws++;
    else if (lead > 0) wins++;
    else losses++;
  }
  return { games, wins, draws, losses, score: (wins + draws / 2) / games, meanPlies: Math.round(plies / games) };
}

// ── tuning ──────────────────────────────────────────────────────────────────
// Coordinate descent, one weight at a time, each step accepted only if it lowers mean regret by
// more than a whisker. Small and legible on purpose: a bigger optimiser would fit the sample.
const STEPS = [1.6, 1 / 1.6];

function tuneVariant(cfg, positions, references, { budget, label }) {
  const priors = Bot.profileFor(cfg).weights;
  let current = { ...priors };
  let score = gradeAgainst(cfg, positions, references, player(budget, current), SEED).regret.mean;
  const trail = [];
  for (const field of Bot.TUNABLE) {
    if (!priors[field]) continue;                       // a weight the rules switched off stays off
    for (const step of STEPS) {
      const candidate = { ...current, [field]: round(current[field] * step, 4) };
      const value = gradeAgainst(cfg, positions, references, player(budget, candidate), SEED).regret.mean;
      if (value < score - 0.002) {
        trail.push(`${field} ${round(current[field], 3)}→${round(candidate[field], 3)} regret ${round(score, 3)}→${round(value, 3)}`);
        current = candidate;
        score = value;
        break;                                          // one accepted step a weight, then move on
      }
    }
  }
  const changed = Bot.TUNABLE.some((field) => current[field] !== priors[field]);
  if (!changed) return { label, priors, weights: null, trail, regret: round(score, 4) };
  // Grading is not playing. A vector that agrees with a deep search but cannot beat the priors
  // over the board has learned the reference, not the game, and is thrown away.
  const played = match(cfg, player(budget, current), player(budget, priors), { games: GAMES });
  return {
    label,
    priors,
    weights: played.score >= 0.5 ? current : null,
    regret: round(score, 4),
    match: played,
    trail,
  };
}

// ── run ─────────────────────────────────────────────────────────────────────
const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
console.log(`tune · ${POSITIONS} positions · reference ${REFERENCE} nodes · rungs ${RUNGS.join('/')}`
  + ` · ${GAMES} games a match · seed 0x${SEED.toString(16)}\n`);

// 1. The exact grade, on the one board where a mistake is a fact rather than an opinion.
const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'tablebase', 'manifest.json'), 'utf8'));
const solved = manifest.variants.find((variant) => variant.id === 'king');
const solvedCfg = E.sanitizeCfg(solved.cfg);
const tablePath = join(ROOT, 'public', 'tablebase', 'king.tb');
const truth = [];
let truthMethod = null;
if (existsSync(tablePath)) {
  const table = gunzipSync(readFileSync(tablePath));
  const sample = samplePositions(solvedCfg, TRUTH_POSITIONS, `${SEED}:truth`);
  const references = sample.map((position) => tableReference(table, solvedCfg, position));
  const usable = references.filter(Boolean);
  console.log(`truth · ${usable.length} solved positions with a choice in them`);
  for (const rung of RUNGS) {
    const grade = gradeAgainst(solvedCfg, sample, references, player(rung), `${SEED}:truth`);
    truth.push({
      nodes: rung,
      graded: grade.graded,
      best: round(grade.best.p),
      bestLo: round(grade.best.lo),
      bestHi: round(grade.best.hi),
      blunder: round(grade.blunder.p),
      blunderLo: round(grade.blunder.lo),
      blunderHi: round(grade.blunder.hi),
      regret: round(grade.regret.mean),
      meanDepth: grade.meanDepth,
    });
    console.log(`  ${String(rung).padStart(6)} nodes  best ${pct(grade.best.p)}  `
      + `threw the game away ${pct(grade.blunder.p)}  depth ${grade.meanDepth}  [${since()}]`);
  }
  truthMethod = {
    variant: solved.id,
    rules: solved.rules,
    sampled: sample.length,
    positions: usable.length,
    randomBest: round(mean(usable.map((reference) => reference.randomBest))),
    randomHolds: round(mean(usable.map((reference) => reference.randomHolds))),
    meanLegal: round(mean(usable.map((reference) => reference.legal)), 2),
  };
  console.log(`  a mover picking at random: best ${pct(truthMethod.randomBest)}, `
    + `holds the result ${pct(truthMethod.randomHolds)} of the time\n`);
}

// 2. The same grade on boards nobody will ever solve, against the deepest search affordable.
const ladder = [];
const duels = [];
for (const size of SIZES) {
  const cfg = L.labCfg(size);
  const sample = samplePositions(cfg, POSITIONS, `${SEED}:size:${size}`);
  const references = sample.map((position) => deepReference(cfg, position));
  const branching = round(mean(sample.map((position) =>
    E.allMoves(position.board, position.turn, cfg).length)), 2);
  for (const rung of RUNGS) {
    const grade = gradeAgainst(cfg, sample, references, player(rung), `${SEED}:size:${size}`);
    ladder.push({
      size,
      nodes: rung,
      sampled: sample.length,
      graded: grade.graded,
      branching,
      regret: round(grade.regret.mean),
      regretLo: round(grade.regret.lo),
      regretHi: round(grade.regret.hi),
      best: round(grade.best.p),
      blunder: round(grade.blunder.p),
      meanDepth: grade.meanDepth,
    });
  }
  // Agreeing with a deeper search is not the same as beating a shallower one, so the ladder ends
  // with the claim people actually care about: does the extra search win games?
  const strong = RUNGS[Math.min(2, RUNGS.length - 1)];
  const weak = RUNGS[0];
  const played = match(cfg, player(strong), player(weak), { games: GAMES, seed: `${SEED}:duel:${size}` });
  duels.push({
    size,
    strong,
    weak,
    games: played.games,
    wins: played.wins,
    draws: played.draws,
    losses: played.losses,
    score: round(played.score),
    decisive: round(L.wilson(played.wins, played.wins + played.losses).p),
    decisiveLo: round(L.wilson(played.wins, played.wins + played.losses).lo),
    decisiveHi: round(L.wilson(played.wins, played.wins + played.losses).hi),
    meanPlies: played.meanPlies,
  });
  const row = ladder.filter((entry) => entry.size === size);
  console.log(`${size}×${size} · b=${branching} · regret `
    + row.map((entry) => `${entry.nodes}:${entry.regret.toFixed(2)}`).join('  ')
    + ` · ${strong} beat ${weak} ${played.wins}/${played.draws}/${played.losses}  [${since()}]`);
}
console.log('');

// 3. Tuning, per variant, where measuring says the derived weights can be beaten.
const tuned = {};
const tuningReport = [];
if (!flag('no-tune')) {
  for (const key of TUNE_LIST) {
    const preset = E.PRESETS[key];
    if (!preset) { console.log(`${key}: no such preset`); continue; }
    const cfg = E.sanitizeCfg(preset);
    const sample = samplePositions(cfg, POSITIONS, `${SEED}:tune:${key}`);
    const references = sample.map((position) => deepReference(cfg, position));
    const result = tuneVariant(cfg, sample, references, { budget: TUNE_BUDGET, label: E.presetLabel(key) });
    const fingerprint = Bot.fingerprintOf(cfg);
    if (result.weights) {
      tuned[fingerprint] = { label: result.label, weights: result.weights };
      console.log(`${key.padEnd(9)} tuned · ${result.trail.join(' · ')} · match ${result.match.score.toFixed(2)}  [${since()}]`);
    } else {
      console.log(`${key.padEnd(9)} kept the derived weights${result.match ? ` (match ${result.match.score.toFixed(2)})` : ''}  [${since()}]`);
    }
    tuningReport.push({
      variant: key,
      label: result.label,
      fingerprint,
      accepted: !!result.weights,
      weights: result.weights,
      priors: result.priors,
      regret: result.regret,
      match: result.match || null,
      steps: result.trail,
    });
  }
}

// ── write ───────────────────────────────────────────────────────────────────
const entries = Object.entries(tuned).map(([fingerprint, entry]) =>
  `  '${fingerprint}': ${JSON.stringify(entry)},`).join('\n');
writeFileSync(join(ROOT, 'public', 'bot-tuning.js'), `// Generated by \`npm run tune\` — do not edit by hand.
//
// Evaluation weights that were measured to beat the ones \`bot.js\` derives from the rules, keyed by
// a fingerprint of the exact ruleset they were measured under. A fingerprint that matches nothing
// in play is never looked up, so a stale entry weakens nothing: the bot falls back to derivation.
// That is deliberate and is the difference between this file and \`public/tablebase/\` — a solved
// table describes the rules and must be regenerated with them; a tuned weight is only an opinion
// about how to play them.
//
// Key: ${Bot.WEIGHT_SCHEMA}|${Bot.RULE_FIELDS.join('|')}
export const TUNING = {${entries ? `\n${entries}\n` : ''}};
`);

const out = {
  method: {
    schema: Bot.WEIGHT_SCHEMA,
    seed: SEED,
    positions: POSITIONS,
    truthPositions: TRUTH_POSITIONS,
    referenceNodes: REFERENCE,
    tuneBudget: TUNE_BUDGET,
    rungs: RUNGS,
    matchGames: GAMES,
    note: 'Regret is in units of one average piece: how much worse the move played was than the '
      + 'best move available, judged by the reference for that row. On the 3×3 the reference is '
      + 'the solved table and the grade is exact. On every larger board it is the same search '
      + `given ${REFERENCE} nodes, so those rows are a lower bound on the real error: mistakes `
      + 'the reference cannot see are not counted against anybody.',
  },
  truth: truthMethod ? { ...truthMethod, rows: truth } : null,
  ladder,
  duels,
  tuning: tuningReport,
};
mkdirSync(join(ROOT, 'public', 'atlas'), { recursive: true });
writeFileSync(join(ROOT, 'public', 'atlas', 'bots.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nwrote public/bot-tuning.js (${Object.keys(tuned).length} entries) `
  + `and public/atlas/bots.json in ${since()}`);
