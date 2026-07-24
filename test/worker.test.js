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
