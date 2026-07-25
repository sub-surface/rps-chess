// Measures the boards the tablebase cannot reach and writes public/atlas/lab.json.
//
// The rules come from public/engine.js and the arithmetic from public/lab.js — the same module
// the atlas imports — so a figure on the page and a figure in this file cannot disagree. Nothing
// here re-implements a rule, a count, or a policy.
//
//   node scripts/lab.mjs             # the committed run
//   node scripts/lab.mjs --games 2000
//
// Output is deterministic: same seed, same bytes, no timestamps. A run that changed the file
// without a rules change would mean something drifted, and that is worth noticing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as E from '../public/engine.js';
import * as L from '../public/lab.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'atlas');
const argument = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at > 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback;
};

const GAMES = argument('--games', 600);
const SEED = argument('--seed', 0x1a7b5eed);

// The rate the 3×3 solve actually ran at, on one core: the king variant walked 2.68M moves in
// 20.9 seconds. Pricing a 5×5 from a figure somebody hoped for would make the whole section
// decorative, so this is taken from the run whose output sits in public/tablebase/.
const SOLVER_EDGES_PER_SECOND = 128_000;

console.log(`lab · ${GAMES} games a size · seed 0x${SEED.toString(16)}\n`);

// ── measured play, on the sizes people pick ──────────────────────────────────
const play = [];
for (const size of L.PLAYED) {
  const cfg = L.labCfg(size);
  for (const policy of ['greedy', 'random']) {
    const started = Date.now();
    const summary = L.measure(cfg, { games: GAMES, seed: SEED, policy });
    play.push(summary);
    console.log(`${size}×${size} ${policy.padEnd(7)} `
      + `first ${(100 * summary.firstPlayer.p).toFixed(1)}% `
      + `[${(100 * summary.firstPlayer.lo).toFixed(1)}–${(100 * summary.firstPlayer.hi).toFixed(1)}] · `
      + `draws ${(100 * summary.drawRate.p).toFixed(1)}% · `
      + `${summary.medianPlies} plies · b=${summary.meanBranching.toFixed(1)} · `
      + `${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

// ── the ladder: exact counting, priced by measured branching ─────────────────
const branchPoints = play
  .filter((entry) => entry.policy === 'random')
  .map((entry) => ({ size: entry.size, value: entry.meanBranching }));

console.log('');
const ladder = L.LADDER.map((size) => {
  const cfg = L.labCfg(size);
  const space = L.stateSpace(cfg);
  const openings = L.openingCount(cfg);
  const branching = L.branchingFor(size, branchPoints);
  const cost = L.solveCost(space.states, branching, SOLVER_EDGES_PER_SECOND);
  return {
    size,
    perType: cfg.perType,
    cells: space.cells,
    pieces: space.pieces,
    placements: space.placements.toString(),
    states: space.states.toString(),
    log10States: L.log10Of(space.states),
    openings: openings.toString(),
    log10Openings: L.log10Of(openings),
    branching,
    branchingMeasured: branchPoints.some((point) => point.size === size),
    solvedBytes: cost.bytes.toString(),
    solveRam: cost.ram.toString(),
    solveSeconds: cost.seconds,
    mobilityCeiling: L.mobilityCeiling(size).mean,
    solved: size === 3,
  };
});
for (const rung of ladder) {
  console.log(`${String(rung.size).padStart(2)}×${rung.size}  ${rung.pieces} pieces  `
    + `10^${rung.log10States.toFixed(1)} states  b≈${rung.branching.toFixed(1)}`
    + `${rung.branchingMeasured ? '' : ' (fitted)'}  ${rung.openings} openings`);
}

// ── the blocking law ─────────────────────────────────────────────────────────
// Under RPS exactly one of the three enemy types is takeable, so a piece meeting a uniformly
// random enemy can capture it one time in three and is walled off the other two. The measured
// contact ratio above is what real positions do to that expectation, and the two agreeing is the
// point: the law is not a hypothesis, it is arithmetic, and play does not escape it.
const blocking = {
  takeableShare: 1 / 3,
  measured: Object.fromEntries(play
    .filter((entry) => entry.policy === 'random')
    .map((entry) => [entry.size, entry.contactRatio])),
  ceiling: L.LADDER.map((size) => L.mobilityCeiling(size)),
};

const report = {
  rules: {
    label: E.variantLabel(L.labCfg(9)),
    note: 'All kings, RPS captures, elimination, centred blocks — the shipped Standard, scaled.',
  },
  method: {
    games: GAMES,
    seed: SEED,
    solverEdgesPerSecond: SOLVER_EDGES_PER_SECOND,
    interval: '95% Wilson',
  },
  ladder,
  play,
  blocking,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'lab.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nwrote public/atlas/lab.json (${ladder.length} sizes, ${play.length} measured runs)`);
