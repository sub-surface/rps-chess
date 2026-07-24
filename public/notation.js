// JPGN — JANKEN Portable Game Notation.
//
// A PGN-inspired, text-first interchange format containing the exact rules,
// starting position, metadata, and coordinate moves required to replay a game.
import * as E from './engine.js';

export const JPGN_VERSION = '1.1';
const SUPPORTED_VERSIONS = new Set(['1.0', JPGN_VERSION]);

const PIECE_LETTER = { rock: 'R', paper: 'P', scissors: 'S' };
const PIECE_TYPE = { R: 'rock', P: 'paper', S: 'scissors' };
const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

const escapeTag = (value) => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/[\r\n]+/g, ' ');

const unescapeTag = (value) => value.replace(/\\(["\\])/g, '$1');

const formatDate = (value) => {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '????.??.??';
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('.');
};

const rulesText = (cfg) => {
  const safe = E.sanitizeCfg(cfg);
  return [
    `size=${safe.size}`,
    `perType=${safe.perType}`,
    `rockMove=${safe.rockMove}`,
    `paperMove=${safe.paperMove}`,
    `scissorsMove=${safe.scissorsMove}`,
    `capture=${safe.capture}`,
    `territory=${safe.territory ? 1 : 0}`,
    `retread=${safe.retread ? 1 : 0}`,
    `trail=${safe.trail ? 1 : 0}`,
    `enclosure=${safe.enclosure ? 1 : 0}`,
    `threefold=${safe.threefold ? 1 : 0}`,
    `layout=${safe.layout}`,
    `actionsPerTurn=${safe.actionsPerTurn}`,
    `first=${safe.first}`,
  ].join(';');
};

const parseRules = (value) => {
  const raw = {};
  for (const field of String(value || '').split(';')) {
    const at = field.indexOf('=');
    if (at < 1) continue;
    const key = field.slice(0, at);
    const item = field.slice(at + 1);
    if (['size', 'perType', 'actionsPerTurn'].includes(key)) raw[key] = Number(item);
    else if (['territory', 'retread', 'trail', 'enclosure', 'threefold'].includes(key)) raw[key] = item === '1';
    else raw[key] = item;
  }
  // Records written before the field existed must retain their historical rules;
  // new records always spell it out.
  if (!('threefold' in raw)) raw.threefold = false;
  return E.sanitizeCfg(raw);
};

const resultToken = (game) => {
  if (!game?.gameOver) return '*';
  if (game.endReason === 'repetition') return '1/2-1/2';
  const result = E.result(game);
  const winner = game.winner || (result.B > result.R ? E.BLUE : result.R > result.B ? E.RED : null);
  return winner === E.BLUE ? '1-0' : winner === E.RED ? '0-1' : '1/2-1/2';
};

const positionCode = (game, cfg) => {
  if (typeof game.startPos === 'string') return game.startPos;
  if (typeof game.pos === 'string') return game.pos;
  if (!game.moves?.length && Array.isArray(game.board)) return E.encodePos(game.board);
  return null;
};

const ownershipCode = (game, cfg) => {
  if (typeof game.startOwners === 'string') return game.startOwners;
  if (typeof game.own === 'string') return game.own;
  if (!game.moves?.length && Array.isArray(game.board)) return E.encodeOwners(game.board);
  return null;
};

const validSquare = (square, size) => Array.isArray(square)
  && square.length === 2
  && square.every(Number.isInteger)
  && square.every((coordinate) => coordinate >= 0 && coordinate < size);

export const moveNotation = (move, size) => {
  if (move
      && PIECE_LETTER[move.piece]
      && validSquare(move.from, size)
      && validSquare(move.to, size)) {
    return `${PIECE_LETTER[move.piece]}${E.sqName(move.from[0], move.from[1], size)}${move.capture ? 'x' : '-'}${E.sqName(move.to[0], move.to[1], size)}`;
  }
  const legacy = String(move?.t || '').trim()
    .replace(/\s+/g, '')
    .replace(/[×]/g, 'x')
    .replace(/[–—]/g, '-');
  return /^[RPS][a-m]\d{1,2}[-x][a-m]\d{1,2}$/.test(legacy) ? legacy : null;
};

// The history panel and JPGN writer share this numbering and piece formatter.
// That keeps every action in a multi-action turn visible and prevents either
// surface from reconstructing a piece letter from the post-move board.
export function annotateMoves(moves, size) {
  let round = 1;
  let previous = null;
  let action = 0;
  return (Array.isArray(moves) ? moves : []).map((move, index) => {
    const color = move?.c;
    if (color !== previous) {
      if (color === E.BLUE && previous === E.RED) round++;
      action = 1;
    } else {
      action++;
    }
    const notation = moveNotation(move, size);
    const display = notation
      ? `${notation[0]} ${notation.slice(1).replace('x', '×').replace('-', '–')}`
      : null;
    previous = color;
    return { move, ply: index + 1, color, round, action, notation, display };
  });
}

const wrapMovetext = (parts, width = 88) => {
  const lines = [];
  let line = '';
  for (const part of parts) {
    if (!line) line = part;
    else if (line.length + part.length + 1 <= width) line += ` ${part}`;
    else { lines.push(line); line = part; }
  }
  if (line) lines.push(line);
  return lines.join('\n');
};

export function exportJpgn(game, context = {}) {
  if (!game?.cfg || !Array.isArray(game.board)) throw new Error('JPGN requires a game state');
  const cfg = E.sanitizeCfg(game.cfg);
  const position = positionCode(game, cfg);
  const ownership = ownershipCode(game, cfg);
  const moves = Array.isArray(game.moves) ? game.moves : [];
  const annotated = annotateMoves(moves, cfg.size);
  const replayable = !!position
    && !!ownership
    && annotated.every((entry) => [E.BLUE, E.RED].includes(entry.color) && entry.notation);
  const score = E.result(game);
  const result = resultToken(game);
  const termination = game.gameOver
    ? (game.endReason || E.terminalReason(game) || 'adjudication')
    : 'unterminated';
  const ruleset = E.presetLabel(E.presetOf(cfg));

  const tags = [
    ['JPGN', JPGN_VERSION],
    ['Event', context.event || (context.room ? 'JANKEN Online Game' : 'JANKEN Local Game')],
    ['Site', context.site || 'https://rps.subsurfaces.net/'],
    ['Date', formatDate(context.date || game.startedAt)],
    ['Blue', context.names?.B || 'Blue'],
    ['Red', context.names?.R || 'Red'],
    ['Result', result],
    ['Variant', E.variantLabel(cfg)],
    ['Ruleset', ruleset],
    ['RulesetVersion', '1.0'],
    ['Board', `${cfg.size}x${cfg.size}`],
    ['StartLayout', cfg.layout],
    ['Rules', rulesText(cfg)],
    ['Position', position ? `${cfg.size}:${position}` : 'unavailable'],
    ['Territory', ownership ? `${cfg.size}:${ownership}` : 'unavailable'],
    ['Rated', game.rated ? '1' : '0'],
    ['Termination', termination],
    ['Score', `${score.B}-${score.R} ${score.metric}`],
    ['PlyCount', moves.length],
    ['Replayable', replayable ? '1' : '0'],
  ];
  if (context.room) tags.splice(4, 0, ['Room', context.room]);
  if (Number.isFinite(context.ratings?.B)) tags.splice(-4, 0, ['BlueElo', Math.round(context.ratings.B)]);
  if (Number.isFinite(context.ratings?.R)) tags.splice(-4, 0, ['RedElo', Math.round(context.ratings.R)]);

  const tagText = tags.map(([key, value]) => `[${key} "${escapeTag(value)}"]`).join('\n');
  const body = [];
  for (const entry of annotated) {
    body.push(`${entry.round}.${entry.color}${entry.action}`, entry.notation || '??');
  }
  body.push(result);
  return `${tagText}\n\n${wrapMovetext(body)}\n`;
}

const squareCoords = (file, rankText, size) => {
  const col = file.charCodeAt(0) - 97;
  const rank = Number(rankText);
  const row = size - rank;
  if (!Number.isInteger(rank) || row < 0 || row >= size || col < 0 || col >= size) {
    throw new Error(`JPGN square outside ${size}x${size} board: ${file}${rankText}`);
  }
  return [row, col];
};

export function parseJpgn(text) {
  if (typeof text !== 'string') throw new Error('JPGN must be text');
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const splitAt = normalized.indexOf('\n\n');
  if (splitAt < 0) throw new Error('JPGN requires tags followed by a blank line');
  const tags = {};
  for (const line of normalized.slice(0, splitAt).split('\n')) {
    const match = line.match(/^\[([A-Za-z][A-Za-z0-9_]*) "((?:\\.|[^"])*)"\]$/);
    if (!match) throw new Error(`Invalid JPGN tag: ${line}`);
    tags[match[1]] = unescapeTag(match[2]);
  }
  if (!SUPPORTED_VERSIONS.has(tags.JPGN)) throw new Error(`Unsupported JPGN version: ${tags.JPGN || 'missing'}`);
  if (!RESULT_TOKENS.has(tags.Result)) throw new Error('Invalid JPGN Result tag');
  if (tags.Replayable !== '1') throw new Error('JPGN record is marked non-replayable');

  const cfg = parseRules(tags.Rules);
  if (tags.Board !== `${cfg.size}x${cfg.size}`) throw new Error('JPGN Board tag does not match Rules');
  const positionMatch = String(tags.Position || '').match(/^(\d+):([RPSrps.]+)$/);
  if (!positionMatch || Number(positionMatch[1]) !== cfg.size) throw new Error('Invalid JPGN position');
  const territoryMatch = String(tags.Territory || '').match(/^(\d+):([BR.]+)$/);
  if (!territoryMatch || Number(territoryMatch[1]) !== cfg.size) throw new Error('Invalid JPGN territory layer');
  const pieces = E.decodePos(positionMatch[2], cfg.size);
  const board = pieces && E.decodeOwners(territoryMatch[2], pieces);
  if (!board) throw new Error('JPGN position cannot be decoded');

  const tokens = normalized.slice(splitAt + 2).trim().split(/\s+/);
  const bodyResult = tokens.pop();
  if (!RESULT_TOKENS.has(bodyResult) || bodyResult !== tags.Result) {
    throw new Error('JPGN body result does not match Result tag');
  }
  if (tokens.length % 2 !== 0) throw new Error('JPGN movetext must contain prefix/move pairs');

  const moves = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const prefix = tokens[index].match(/^(\d+)\.([BR])(\d+)$/);
    const move = tokens[index + 1].match(/^([RPS])([a-m])(\d{1,2})([-x])([a-m])(\d{1,2})$/);
    if (!prefix || !move) throw new Error(`Invalid JPGN movetext near: ${tokens[index]} ${tokens[index + 1]}`);
    moves.push({
      round: Number(prefix[1]),
      color: prefix[2],
      action: Number(prefix[3]),
      piece: PIECE_TYPE[move[1]],
      from: squareCoords(move[2], move[3], cfg.size),
      capture: move[4] === 'x',
      to: squareCoords(move[5], move[6], cfg.size),
    });
  }
  if (Number(tags.PlyCount) !== moves.length) throw new Error('JPGN PlyCount does not match movetext');
  return { tags, cfg, board, moves, result: bodyResult };
}

export function replayJpgn(text) {
  const parsed = parseJpgn(text);
  const game = E.newGame(parsed.cfg, parsed.board);
  let round = 1;
  let previous = null;
  let action = 0;
  for (const recorded of parsed.moves) {
    if (game.gameOver) throw new Error('JPGN contains moves after game over');
    if (recorded.color !== previous) {
      if (recorded.color === E.BLUE && previous === E.RED) round++;
      action = 1;
    } else {
      action++;
    }
    if (recorded.round !== round || recorded.action !== action) {
      throw new Error('JPGN turn/action prefix is inconsistent');
    }
    if (recorded.color !== game.turn) throw new Error('JPGN move is out of turn');
    const piece = game.board[recorded.from[0]][recorded.from[1]].piece;
    if (!piece || piece.type !== recorded.piece || piece.color !== recorded.color) {
      throw new Error('JPGN source piece does not match the board');
    }
    const isCapture = !!game.board[recorded.to[0]][recorded.to[1]].piece;
    if (isCapture !== recorded.capture) throw new Error('JPGN capture marker does not match the board');
    const move = {
      fr: recorded.from[0],
      fc: recorded.from[1],
      tr: recorded.to[0],
      tc: recorded.to[1],
    };
    if (!E.isLegal(game.board, move, game.turn, game.cfg)) throw new Error('JPGN contains an illegal move');
    E.applyMove(game, move);
    previous = recorded.color;
  }

  const forcedWinner = parsed.result === '1-0' ? E.BLUE : parsed.result === '0-1' ? E.RED : null;
  if (!game.gameOver && ['resign', 'abandon', 'adjudication'].includes(parsed.tags.Termination)) {
    game.gameOver = true;
    game.winner = forcedWinner;
    game.endReason = parsed.tags.Termination;
  }
  const replayedResult = resultToken(game);
  if (replayedResult !== parsed.result) {
    throw new Error(`JPGN result mismatch: replay produced ${replayedResult}`);
  }
  if (game.gameOver
      && !['resign', 'abandon', 'adjudication'].includes(parsed.tags.Termination)
      && game.endReason !== parsed.tags.Termination) {
    throw new Error(`JPGN termination mismatch: replay produced ${game.endReason || 'unknown'}`);
  }
  const score = E.result(game);
  if (parsed.tags.Score !== `${score.B}-${score.R} ${score.metric}`) {
    throw new Error('JPGN score does not match the replayed position');
  }
  return { game, parsed };
}
