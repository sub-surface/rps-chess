// JANKEN worker — serves the static game and hosts online rooms.
// GameRoom (one DO per room) holds authoritative state & validates every move server-side.
// Lobby (one global DO) tracks open games so players can always find a match.
import { DurableObject } from 'cloudflare:workers';
import * as E from '../public/engine.js';

const cleanName = (n) => (n || '').toString().replace(/[^\w \-]/g, '').trim().slice(0, 20) || 'guest';
const cleanTok = (t) => (t || '').toString().replace(/[^a-z0-9]/gi, '').slice(0, 32);
const IDLE_MS = 30 * 60 * 1000;

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = null;
    this.seats = { B: null, R: null };
    this.names = { B: null, R: null };
    this.room = null;
    ctx.blockConcurrencyWhile(async () => {
      const s = await ctx.storage.get('room');
      if (s) { this.game = s.game; this.seats = s.seats; this.names = s.names || { B: null, R: null }; this.room = s.room; }
    });
  }

  lobby() { return this.env.LOBBY.getByName('global'); }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    this.room = url.searchParams.get('room') || this.room;
    const token = cleanTok(url.searchParams.get('token')) || crypto.randomUUID().replace(/-/g, '');
    const name = cleanName(url.searchParams.get('name'));

    if (!this.game) {
      let cfg = { size: 9, perType: 2, moveStyle: 'classic', capture: 'rps', territory: true, retread: false, first: E.BLUE };
      const raw = url.searchParams.get('cfg');
      if (raw) { try { cfg = E.sanitizeCfg(JSON.parse(atob(raw))); } catch { } }
      this.game = E.newGame(cfg);
    }

    let role;
    if (this.seats.B === token) role = 'B';
    else if (this.seats.R === token) role = 'R';
    else if (!this.seats.B) { this.seats.B = token; this.names.B = name; role = 'B'; }
    else if (!this.seats.R) { this.seats.R = token; this.names.R = name; role = 'R'; }
    else role = 'S';
    await this.persist();
    await this.syncLobby();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, token });
    server.send(JSON.stringify({ type: 'welcome', role, token, state: this.stateMsg() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);

    if (msg.type === 'move') {
      if (this.game.gameOver || att.role !== this.game.turn) return this.err(ws, 'not your turn');
      const f = msg.from, t = msg.to;
      if (!Array.isArray(f) || !Array.isArray(t)) return;
      const m = { fr: f[0] | 0, fc: f[1] | 0, tr: t[0] | 0, tc: t[1] | 0 };
      if (!E.isLegal(this.game.board, m, this.game.turn, this.game.cfg)) return this.err(ws, 'illegal move');
      E.applyMove(this.game, m);
      await this.persist(); this.broadcast();
    } else if (msg.type === 'new') {
      if (att.role !== 'B' && att.role !== 'R') return;
      this.game = E.newGame(msg.cfg ? E.sanitizeCfg(msg.cfg) : this.game.cfg);
      await this.persist(); await this.syncLobby(); this.broadcast();
    } else if (msg.type === 'sync') {
      ws.send(JSON.stringify({ type: 'state', state: this.stateMsg() }));
    }
  }

  webSocketError(ws) { try { ws.close(1011); } catch { } }
  async alarm() { try { await this.lobby().remove(this.room); } catch { } }

  err(ws, msg) { try { ws.send(JSON.stringify({ type: 'error', msg })); } catch { } }
  stateMsg() {
    const g = this.game;
    return { board: g.board, turn: g.turn, acts: g.acts || 0, moves: g.moves, gameOver: g.gameOver, lastMove: g.lastMove, cfg: g.cfg, result: E.result(g), names: this.names, seats: { B: !!this.seats.B, R: !!this.seats.R } };
  }
  broadcast() {
    const s = JSON.stringify({ type: 'state', state: this.stateMsg() });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch { } }
  }
  async persist() { await this.ctx.storage.put('room', { game: this.game, seats: this.seats, names: this.names, room: this.room }); }
  // A room is "open" (listed in the lobby) while it has a host but no second player.
  async syncLobby() {
    if (!this.room) return;
    try {
      if (this.seats.B && !this.seats.R && !this.game.gameOver && this.game.moves.length === 0)
        await this.lobby().add({ room: this.room, host: this.names.B || 'guest', variant: E.variantLabel(this.game.cfg), cfg: this.game.cfg });
      else
        await this.lobby().remove(this.room);
    } catch { }
  }
}

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.games = {};
    ctx.blockConcurrencyWhile(async () => { this.games = (await ctx.storage.get('games')) || {}; });
  }
  async add(entry) { this.games[entry.room] = { ...entry, ts: Date.now() }; await this.save(); }
  async remove(room) { if (this.games[room]) { delete this.games[room]; await this.save(); } }
  async list() {
    const now = Date.now(); let changed = false;
    for (const k in this.games) if (now - this.games[k].ts > 20 * 60 * 1000) { delete this.games[k]; changed = true; }
    if (changed) await this.save();
    return Object.values(this.games).sort((a, b) => b.ts - a.ts).slice(0, 40);
  }
  async save() { await this.ctx.storage.put('games', this.games); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const room = (url.searchParams.get('room') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
      if (!room) return new Response('missing room', { status: 400 });
      return env.ROOM.getByName(room).fetch(request);
    }
    if (url.pathname === '/api/lobby') {
      const games = await env.LOBBY.getByName('global').list();
      return Response.json({ games }, { headers: { 'cache-control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  },
};
