// Azel's wall reachability experiment (SPEC §8.6 D13).
// Forward census from the fixed 5×5 Azel starting position under the shipped rules.
// Deterministic output with explicit caps; writes public/atlas/azel-wall.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as E from '../public/engine.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'atlas');

const argument = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at > 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback;
};

const MAX_STATES = argument('--max-states', 50_000);
const MAX_EDGES = argument('--max-edges', 200_000);
const MAX_PLIES = argument('--max-plies', 20);

export function censusAzelWall({
  maxStates = MAX_STATES,
  maxEdges = MAX_EDGES,
  maxPlies = MAX_PLIES,
} = {}) {
  const cfg = E.sanitizeCfg({ ...E.PRESETS.azel, threefold: false });
  const startBoard = E.blocksBoard(cfg.size, cfg.perType, cfg.layout);
  const startKey = `${E.encodePos(startBoard)}|${E.BLUE}`;

  const seen = new Map(); // key -> { ply, material }
  seen.set(startKey, { ply: 0, material: 12 });

  const queue = [{ board: startBoard, turn: E.BLUE, ply: 0, material: 12 }];
  let edgeCount = 0;
  let revisits = 0;
  const terminalReasons = {};
  const pliesData = [];

  const countPieces = (b) => {
    let count = 0;
    for (let r = 0; r < cfg.size; r++) {
      for (let c = 0; c < cfg.size; c++) {
        if (b[r][c].piece) count++;
      }
    }
    return count;
  };

  while (queue.length > 0) {
    if (seen.size >= maxStates || edgeCount >= maxEdges) break;

    const current = queue.shift();
    const { board, turn, ply, material } = current;

    while (pliesData.length <= ply) {
      pliesData.push({ ply: pliesData.length, states: 0, edges: 0, captures: 0, terminals: 0 });
    }
    pliesData[ply].states++;

    const moves = E.allMoves(board, turn, cfg);
    if (!moves.length) {
      const term = 'immobilization';
      terminalReasons[term] = (terminalReasons[term] || 0) + 1;
      pliesData[ply].terminals++;
      continue;
    }

    for (const move of moves) {
      edgeCount++;
      pliesData[ply].edges++;
      if (edgeCount >= maxEdges) break;

      const game = {
        board: E.cloneBoard(board),
        turn,
        cfg,
        moves: [],
        gameOver: false,
        winner: null,
        actionsUsed: 0,
        repetitions: {},
        dry: 0,
      };

      const isCapture = !!E.captureTarget(board, move, cfg);
      if (isCapture) pliesData[ply].captures++;

      E.applyMove(game, move);

      if (game.gameOver) {
        const reason = game.endReason || 'elimination';
        terminalReasons[reason] = (terminalReasons[reason] || 0) + 1;
        pliesData[ply].terminals++;
        continue;
      }

      const nextKey = `${E.encodePos(game.board)}|${game.turn}`;
      const nextMaterial = isCapture ? countPieces(game.board) : material;

      if (!seen.has(nextKey)) {
        if (seen.size < maxStates && ply + 1 < maxPlies) {
          seen.set(nextKey, { ply: ply + 1, material: nextMaterial });
          queue.push({
            board: game.board,
            turn: game.turn,
            ply: ply + 1,
            material: nextMaterial,
          });
        }
      } else {
        revisits++;
      }
    }
  }

  const isComplete = queue.length === 0;

  // Layer breakdown from visited states
  const materialLayers = {};
  for (const entry of seen.values()) {
    materialLayers[entry.material] = (materialLayers[entry.material] || 0) + 1;
  }

  return {
    variant: 'azel',
    boardSize: cfg.size,
    layout: cfg.layout,
    startingMaterial: E.startingMaterial(cfg),
    startPos: E.encodePos(startBoard),
    complete: isComplete,
    caps: {
      maxStates,
      maxEdges,
      maxPlies,
    },
    traversal: {
      totalStates: seen.size,
      totalEdges: edgeCount,
      revisits,
      frontierRemaining: queue.length,
      maxPlyReached: pliesData.length - 1,
      terminalReasons,
      materialLayers,
      plies: pliesData.map((p) => ({
        ...p,
        branching: p.states ? +(p.edges / p.states).toFixed(2) : 0,
      })),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`azel-wall · forward census · cap ${MAX_STATES} states / ${MAX_EDGES} edges\n`);
  const started = Date.now();
  const report = censusAzelWall();
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'azel-wall.json'), JSON.stringify(report, null, 2) + '\n');

  console.log(`Visited ${report.traversal.totalStates.toLocaleString()} states and `
    + `${report.traversal.totalEdges.toLocaleString()} edges across ${report.traversal.maxPlyReached} plies in ${elapsed}s.`);
  console.log(`Revisits (cycle evidence): ${report.traversal.revisits.toLocaleString()}`);
  console.log(`Complete: ${report.complete} (frontier remaining: ${report.traversal.frontierRemaining.toLocaleString()})`);
  console.log(`Wrote public/atlas/azel-wall.json\n`);
}
