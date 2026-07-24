// JANKEN worker — serves the static game and hosts online rooms.
// GameRoom is authoritative for one match. Lobby is a compact global room index.
import { DurableObject } from 'cloudflare:workers';
import * as E from '../public/engine.js';

const ROOM_TTL_MS = 30 * 60 * 1000;
const SEAT_GRACE_MS = 60 * 1000;
const LOBBY_LIMIT = 100;
const MAX_SPECTATORS = 32;
const MAX_MESSAGES_PER_SECOND = 40;

const cleanName = (value) =>
  (value || '').toString().replace(/[^\w \-]/g, '').trim().slice(0, 20) || 'guest';
const cleanToken = (value) =>
  (value || '').toString().replace(/[^a-z0-9]/gi, '').slice(0, 32);
const cleanRoom = (value) =>
  (value || '').toString().replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
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
        changed = true;
      }
    }
    return changed;
  }

  touch(now = Date.now()) {
    this.expiresAt = now + ROOM_TTL_MS;
  }

  async scheduleAlarm(now = Date.now()) {
    const deadlines = [this.expiresAt || now + ROOM_TTL_MS];
    for (const role of [E.BLUE, E.RED]) {
      if (this.seats[role] && this.disconnected[role]) {
        deadlines.push(this.disconnected[role] + SEAT_GRACE_MS);
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
      const raw = url.searchParams.get('cfg');
      if (raw && raw.length <= 4096) {
        try {
          config = E.sanitizeCfg(JSON.parse(atob(raw)));
        } catch {
          // A malformed optional host config simply falls back to Standard.
        }
      }
      this.game = E.newGame(config);
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
      E.applyMove(this.game, move);
      this.touch();
      await this.persist();
      await this.scheduleAlarm();
      await this.syncLobby();
      this.broadcast();
    } else if (message.type === 'new') {
      if (!seated) return;
      const config = attachment.role === E.BLUE && message.cfg ? E.sanitizeCfg(message.cfg) : this.game.cfg;
      this.game = E.newGame(config);
      this.touch();
      await this.persist();
      await this.scheduleAlarm();
      await this.syncLobby();
      this.broadcast();
    } else if (message.type === 'sync') {
      socket.send(JSON.stringify({ type: 'state', state: this.stateMsg() }));
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

    if (this.releaseExpiredSeats(now)) {
      await this.persist();
      await this.syncLobby();
      this.broadcast();
    }
    await this.scheduleAlarm(now);
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
      `INSERT INTO games (room, host, variant, cfg, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET
         host = excluded.host,
         variant = excluded.variant,
         cfg = excluded.cfg,
         updated_at = excluded.updated_at`,
      room,
      cleanName(entry.host),
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
      'SELECT room, host, variant, cfg, updated_at AS ts FROM games ORDER BY updated_at DESC LIMIT 40',
    ).toArray().map((row) => {
      let config;
      try { config = E.sanitizeCfg(JSON.parse(row.cfg)); } catch { config = E.sanitizeCfg({}); }
      return { room: row.room, host: row.host, variant: row.variant, cfg: config, ts: row.ts };
    });
  }
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
