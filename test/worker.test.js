import { env, exports } from 'cloudflare:workers';
import { runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as E from '../public/engine.js';

function nextMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for WebSocket message'));
    }, 3000);
    const onMessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      resolve(message);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function connect(stub, room, params = {}) {
  const query = new URLSearchParams({ room, name: params.name || 'tester' });
  if (params.token) query.set('token', params.token);
  if (params.cfg) query.set('cfg', btoa(JSON.stringify(params.cfg)));
  const response = await stub.fetch(`https://example.com/ws?${query}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error('expected WebSocket');
  const welcome = nextMessage(socket, (message) => message.type === 'welcome');
  socket.accept();
  return { socket, welcome: await welcome };
}

describe('Lobby Durable Object', () => {
  it('stores bounded entries in SQLite and removes them individually', async () => {
    const lobby = env.LOBBY.getByName('sql-lobby');
    await lobby.add({ room: 'alpha', host: 'Alice', cfg: E.PRESETS.standard });
    await lobby.add({ room: 'beta', host: 'Bob', cfg: E.PRESETS.kings });
    expect((await lobby.list()).map((entry) => entry.room).sort()).toEqual(['alpha', 'beta']);

    await runInDurableObject(lobby, async (_instance, state) => {
      const count = state.storage.sql.exec('SELECT COUNT(*) AS count FROM games').one().count;
      expect(count).toBe(2);
    });

    await lobby.remove('alpha');
    expect((await lobby.list()).map((entry) => entry.room)).toEqual(['beta']);
  });
});

describe('GameRoom Durable Object', () => {
  it('assigns seats, fills backward-compatible defaults, and validates moves', async () => {
    const room = 'roles-and-moves';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    expect(host.welcome.role).toBe(E.BLUE);
    expect(host.welcome.state.cfg.actionsPerTurn).toBe(1);
    expect(host.welcome.state.online.B).toBe(true);

    const guest = await connect(stub, room, { name: 'Guest' });
    expect(guest.welcome.role).toBe(E.RED);
    const spectator = await connect(stub, room, { name: 'Viewer' });
    expect(spectator.welcome.role).toBe('S');

    const rejected = nextMessage(spectator.socket, (message) => message.type === 'error');
    spectator.socket.send(JSON.stringify({ type: 'move', from: [0, 0], to: [1, 0] }));
    expect((await rejected).msg).toBe('not your turn');

    const move = E.allMoves(host.welcome.state.board, E.BLUE, host.welcome.state.cfg)[0];
    const updated = nextMessage(guest.socket, (message) => message.type === 'state' && message.state.moves.length === 1);
    host.socket.send(JSON.stringify({ type: 'move', from: [move.fr, move.fc], to: [move.tr, move.tc] }));
    expect((await updated).state.moves).toHaveLength(1);

    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
    spectator.socket.close(1000, 'done');
  });

  it('honours a valid custom starting position and keeps it for rematches', async () => {
    const room = 'challenge-pos';
    const pos = 'R' + '.'.repeat(34) + 's';   // 6×6: Blue rock at a6-corner, Red scissors opposite
    const cfg = { ...E.PRESETS.standard, size: 6, pos };
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host', cfg });
    expect(host.welcome.state.pos).toBe(pos);
    expect(host.welcome.state.board[0][0].piece).toEqual({ type: 'rock', color: E.BLUE });
    expect(host.welcome.state.board[5][5].piece).toEqual({ type: 'scissors', color: E.RED });
    expect(E.pieceCounts(host.welcome.state.board)).toEqual({ B: 1, R: 1 });
    host.socket.close(1000, 'done');
  });

  it('reclaims the same seat token and fences its older connection', async () => {
    const room = 'seat-reconnect';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    const guest = await connect(stub, room, { name: 'Guest' });
    const closed = new Promise((resolve) => guest.socket.addEventListener('close', resolve, { once: true }));
    const replacement = await connect(stub, room, { name: 'Guest again', token: guest.welcome.token });
    expect(replacement.welcome.role).toBe(E.RED);
    expect((await closed).code).toBe(4000);

    host.socket.close(1000, 'done');
    replacement.socket.close(1000, 'done');
  });

  it('releases a disconnected seat after its grace alarm', async () => {
    const room = 'seat-grace';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    const guest = await connect(stub, room, { name: 'Guest' });
    guest.socket.close(1000, 'done');

    let disconnected = false;
    for (let attempt = 0; attempt < 20 && !disconnected; attempt++) {
      disconnected = await runInDurableObject(stub, async (instance) => !!instance.disconnected.R);
      if (!disconnected) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(disconnected).toBe(true);

    await runInDurableObject(stub, async (instance, state) => {
      instance.disconnected.R = Date.now() - 61_000;
      await instance.persist();
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (instance) => {
      expect(instance.seats.R).toBeNull();
    });

    const replacement = await connect(stub, room, { name: 'Replacement' });
    expect(replacement.welcome.role).toBe(E.RED);
    host.socket.close(1000, 'done');
    replacement.socket.close(1000, 'done');
  });

  it('deletes expired room storage when its alarm runs', async () => {
    const room = 'expiry';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    await runInDurableObject(stub, async (instance, state) => {
      instance.expiresAt = Date.now() - 1;
      await instance.persist();
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get('room')).toBeUndefined();
    });
    host.socket.close(1000, 'done');
  });
});

describe('accounts and ratings', () => {
  async function createAccount(name) {
    const response = await exports.default.fetch('https://example.com/api/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  const post = (path, body) => exports.default.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('creates, verifies, renames, and serves profiles', async () => {
    const created = await createAccount('Ana');
    expect(created.id).toMatch(/^[a-z0-9]{10}$/);
    expect(created.secret).toMatch(/^[a-f0-9]{32}$/);
    expect(created.rating).toBe(1200);

    const verified = await post('/api/account/verify', { id: created.id, secret: created.secret });
    expect(verified.status).toBe(200);
    expect((await verified.json()).account.name).toBe('Ana');

    const rejected = await post('/api/account/verify', { id: created.id, secret: 'wrong' });
    expect(rejected.status).toBe(403);

    const renamed = await post('/api/account/name', { id: created.id, secret: created.secret, name: 'Ana Prime' });
    expect((await renamed.json()).name).toBe('Ana Prime');

    const profile = await exports.default.fetch(`https://example.com/api/profile?id=${created.id}`);
    expect(profile.status).toBe(200);
    const body = await profile.json();
    expect(body.account.name).toBe('Ana Prime');
    expect(body.account.secret_hash).toBeUndefined();
    expect(body.matches).toEqual([]);
  });

  it('rates an abandoned game exactly once', async () => {
    const ana = await createAccount('Ana');
    const bo = await createAccount('Bo');
    const room = 'rated-abandon';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'host' });
    const guest = await connect(stub, room, { name: 'guest' });

    const hostBound = nextMessage(host.socket, (m) => m.type === 'state' && m.state.accounts?.B === ana.id);
    host.socket.send(JSON.stringify({ type: 'auth', id: ana.id, secret: ana.secret }));
    await hostBound;
    const guestBound = nextMessage(host.socket, (m) => m.type === 'state' && m.state.accounts?.R === bo.id);
    guest.socket.send(JSON.stringify({ type: 'auth', id: bo.id, secret: bo.secret }));
    await guestBound;

    const move = E.allMoves(host.welcome.state.board, E.BLUE, host.welcome.state.cfg)[0];
    const afterMove = nextMessage(host.socket, (m) => m.type === 'state' && m.state.moves.length === 1);
    host.socket.send(JSON.stringify({ type: 'move', from: [move.fr, move.fc], to: [move.tr, move.tc] }));
    expect((await afterMove).state.rated).toBe(true);

    guest.socket.close(1000, 'rage quit');
    let disconnected = false;
    for (let attempt = 0; attempt < 20 && !disconnected; attempt++) {
      disconnected = await runInDurableObject(stub, async (instance) => !!instance.disconnected.R);
      if (!disconnected) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(disconnected).toBe(true);

    await runInDurableObject(stub, async (instance, state) => {
      instance.disconnected.R = Date.now() - 31_000;
      await instance.persist();
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    await runInDurableObject(stub, async (instance) => {
      expect(instance.game.gameOver).toBe(true);
      expect(instance.game.winner).toBe(E.BLUE);
      expect(instance.game.endReason).toBe('abandon');
      expect(instance.game.recorded).toBe(true);
      await instance.finishRated('board');   // duplicate report must be a no-op
    });

    const winner = await env.DB.prepare('SELECT rating, peak, wins, games FROM accounts WHERE id = ?1').bind(ana.id).first();
    const loser = await env.DB.prepare('SELECT rating, peak, losses, games FROM accounts WHERE id = ?1').bind(bo.id).first();
    expect(winner.rating).toBe(1216);
    expect(winner.peak).toBe(1216);
    expect(winner.wins).toBe(1);
    expect(winner.games).toBe(1);
    expect(loser.rating).toBe(1184);
    expect(loser.peak).toBe(1200);
    expect(loser.losses).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n).toBe(1);

    const profile = await exports.default.fetch(`https://example.com/api/profile?id=${ana.id}`);
    const body = await profile.json();
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].winner).toBe('B');
    expect(body.matches[0].reason).toBe('abandon');

    host.socket.close(1000, 'done');
  });
});

describe('Worker routes', () => {
  it('rejects lobby mutations and cross-origin browser sockets', async () => {
    const method = await exports.default.fetch('https://example.com/api/lobby', { method: 'POST' });
    expect(method.status).toBe(405);
    expect(method.headers.get('cache-control')).toBe('no-store');
    const lobby = await exports.default.fetch('https://example.com/api/lobby');
    expect(lobby.status).toBe(200);
    expect(lobby.headers.get('cache-control')).toContain('s-maxage=3');
    const origin = await exports.default.fetch('https://example.com/ws?room=safe', {
      headers: { Upgrade: 'websocket', Origin: 'https://attacker.example' },
    });
    expect(origin.status).toBe(403);
  });
});
