import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';
import * as Bot from '../public/bot.js';
import { TUNING } from '../public/bot-tuning.js';

// A game object the bot can search from, built straight onto a board rather than played into one.
const positionOf = (cfg, board, turn = E.BLUE) => ({
  board,
  cfg: E.sanitizeCfg(cfg),
  turn,
  acts: 0,
  dry: 0,
  moves: [],
  passStreak: 0,
  gameOver: false,
  endReason: null,
  repetitions: {},
});
const put = (board, row, col, type, color) => { board[row][col].piece = { type, color }; };
const at = (move) => `${move.tr}${move.tc}`;
// Node-limited and never clock-limited, so a slow machine gets the same answer as a fast one.
const think = (game, nodes, extra = {}) => Bot.chooseMove(game, {
  nodes, ms: Infinity, slack: 0, random: () => 0.5, ...extra,
});

describe('what the bot derives from a ruleset', () => {
  it('fingerprints the rules and ignores preferences', () => {
    const rules = E.PRESETS.standard;
    expect(Bot.fingerprintOf(rules)).toBe(Bot.fingerprintOf({ ...rules, pieceStyle: 'kanji', botLevel: 'strong' }));
    expect(Bot.fingerprintOf(rules)).not.toBe(Bot.fingerprintOf({ ...rules, size: 11 }));
    expect(Bot.fingerprintOf(rules)).not.toBe(Bot.fingerprintOf({ ...rules, forcedCapture: true }));
    expect(Bot.fingerprintOf(rules).startsWith(`${Bot.WEIGHT_SCHEMA}|`)).toBe(true);
    // Every preset is a distinct ruleset, so no two may share a key — a collision would hand one
    // variant's measured weights to another.
    const keys = E.PRESET_KEYS.filter((key) => E.PRESETS[key]).map((key) => Bot.fingerprintOf(E.PRESETS[key]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('asks the engine who takes whom rather than restating the cycle', () => {
    const rps = Bot.captureGraph(E.PRESETS.standard);
    expect(rps.rock).toEqual(['scissors']);
    expect(rps.paper).toEqual(['rock']);
    expect(rps.scissors).toEqual(['paper']);
    // A checkers leap obeys the same cycle, and chess capture has no cycle at all.
    expect(Bot.captureGraph(E.PRESETS.checkers).rock).toEqual(['scissors']);
    expect(Bot.captureGraph({ ...E.PRESETS.standard, capture: 'chess' }).rock)
      .toEqual(['rock', 'paper', 'scissors']);
  });

  it('measures a piece by what it can reach on this board', () => {
    // The same archetype is worth more room on a bigger board, and a knight is nearly stuck on a
    // 3×3 — which is exactly why piece values cannot be a constant table.
    expect(Bot.mobilityOf({ ...E.PRESETS.standard, size: 3 }, 'rock'))
      .toBeLessThan(Bot.mobilityOf({ ...E.PRESETS.standard, size: 9 }, 'rock'));
    const cavalry = { ...E.PRESETS.cavalry, size: 3 };
    expect(Bot.mobilityOf(cavalry, 'rock')).toBeLessThan(Bot.mobilityOf({ ...cavalry, size: 9 }, 'rock'));
    expect(Bot.mobilityOf(E.PRESETS.painters, 'rock')).toBeGreaterThan(Bot.mobilityOf(E.PRESETS.standard, 'rock'));
  });

  it('values pieces by their movement and switches terms off when the rules do', () => {
    const kings = Bot.profileFor(E.PRESETS.standard);
    expect(kings.base.rock).toBeCloseTo(kings.base.scissors, 6);      // one archetype, one value
    expect(kings.weights.area).toBe(0);                               // elimination has no ground
    expect(kings.weights.prey).toBeGreaterThan(0);

    const mixed = Bot.profileFor(E.PRESETS.kings);                    // rook / knight / bishop
    expect(mixed.base.rock).toBeGreaterThan(mixed.base.paper);
    expect(Bot.profileFor(E.PRESETS.painters).weights.area).toBeGreaterThan(0);
    // Under chess capture everything takes everything, so the prey swing is exactly nothing.
    expect(Bot.profileFor({ ...E.PRESETS.standard, capture: 'chess' }).weights.prey).toBe(0);
  });

  it('derives a profile once per ruleset', () => {
    const first = Bot.profileFor(E.PRESETS.standard);
    expect(Bot.profileFor({ ...E.PRESETS.standard, coordStyle: 'grid' })).toBe(first);
  });
});

describe('tuning is an optimisation, never a rule', () => {
  it('only ever carries this schema and these weights', () => {
    for (const [fingerprint, entry] of Object.entries(TUNING)) {
      expect(fingerprint.startsWith(`${Bot.WEIGHT_SCHEMA}|`)).toBe(true);
      expect(fingerprint.split('|').length).toBe(Bot.RULE_FIELDS.length + 1);
      for (const [field, value] of Object.entries(entry.weights || {})) {
        expect(Bot.TUNABLE).toContain(field);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('falls back to derived weights for a ruleset nobody measured', () => {
    // A ruleset no tuner has ever seen still plays, which is the property that lets a new variant
    // ship without anything being regenerated.
    const invented = { ...E.PRESETS.standard, size: 12, perType: 3, scissorsMove: 'cross' };
    const profile = Bot.profileFor(invented);
    expect(profile.tuned).toBe(null);
    expect(profile.weights.material).toBeGreaterThan(0);
    expect(TUNING[profile.fingerprint]).toBeUndefined();
  });
});

describe('the search', () => {
  const skirmish = E.sanitizeCfg(E.PRESETS.skirmish);

  it('takes the win when taking is winning', () => {
    const board = E.emptyBoard(3);
    put(board, 1, 1, 'rock', E.BLUE);
    put(board, 0, 0, 'scissors', E.RED);            // Red's last piece, and Blue's rock beats it
    const pick = think(positionOf(skirmish, board), 2000);
    expect(at(pick.move)).toBe('00');
    expect(pick.score).toBeGreaterThan(900_000);
  });

  it('refuses a capture that loses the game, and drags out a loss it cannot avoid', () => {
    // Blue's only piece may take the scissors in the corner — and the paper beside it takes back,
    // which is the end of Blue. One ply of greed plays it; two plies of search do not.
    const board = E.emptyBoard(3);
    put(board, 1, 1, 'rock', E.BLUE);
    put(board, 0, 0, 'scissors', E.RED);
    put(board, 1, 0, 'paper', E.RED);
    const game = positionOf(skirmish, board);
    expect(E.terminalReason(game)).toBe(null);

    const pick = think(game, 3000);
    expect(at(pick.move)).not.toBe('00');
    expect(['12', '02', '22']).toContain(at(pick.move));

    // Every move loses here, so the search shows its distance preference: the moves it likes are
    // the ones that lose later.
    const ranked = Bot.searchRoot(game, { nodes: 3000, ms: Infinity, slack: 0 }).ranked;
    expect(ranked[0].score).toBeLessThan(0);
    expect(ranked[0].score).toBeGreaterThan(ranked[ranked.length - 1].score);
  });

  it('spends a bigger budget on more depth', () => {
    const game = E.newGame(E.sanitizeCfg(E.PRESETS.standard));
    const shallow = Bot.searchRoot(game, { nodes: 150, ms: Infinity });
    const deeper = Bot.searchRoot(game, { nodes: 6000, ms: Infinity });
    expect(deeper.depth).toBeGreaterThan(shallow.depth);
    expect(deeper.nodes).toBeGreaterThan(shallow.nodes);
  });

  it('plays the obligation when one is on', () => {
    const cfg = E.sanitizeCfg({ ...E.PRESETS.standard, size: 5, forcedCapture: true });
    const board = E.emptyBoard(5);
    put(board, 2, 2, 'rock', E.BLUE);
    put(board, 4, 4, 'paper', E.BLUE);
    put(board, 2, 3, 'scissors', E.RED);
    put(board, 0, 0, 'paper', E.RED);
    const game = positionOf(cfg, board);
    const pick = think(game, 2000);
    expect(E.captureTarget(board, pick.move, cfg)).not.toBe(null);
  });

  it('answers the same way twice, and not at all once the game is over', () => {
    const game = E.newGame(E.sanitizeCfg(E.PRESETS.azel));
    const seeded = () => { let n = 0; return () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648); };
    const first = Bot.chooseMove(game, { nodes: 1500, ms: Infinity, random: seeded() });
    const again = Bot.chooseMove(game, { nodes: 1500, ms: Infinity, random: seeded() });
    expect(again.move).toEqual(first.move);
    expect(Bot.chooseMove({ ...game, gameOver: true }, { nodes: 100, ms: Infinity })).toBe(null);
  });

  it('resolves a level nobody ships any more', () => {
    expect(Bot.levelOf('wizard')).toBe(Bot.DEFAULT_LEVEL);
    expect(Bot.levelOf(undefined)).toBe(Bot.DEFAULT_LEVEL);
    expect(Bot.levelOf('perfect')).toBe('perfect');
  });
});

// The bot searches by playing moves through the engine, so this is the test that would catch it
// growing a second opinion about legality — including on the presets with the odd rules: three
// actions a turn, a capture obligation, painting, enclosure, a fixed lopsided deal.
describe('every shipped variant', () => {
  for (const key of E.PRESET_KEYS) {
    if (!E.PRESETS[key]) continue;
    it(`plays ${key} legally`, () => {
      const cfg = E.sanitizeCfg(E.PRESETS[key]);
      const game = E.newGame(cfg);
      let plies = 0;
      while (!game.gameOver && plies < 10) {
        const pick = think(game, 300);
        expect(pick).not.toBe(null);
        expect(E.isLegal(game.board, pick.move, game.turn, cfg)).toBe(true);
        E.applyMove(game, pick.move);
        plies++;
      }
      expect(plies).toBeGreaterThan(0);
      expect(E.pieceCounts(game.board).B + E.pieceCounts(game.board).R).toBeGreaterThan(0);
    });
  }
});
