// JANKEN worker — serves the static game and hosts online rooms.
// GameRoom is authoritative for one match. Lobby is a compact global room index.
import { DurableObject } from 'cloudflare:workers';
import * as E from '../public/engine.js';
import { eloDelta, START_RATING } from './elo.js';

const ROOM_TTL_MS = 30 * 60 * 1000;
const SEAT_GRACE_MS = 60 * 1000;
const ABANDON_MS = 30 * 1000;
const LOBBY_LIMIT = 100;
const MAX_SPECTATORS = 32;
const MAX_MESSAGES_PER_SECOND = 40;

const cleanName = (value) =>
  (value || '').toString().replace(/[^\w \-]/g, '').trim().slice(0, 20) || 'guest';
const cleanToken = (value) =>
  (value || '').toString().replace(/[^a-z0-9]/gi, '').slice(0, 32);
const cleanRoom = (value) =>
  (value || '').toString().replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
const cleanAccountId = (value) =>
  (value || '').toString().replace(/[^a-z0-9]/gi, '').slice(0, 32);
const newAccountId = () => {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join('');
};
const newSecret = () => crypto.randomUUID().replace(/-/g, '');
const sha256hex = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
// Constant-time secret compare: hash both to fixed 32 bytes first, so neither the
// length nor an early byte mismatch leaks through comparison timing.
const safeEqual = async (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
};
const readJson = async (request, limit = 2048) => {
  const text = await request.text();
  if (text.length > limit) return null;
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
};
const logError = (event, error, data = {}) => console.error(JSON.stringify({
  level: 'error',
  event,
  message: error instanceof Error ? error.message : String(error),
  ...data,
}));

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = null;
    this.seats = { B: null, R: null };
    this.names = { B: null, R: null };
    this.disconnected = { B: null, R: null };
    this.accounts = { B: null, R: null };
    this.ratings = { B: null, R: null };
    this.room = null;
    this.expiresAt = 0;

    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      if (!saved) return;
      this.game = saved.game;
      this.game.cfg = E.sanitizeCfg(this.game.cfg);
      this.seats = { B: null, R: null, ...(saved.seats || {}) };
      this.names = { B: null, R: null, ...(saved.names || {}) };
      this.disconnected = { B: null, R: null, ...(saved.disconnected || {}) };
      this.accounts = { B: null, R: null, ...(saved.accounts || {}) };
      this.ratings = { B: null, R: null, ...(saved.ratings || {}) };
      this.room = saved.room || null;
      this.expiresAt = saved.expiresAt || (Date.now() + ROOM_TTL_MS);
    });
  }

  lobby() {
    return this.env.LOBBY.getByName('global');
  }

  seatIsOnline(role, excluding = null) {
    const token = this.seats[role];
    if (!token) return false;
    return this.ctx.getWebSockets(role).some((socket) => {
      if (socket === excluding || socket.readyState !== 1) return false;
      const attachment = socket.deserializeAttachment() || {};
      return attachment.role === role && attachment.token === token;
    });
  }

  releaseExpiredSeats(now = Date.now()) {
    let changed = false;
    for (const role of [E.BLUE, E.RED]) {
      const since = this.disconnected[role];
      if (this.seats[role] && since && now - since >= SEAT_GRACE_MS && !this.seatIsOnline(role)) {
        this.seats[role] = null;
        this.names[role] = null;
        this.disconnected[role] = null;
        this.accounts[role] = null;
        this.ratings[role] = null;
        changed = true;
      }
    }
    return changed;
  }

  touch(now = Date.now()) {
    this.expiresAt = now + ROOM_TTL_MS;
  }

  // A rated game that has started and is not over adjudicates a 30s disconnect as a loss.
  ratedLive() {
    return !!(this.game && this.game.rated && !this.game.gameOver && this.game.moves.length > 0);
  }

  async scheduleAlarm(now = Date.now()) {
    const deadlines = [this.expiresAt || now + ROOM_TTL_MS];
    for (const role of [E.BLUE, E.RED]) {
      if (this.seats[role] && this.disconnected[role]) {
        deadlines.push(this.disconnected[role] + SEAT_GRACE_MS);
        if (this.ratedLive()) deadlines.push(this.disconnected[role] + ABANDON_MS);
      }
    }
    await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(...deadlines)));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    this.room = cleanRoom(url.searchParams.get('room')) || this.room;
    const token = cleanToken(url.searchParams.get('token')) || crypto.randomUUID().replace(/-/g, '');
    const name = cleanName(url.searchParams.get('name'));
    const now = Date.now();
    this.releaseExpiredSeats(now);

    if (!this.game) {
      let config = E.sanitizeCfg({});
      let posBoard = null, pos = null;
      const raw = url.searchParams.get('cfg');
      if (raw && raw.length <= 4096) {
        try {
          const parsed = JSON.parse(atob(raw));
          config = E.sanitizeCfg(parsed);
          if (typeof parsed.pos === 'string') {
            posBoard = E.decodePos(parsed.pos, config.size);
            if (posBoard) pos = parsed.pos;
          }
        } catch {
          // A malformed optional host config simply falls back to Standard.
        }
      }
      this.game = E.newGame(config, posBoard || undefined);
      if (pos) this.game.pos = pos;
    }

    let role = 'S';
    if (this.seats.B === token) role = E.BLUE;
    else if (this.seats.R === token) role = E.RED;
    else if (!this.seats.B) role = E.BLUE;
    else if (!this.seats.R) role = E.RED;

    if (role !== 'S') {
      this.seats[role] = token;
      this.names[role] = name;
      this.disconnected[role] = null;
    } else if (this.ctx.getWebSockets('S').filter((socket) => socket.readyState === 1).length >= MAX_SPECTATORS) {
      return new Response('spectator limit reached', { status: 503 });
    }
    this.touch(now);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, token, connectionId: crypto.randomUUID(), rateAt: now, rateCount: 0 });

    // A reconnect fences an older tab using the same seat token.
    if (role !== 'S') {
      for (const socket of this.ctx.getWebSockets(role)) {
        if (socket === server || socket.readyState !== 1) continue;
        const attachment = socket.deserializeAttachment() || {};
        if (attachment.token === token) {
          try { socket.close(4000, 'reconnected elsewhere'); } catch { /* already closed */ }
        }
      }
    }

    await this.persist();
    await this.scheduleAlarm(now);
    await this.syncLobby();
    server.send(JSON.stringify({ type: 'welcome', role, token, state: this.stateMsg() }));
    this.broadcast(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, raw) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }

    const attachment = socket.deserializeAttachment() || {};
    const now = Date.now();
    if (!attachment.rateAt || now - attachment.rateAt >= 1000) {
      attachment.rateAt = now;
      attachment.rateCount = 1;
    } else {
      attachment.rateCount = (attachment.rateCount || 0) + 1;
    }
    socket.serializeAttachment(attachment);
    if (attachment.rateCount > MAX_MESSAGES_PER_SECOND) {
      try { socket.close(1008, 'message rate exceeded'); } catch { /* already closed */ }
      return;
    }
    if (!this.game) {
      try {
        socket.send(JSON.stringify({ type: 'expired' }));
        socket.close(4002, 'room expired');
      } catch { /* already closed */ }
      return;
    }
    const seated = attachment.role === E.BLUE || attachment.role === E.RED;
    if (seated && this.seats[attachment.role] !== attachment.token) {
      try { socket.close(4001, 'seat replaced'); } catch { /* already closed */ }
      return;
    }

    if (message.type === 'move') {
      if (!seated || this.game.gameOver || attachment.role !== this.game.turn) {
        return this.sendError(socket, 'not your turn');
      }
      const from = message.from;
      const to = message.to;
      if (!Array.isArray(from) || from.length !== 2 || !Array.isArray(to) || to.length !== 2) return;
      if (![...from, ...to].every(Number.isInteger)) return this.sendError(socket, 'invalid coordinates');
      const move = { fr: from[0], fc: from[1], tr: to[0], tc: to[1] };
      if (!E.isLegal(this.game.board, move, this.game.turn, this.game.cfg)) {
        return this.sendError(socket, 'illegal move');
      }
      // The first move locks the game's ratedness and its player snapshot.
      if (this.game.moves.length === 0 && !this.game.rated && this.accounts.B && this.accounts.R) {
        this.game.rated = true;
        this.game.matchId = crypto.randomUUID();
        this.game.players = { B: this.accounts.B, R: this.accounts.R };
      }
      E.applyMove(this.game, move);
      if (this.game.gameOver) await this.finishRated('board');
      this.touch();
      await this.persist();
      await this.scheduleAlarm();
      await this.syncLobby();
      this.broadcast();
    } else if (message.type === 'auth') {
      if (!seated) return;
      const id = cleanAccountId(message.id);
      const secret = (message.secret || '').toString();
      if (!id || !secret || secret.length > 64) return this.sendError(socket, 'invalid account');
      try {
        const row = await this.env.DB.prepare('SELECT id, name, rating FROM accounts WHERE id = ?1 AND secret_hash = ?2')
          .bind(id, await sha256hex(secret)).first();
        if (!row) return this.sendError(socket, 'invalid account');
        this.accounts[attachment.role] = row.id;
        this.ratings[attachment.role] = row.rating;
        this.names[attachment.role] = row.name;
        this.ctx.waitUntil(this.env.DB.prepare('UPDATE accounts SET seen_at = ?2 WHERE id = ?1').bind(row.id, now).run());
        await this.persist();
        await this.syncLobby();
        this.broadcast();
      } catch (error) {
        logError('account_auth_failed', error, { room: this.room });
        this.sendError(socket, 'account service unavailable');
      }
    } else if (message.type === 'new') {
      if (!seated) return;
      const config = attachment.role === E.BLUE && message.cfg ? E.sanitizeCfg(message.cfg) : this.game.cfg;
      // A challenge room keeps its custom position across rematches; Blue may send a
      // fresh one (or none, which restarts from the standard blocks).
      const pos = typeof message.pos === 'string' ? message.pos
        : (attachment.role === E.RED ? this.game.pos : null);
      const posBoard = pos ? E.decodePos(pos, config.size) : null;
      this.game = E.newGame(config, posBoard || undefined);
      if (posBoard) this.game.pos = pos;
      this.touch();
      await this.persist();
      await this.scheduleAlarm();
      await this.syncLobby();
      this.broadcast();
    } else if (message.type === 'sync') {
      try { socket.send(JSON.stringify({ type: 'state', state: this.stateMsg() })); } catch { /* already closed */ }
    }
  }

  async webSocketClose(socket) {
    const attachment = socket.deserializeAttachment() || {};
    const role = attachment.role;
    if ((role !== E.BLUE && role !== E.RED) || this.seats[role] !== attachment.token) return;
    if (this.seatIsOnline(role, socket)) return;

    this.disconnected[role] = Date.now();
    await this.persist();
    await this.scheduleAlarm();
    await this.syncLobby();
    this.broadcast();
  }

  webSocketError(socket) {
    try { socket.close(1011, 'connection error'); } catch { /* already closed */ }
  }

  async alarm() {
    const now = Date.now();
    if (this.expiresAt && now >= this.expiresAt) {
      try { await this.lobby().remove(this.room); } catch (error) {
        logError('room_expiry_lobby_remove_failed', error, { room: this.room });
      }
      const payload = JSON.stringify({ type: 'expired' });
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(payload); socket.close(4002, 'room expired'); } catch { /* already closed */ }
      }
      await this.ctx.storage.deleteAll();
      this.game = null;
      this.seats = { B: null, R: null };
      this.names = { B: null, R: null };
      this.disconnected = { B: null, R: null };
      this.room = null;
      this.expiresAt = 0;
      return;
    }

    // Lichess-style abandonment: 30s gone from a live rated game forfeits it,
    // provided the opponent is still there to win it.
    if (this.ratedLive()) {
      for (const role of [E.BLUE, E.RED]) {
        const since = this.disconnected[role];
        if (since && now - since >= ABANDON_MS && !this.seatIsOnline(role) && this.seatIsOnline(E.other(role))) {
          this.game.gameOver = true;
          this.game.winner = E.other(role);
          this.game.endReason = 'abandon';
          await this.finishRated('abandon', E.other(role));
          await this.persist();
          await this.syncLobby();
          this.broadcast();
          break;
        }
      }
    }

    if (this.releaseExpiredSeats(now)) {
      await this.persist();
      await this.syncLobby();
      this.broadcast();
    }
    await this.scheduleAlarm(now);
  }

  // Record a finished rated game: one D1 transaction covers the match row and both
  // rating updates, and the match id primary key makes any duplicate report a no-op
  // (the insert fails, the whole batch rolls back).
  async finishRated(reason, forcedWinner = null) {
    const game = this.game;
    if (!game || !game.rated || game.recorded) return;
    const players = game.players || {};
    if (!players.B || !players.R) return;
    let winner = forcedWinner;
    if (!winner) {
      const res = E.result(game);
      winner = res.B > res.R ? E.BLUE : res.R > res.B ? E.RED : null;
    }
    const scoreB = winner === E.BLUE ? 1 : winner === E.RED ? 0 : 0.5;
    try {
      const db = this.env.DB;
      const rows = await db.prepare('SELECT id, rating FROM accounts WHERE id IN (?1, ?2)')
        .bind(players.B, players.R).all();
      const ratingOf = Object.fromEntries(rows.results.map((r) => [r.id, r.rating]));
      if (!(players.B in ratingOf) || !(players.R in ratingOf)) {
        logError('rating_account_missing', 'account row vanished', { room: this.room, match: game.matchId });
        return;
      }
      const rb = ratingOf[players.B], rr = ratingOf[players.R];
      const dB = eloDelta(rb, rr, scoreB);
      const dR = eloDelta(rr, rb, 1 - scoreB);
      const now = Date.now();
      const update = (id, delta, won, lost) => db.prepare(
        `UPDATE accounts SET rating = rating + ?2, peak = MAX(peak, rating + ?2), games = games + 1,
         wins = wins + ?3, losses = losses + ?4, draws = draws + ?5, seen_at = ?6 WHERE id = ?1`,
      ).bind(id, delta, won, lost, winner === null ? 1 : 0, now);
      await db.batch([
        db.prepare(
          `INSERT INTO matches (id, blue, red, winner, reason, variant, delta_b, delta_r, rating_b, rating_r, played_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        ).bind(game.matchId, players.B, players.R, winner, reason, E.variantLabel(game.cfg), dB, dR, rb + dB, rr + dR, now),
        update(players.B, dB, winner === E.BLUE ? 1 : 0, winner === E.RED ? 1 : 0),
        update(players.R, dR, winner === E.RED ? 1 : 0, winner === E.BLUE ? 1 : 0),
      ]);
      game.recorded = true;
      game.winner = winner;
      game.endReason = reason;
      game.deltas = { B: dB, R: dR };
      if (this.accounts.B === players.B) this.ratings.B = rb + dB;
      if (this.accounts.R === players.R) this.ratings.R = rr + dR;
    } catch (error) {
      logError('rating_record_failed', error, { room: this.room, match: game.matchId });
    }
  }

  sendError(socket, message) {
    try { socket.send(JSON.stringify({ type: 'error', msg: message })); } catch { /* already closed */ }
  }

  stateMsg() {
    const game = this.game;
    return {
      board: game.board,
      turn: game.turn,
      acts: game.acts || 0,
      moves: game.moves,
      gameOver: game.gameOver,
      lastMove: game.lastMove,
      cfg: game.cfg,
      result: E.result(game),
      names: this.names,
      seats: { B: !!this.seats.B, R: !!this.seats.R },
      online: { B: this.seatIsOnline(E.BLUE), R: this.seatIsOnline(E.RED) },
      rated: !!game.rated,
      pos: game.pos || null,
      winner: game.winner || null,
      endReason: game.endReason || null,
      deltas: game.deltas || null,
      ratings: this.ratings,
      accounts: this.accounts,
    };
  }

  broadcast(excluding = null) {
    const payload = JSON.stringify({ type: 'state', state: this.stateMsg() });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excluding || socket.readyState !== 1) continue;
      try { socket.send(payload); } catch { /* connection will close */ }
    }
  }

  async persist() {
    await this.ctx.storage.put('room', {
      game: this.game,
      seats: this.seats,
      names: this.names,
      disconnected: this.disconnected,
      accounts: this.accounts,
      ratings: this.ratings,
      room: this.room,
      expiresAt: this.expiresAt,
    });
  }

  // Open rooms have a connected host, an available Red seat, and an untouched game.
  async syncLobby() {
    if (!this.room || !this.game) return;
    try {
      const isOpen = this.seats.B
        && this.seatIsOnline(E.BLUE)
        && !this.seats.R
        && !this.game.gameOver
        && this.game.moves.length === 0;
      if (isOpen) {
        await this.lobby().add({
          room: this.room,
          host: this.names.B || 'guest',
          hostId: this.accounts.B,
          rating: this.accounts.B ? this.ratings.B : null,
          variant: E.variantLabel(this.game.cfg),
          cfg: this.game.cfg,
        });
      } else {
        await this.lobby().remove(this.room);
      }
    } catch (error) {
      logError('room_lobby_sync_failed', error, { room: this.room });
    }
  }
}

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS games (
          room TEXT PRIMARY KEY,
          host TEXT NOT NULL,
          variant TEXT NOT NULL,
          cfg TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS games_updated_at ON games(updated_at DESC);
      `);
      // Additive columns for the ratings era; a fresh table gets them via ALTER too.
      for (const ddl of ['ALTER TABLE games ADD COLUMN host_id TEXT', 'ALTER TABLE games ADD COLUMN rating REAL']) {
        try { ctx.storage.sql.exec(ddl); } catch { /* column already exists */ }
      }

      // One-time, lossless migration from the original whole-object KV index.
      const legacy = await ctx.storage.get('games');
      if (legacy && typeof legacy === 'object') {
        for (const entry of Object.values(legacy)) {
          const room = cleanRoom(entry?.room);
          if (!room) continue;
          const config = E.sanitizeCfg(entry.cfg);
          ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO games (room, host, variant, cfg, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            room,
            cleanName(entry.host),
            E.variantLabel(config),
            JSON.stringify(config),
            Number.isFinite(entry.ts) ? entry.ts : Date.now(),
          );
        }
        await ctx.storage.delete('games');
      }
    });
  }

  prune(now = Date.now()) {
    this.ctx.storage.sql.exec('DELETE FROM games WHERE updated_at < ?', now - ROOM_TTL_MS);
  }

  async add(entry) {
    const room = cleanRoom(entry?.room);
    if (!room) return;
    const config = E.sanitizeCfg(entry.cfg);
    this.prune();
    this.ctx.storage.sql.exec(
      `INSERT INTO games (room, host, host_id, rating, variant, cfg, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET
         host = excluded.host,
         host_id = excluded.host_id,
         rating = excluded.rating,
         variant = excluded.variant,
         cfg = excluded.cfg,
         updated_at = excluded.updated_at`,
      room,
      cleanName(entry.host),
      cleanAccountId(entry.hostId) || null,
      Number.isFinite(entry.rating) ? entry.rating : null,
      E.variantLabel(config),
      JSON.stringify(config),
      Date.now(),
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM games WHERE room NOT IN
       (SELECT room FROM games ORDER BY updated_at DESC LIMIT ?)`,
      LOBBY_LIMIT,
    );
  }

  async remove(room) {
    this.ctx.storage.sql.exec('DELETE FROM games WHERE room = ?', cleanRoom(room));
  }

  async list() {
    this.prune();
    return this.ctx.storage.sql.exec(
      'SELECT room, host, host_id, rating, variant, cfg, updated_at AS ts FROM games ORDER BY updated_at DESC LIMIT 40',
    ).toArray().map((row) => {
      let config;
      try { config = E.sanitizeCfg(JSON.parse(row.cfg)); } catch { config = E.sanitizeCfg({}); }
      return { room: row.room, host: row.host, hostId: row.host_id, rating: row.rating, variant: row.variant, cfg: config, ts: row.ts };
    });
  }
}

// Application-level metrics for the admin page: everything derivable from D1 plus the
// open-game index. Infrastructure metrics (requests, CPU, errors) live in the CF dashboard.
async function adminStats(env) {
  const now = Date.now();
  const DAY = 86400000;
  const one = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first()) || {};
  const many = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results || [];

  const accounts = await one('SELECT COUNT(*) AS total, AVG(rating) AS avgRating, MAX(rating) AS maxRating FROM accounts');
  const new24 = (await one('SELECT COUNT(*) AS n FROM accounts WHERE created_at > ?1', now - DAY)).n;
  const new7 = (await one('SELECT COUNT(*) AS n FROM accounts WHERE created_at > ?1', now - 7 * DAY)).n;
  const active24 = (await one('SELECT COUNT(*) AS n FROM accounts WHERE seen_at > ?1', now - DAY)).n;
  const active7 = (await one('SELECT COUNT(*) AS n FROM accounts WHERE seen_at > ?1', now - 7 * DAY)).n;

  const matches = await one('SELECT COUNT(*) AS total, SUM(CASE WHEN reason = \'abandon\' THEN 1 ELSE 0 END) AS abandoned, SUM(CASE WHEN winner IS NULL THEN 1 ELSE 0 END) AS draws FROM matches');
  const matches24 = (await one('SELECT COUNT(*) AS n FROM matches WHERE played_at > ?1', now - DAY)).n;
  const matches7 = (await one('SELECT COUNT(*) AS n FROM matches WHERE played_at > ?1', now - 7 * DAY)).n;

  const top = await many('SELECT id, name, rating, peak, games, wins, losses, draws, seen_at FROM accounts WHERE games > 0 ORDER BY rating DESC LIMIT 15');
  const newest = await many('SELECT id, name, rating, games, created_at, seen_at FROM accounts ORDER BY created_at DESC LIMIT 15');
  const recent = await many(
    `SELECT m.id, m.winner, m.reason, m.variant, m.delta_b, m.delta_r, m.rating_b, m.rating_r, m.played_at,
            ab.name AS blueName, ar.name AS redName, m.blue AS blueId, m.red AS redId
     FROM matches m JOIN accounts ab ON ab.id = m.blue JOIN accounts ar ON ar.id = m.red
     ORDER BY m.played_at DESC LIMIT 25`,
  );

  let openGames = [];
  try { openGames = await env.LOBBY.getByName('global').list(); } catch { /* lobby optional */ }

  return {
    now,
    users: {
      total: accounts.total || 0,
      new24, new7, active24, active7,
      avgRating: accounts.avgRating ? Math.round(accounts.avgRating) : null,
      maxRating: accounts.maxRating ? Math.round(accounts.maxRating) : null,
    },
    games: {
      total: matches.total || 0,
      abandoned: matches.abandoned || 0,
      draws: matches.draws || 0,
      last24: matches24, last7: matches7,
      openNow: openGames.length,
    },
    top, newest, recent,
    openGames: openGames.map((g) => ({ room: g.room, host: g.host, rating: g.rating, variant: g.variant, ts: g.ts })),
  };
}

const json = (value, init = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=0, s-maxage=3, stale-while-revalidate=6');
  headers.set('x-content-type-options', 'nosniff');
  return Response.json(value, { ...init, headers });
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/ws') {
        if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return new Response('forbidden origin', { status: 403 });
        const room = cleanRoom(url.searchParams.get('room'));
        if (!room) return new Response('missing room', { status: 400 });
        return env.ROOM.getByName(room).fetch(request);
      }
      if (url.pathname.startsWith('/api/account')) {
        const noStore = { 'cache-control': 'no-store' };
        if (request.method !== 'POST') {
          return json({ error: 'method not allowed' }, { status: 405, headers: { allow: 'POST', ...noStore } });
        }
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return json({ error: 'forbidden origin' }, { status: 403, headers: noStore });
        const body = await readJson(request);
        if (!body) return json({ error: 'bad request' }, { status: 400, headers: noStore });

        if (url.pathname === '/api/account') {
          const name = cleanName(body.name);
          const id = newAccountId();
          const secret = newSecret();
          const now = Date.now();
          await env.DB.prepare('INSERT INTO accounts (id, secret_hash, name, created_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?4)')
            .bind(id, await sha256hex(secret), name, now).run();
          return json({ id, secret, name, rating: START_RATING }, { headers: noStore });
        }

        const id = cleanAccountId(body.id);
        const secret = (body.secret || '').toString();
        if (!id || !secret || secret.length > 64) return json({ error: 'invalid credentials' }, { status: 403, headers: noStore });
        const account = await env.DB.prepare(
          'SELECT id, name, rating, peak, games, wins, losses, draws FROM accounts WHERE id = ?1 AND secret_hash = ?2',
        ).bind(id, await sha256hex(secret)).first();
        if (!account) return json({ error: 'invalid credentials' }, { status: 403, headers: noStore });

        if (url.pathname === '/api/account/verify') return json({ account }, { headers: noStore });
        if (url.pathname === '/api/account/name') {
          const name = cleanName(body.name);
          await env.DB.prepare('UPDATE accounts SET name = ?2, seen_at = ?3 WHERE id = ?1').bind(id, name, Date.now()).run();
          return json({ ok: true, name }, { headers: noStore });
        }
        return json({ error: 'not found' }, { status: 404, headers: noStore });
      }
      if (url.pathname === '/api/admin/stats') {
        const noStore = { 'cache-control': 'no-store' };
        if (request.method !== 'POST') {
          return json({ error: 'method not allowed' }, { status: 405, headers: { allow: 'POST', ...noStore } });
        }
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return json({ error: 'forbidden origin' }, { status: 403, headers: noStore });
        const body = await readJson(request);
        const key = body && typeof body.key === 'string' ? body.key : '';
        if (!(await safeEqual(key, env.ADMIN_KEY))) {
          await new Promise((resolve) => setTimeout(resolve, 400));   // throttle brute force
          return json({ error: 'unauthorized' }, { status: 401, headers: noStore });
        }
        const stats = await adminStats(env);
        return json({ stats }, { headers: noStore });
      }
      if (url.pathname === '/api/profile') {
        const noStore = { 'cache-control': 'no-store' };
        if (request.method !== 'GET') {
          return json({ error: 'method not allowed' }, { status: 405, headers: { allow: 'GET', ...noStore } });
        }
        const id = cleanAccountId(url.searchParams.get('id'));
        if (!id) return json({ error: 'missing id' }, { status: 400, headers: noStore });
        const account = await env.DB.prepare(
          'SELECT id, name, rating, peak, games, wins, losses, draws, created_at FROM accounts WHERE id = ?1',
        ).bind(id).first();
        if (!account) return json({ error: 'not found' }, { status: 404, headers: noStore });
        const matches = await env.DB.prepare(
          `SELECT m.blue, m.red, m.winner, m.reason, m.variant, m.delta_b, m.delta_r, m.played_at,
                  ab.name AS blue_name, ar.name AS red_name
           FROM matches m JOIN accounts ab ON ab.id = m.blue JOIN accounts ar ON ar.id = m.red
           WHERE m.blue = ?1 OR m.red = ?1 ORDER BY m.played_at DESC LIMIT 20`,
        ).bind(id).all();
        return json({ account, matches: matches.results }, { headers: noStore });
      }
      if (url.pathname === '/api/lobby') {
        if (request.method !== 'GET') {
          return json({ error: 'method not allowed' }, {
            status: 405,
            headers: { allow: 'GET', 'cache-control': 'no-store' },
          });
        }
        const cacheKey = new Request(`${url.origin}/api/lobby`, { method: 'GET' });
        const cached = await caches.default.match(cacheKey);
        if (cached) return cached;
        const games = await env.LOBBY.getByName('global').list();
        const response = json({ games });
        ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
        return response;
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      logError('request_failed', error, { method: request.method, path: url.pathname });
      return json({ error: 'service temporarily unavailable' }, {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      });
    }
  },
};
