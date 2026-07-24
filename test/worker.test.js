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
  it('updates the global lobby only when a room changes index state', async () => {
    const room = 'lobby-transition';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    const lobby = env.LOBBY.getByName('global');
    const before = (await lobby.list()).find((entry) => entry.room === room);
    expect(before).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 15));
    await runInDurableObject(stub, async (instance, state) => {
      await instance.syncLobby();
      await instance.syncLobby();
      expect(instance.lobbyListed).toBe(true);
      expect((await state.storage.get('lobbyIndex')).listed).toBe(true);
    });
    const unchanged = (await lobby.list()).find((entry) => entry.room === room);
    expect(unchanged.ts).toBe(before.ts);

    const guest = await connect(stub, room, { name: 'Guest' });
    expect((await lobby.list()).some((entry) => entry.room === room)).toBe(false);
    await runInDurableObject(stub, async (instance, state) => {
      expect(instance.lobbyListed).toBe(false);
      expect((await state.storage.get('lobbyIndex')).listed).toBe(false);
    });
    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
  });

  it('assigns seats, fills backward-compatible defaults, and validates moves', async () => {
    const room = 'roles-and-moves';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    expect(host.welcome.role).toBe(E.BLUE);
    expect(host.welcome.state.cfg.actionsPerTurn).toBe(1);
    expect(host.welcome.state.cfg.territory).toBe(false);   // Standard does not paint
    expect(host.welcome.state.cfg.retread).toBe(false);
    expect(host.welcome.state.cfg.enclosure).toBe(false);
    expect(host.welcome.state.cfg.threefold).toBe(true);
    expect(host.welcome.state.cfg).toMatchObject({
      rockMove: 'king',
      paperMove: 'king',
      scissorsMove: 'king',
    });
    expect(host.welcome.state.board[3][1].piece).toEqual({ type: 'rock', color: E.BLUE });
    expect(host.welcome.state.board[5][7].piece).toEqual({ type: 'rock', color: E.RED });
    expect(host.welcome.state.startPos).toHaveLength(81);
    expect(host.welcome.state.startOwners).toHaveLength(81);
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
    const moved = (await updated).state.moves;
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      c: E.BLUE,
      from: [move.fr, move.fc],
      to: [move.tr, move.tc],
    });

    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
    spectator.socket.close(1000, 'done');
  });

  it('adjudicates threefold repetition from authoritative room state', async () => {
    const room = 'threefold-room';
    const board = E.emptyBoard(6);
    board[5][0] = { owner: E.BLUE, piece: { type: 'rock', color: E.BLUE } };
    board[5][2] = { owner: E.BLUE, piece: { type: 'scissors', color: E.BLUE } };
    board[0][5] = { owner: E.RED, piece: { type: 'paper', color: E.RED } };
    const cfg = {
      ...E.PRESETS.standard,
      size: 6,
      perType: 1,
      capture: 'chess',
      pos: E.encodePos(board),
      own: E.encodeOwners(board),
    };
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host', cfg });
    const guest = await connect(stub, room, { name: 'Guest' });
    const cycle = [
      { from: [5, 0], to: [4, 0] },
      { from: [0, 5], to: [1, 5] },
      { from: [4, 0], to: [5, 0] },
      { from: [1, 5], to: [0, 5] },
    ];

    let final = null;
    for (let ply = 0; ply < 8; ply++) {
      const active = ply % 2 === 0 ? host.socket : guest.socket;
      const observer = ply % 2 === 0 ? guest.socket : host.socket;
      const updated = nextMessage(observer, (message) =>
        message.type === 'state' && message.state.moves.length === ply + 1);
      active.send(JSON.stringify({ type: 'move', ...cycle[ply % cycle.length] }));
      final = (await updated).state;
    }

    expect(final.gameOver).toBe(true);
    expect(final.endReason).toBe('repetition');
    expect(final.winner).toBeNull();
    expect(final.result).toMatchObject({ B: 2, R: 1, metric: 'pieces' });
    await runInDurableObject(stub, async (instance) => {
      expect(instance.game.repetitions[E.repetitionKey(instance.game)]).toBe(3);
    });

    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
  });

  it('honours a valid custom starting position and keeps it for rematches', async () => {
    const room = 'challenge-pos';
    const pos = 'R' + '.'.repeat(34) + 's';   // 6×6: Blue rock at a6-corner, Red scissors opposite
    const own = 'BB' + '.'.repeat(33) + 'R';
    const cfg = { ...E.PRESETS.standard, size: 6, pos, own };
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host', cfg });
    expect(host.welcome.state.pos).toBe(pos);
    expect(host.welcome.state.board[0][0].piece).toEqual({ type: 'rock', color: E.BLUE });
    expect(host.welcome.state.board[5][5].piece).toEqual({ type: 'scissors', color: E.RED });
    expect(host.welcome.state.board[0][1].owner).toBe(E.BLUE);
    expect(host.welcome.state.own).toBe(own);
    expect(E.pieceCounts(host.welcome.state.board)).toEqual({ B: 1, R: 1 });
    host.socket.close(1000, 'done');
  });

  it('archives a completed game for the public replay theatre', async () => {
    const room = 'showcase-finish';
    const pos = '.'.repeat(14) + 'Rs' + '.'.repeat(20);
    const own = '.'.repeat(14) + 'BR' + '.'.repeat(20);
    const cfg = {
      ...E.PRESETS.standard,
      size: 6,
      perType: 1,
      territory: false,
      retread: false,
      pos,
      own,
    };
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Blue Hero', cfg });
    const guest = await connect(stub, room, { name: 'Red Hero' });
    const finished = nextMessage(host.socket, (message) => message.type === 'state' && message.state.gameOver);
    host.socket.send(JSON.stringify({ type: 'move', from: [2, 2], to: [2, 3] }));
    const state = (await finished).state;
    expect(state.endReason).toBe('elimination');

    let stored = null;
    for (let attempt = 0; attempt < 40 && !stored; attempt++) {
      stored = await env.DB.prepare('SELECT payload FROM showcases ORDER BY played_at DESC LIMIT 1').first();
      if (!stored) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(stored).toBeTruthy();
    const replay = JSON.parse(stored.payload);
    expect(replay.names).toEqual({ B: 'Blue Hero', R: 'Red Hero' });
    expect(replay.moves).toHaveLength(1);
    expect(replay.cfg.rockMove).toBe('king');

    const response = await exports.default.fetch('https://showcase.example/api/showcase');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=30');
    const body = await response.json();
    expect(body.games[0].id).toBe(replay.id);
    expect(body.games[0].startOwners).toBe(own);
    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
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

  it('relays ephemeral chat from seated players and ignores spectators', async () => {
    const room = 'chat-room';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    const guest = await connect(stub, room, { name: 'Guest' });
    const spectator = await connect(stub, room, { name: 'Viewer' });
    const before = await runInDurableObject(stub, async (instance, state) => ({
      expiresAt: instance.expiresAt,
      storedExpiresAt: (await state.storage.get('room')).expiresAt,
    }));

    const gotByGuest = nextMessage(guest.socket, (m) => m.type === 'chat');
    const gotBySpec = nextMessage(spectator.socket, (m) => m.type === 'chat');
    host.socket.send(JSON.stringify({ type: 'chat', text: '  hi   there  ' }));
    const relayed = await gotByGuest;
    expect(relayed.role).toBe(E.BLUE);
    expect(relayed.name).toBe('Host');
    expect(relayed.text).toBe('hi there');            // trimmed and whitespace-collapsed
    expect((await gotBySpec).text).toBe('hi there');  // spectators can read
    const after = await runInDurableObject(stub, async (instance, state) => ({
      expiresAt: instance.expiresAt,
      storedExpiresAt: (await state.storage.get('room')).expiresAt,
    }));
    expect(after).toEqual(before);                     // chat creates no room-storage writes

    let sawSpectatorChat = false;
    guest.socket.addEventListener('message', (e) => {
      try { const m = JSON.parse(e.data); if (m.type === 'chat' && m.text === 'noise') sawSpectatorChat = true; } catch { /* ignore */ }
    });
    spectator.socket.send(JSON.stringify({ type: 'chat', text: 'noise' }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sawSpectatorChat).toBe(false);             // spectators cannot send

    const throttled = nextMessage(host.socket, (m) => m.type === 'error' && m.msg === 'chat rate exceeded');
    for (let index = 0; index < 8; index++) {
      host.socket.send(JSON.stringify({ type: 'chat', text: `burst ${index}` }));
    }
    expect((await throttled).msg).toBe('chat rate exceeded');

    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
    spectator.socket.close(1000, 'done');
  });
});

// Both of the defects these cover lived in transitions *between* games in one room —
// rematch and room recycling — which single-game tests never exercise.
describe('room lifecycle', () => {
  async function createAccount(name) {
    const response = await exports.default.fetch('https://example.com/api/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return response.json();
  }
  async function expire(stub) {
    await runInDurableObject(stub, async (instance, state) => {
      instance.expiresAt = Date.now() - 1;
      await instance.persist();
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await runDurableObjectAlarm(stub);
    let expired = false;
    for (let attempt = 0; attempt < 40 && !expired; attempt++) {
      expired = await runInDurableObject(stub, async (instance) => instance.game === null);
      if (!expired) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(expired).toBe(true);
  }

  it('refuses to discard a game that is already under way', async () => {
    const room = 'no-escape';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host' });
    const guest = await connect(stub, room, { name: 'Guest' });

    const move = E.allMoves(host.welcome.state.board, E.BLUE, host.welcome.state.cfg)[0];
    const started = nextMessage(host.socket, (m) => m.type === 'state' && m.state.moves.length === 1);
    host.socket.send(JSON.stringify({ type: 'move', from: [move.fr, move.fc], to: [move.tr, move.tc] }));
    await started;

    const refused = nextMessage(guest.socket, (m) => m.type === 'error');
    guest.socket.send(JSON.stringify({ type: 'new' }));
    expect((await refused).msg).toBe('finish or resign this game first');
    await runInDurableObject(stub, async (instance) => {
      expect(instance.game.moves).toHaveLength(1);   // the game survived
    });

    // Resigning ends it, and only then may the room start a fresh game.
    const over = nextMessage(guest.socket, (m) => m.type === 'state' && m.state.gameOver);
    guest.socket.send(JSON.stringify({ type: 'resign' }));
    await over;
    const restarted = nextMessage(guest.socket, (m) => m.type === 'state' && !m.state.gameOver);
    guest.socket.send(JSON.stringify({ type: 'new' }));
    expect((await restarted).state.moves).toHaveLength(0);

    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
  });

  it('clears every trace of the last occupants when a room expires', async () => {
    const ana = await createAccount('AnaLife');
    const bo = await createAccount('BoLife');
    const room = 'recycled';
    const stub = env.ROOM.getByName(room);
    const first = await connect(stub, room, { name: 'first' });
    const second = await connect(stub, room, { name: 'second' });
    const bound = nextMessage(first.socket, (m) => m.type === 'state' && m.state.accounts?.R === bo.id);
    first.socket.send(JSON.stringify({ type: 'auth', id: ana.id, secret: ana.secret }));
    second.socket.send(JSON.stringify({ type: 'auth', id: bo.id, secret: bo.secret }));
    await bound;
    first.socket.close(1000, 'gone');
    second.socket.close(1000, 'gone');

    await expire(stub);
    await runInDurableObject(stub, async (instance) => {
      expect(instance.accounts).toEqual({ B: null, R: null });
      expect(instance.ratings).toEqual({ B: null, R: null });
      expect(instance.lobbyListed).toBeNull();
    });

    // Two guests recycling the room must not inherit the previous pair's ratedness.
    const third = await connect(stub, room, { name: 'third' });
    const fourth = await connect(stub, room, { name: 'fourth' });
    const move = E.allMoves(third.welcome.state.board, E.BLUE, third.welcome.state.cfg)[0];
    const played = nextMessage(third.socket, (m) => m.type === 'state' && m.state.moves.length === 1);
    third.socket.send(JSON.stringify({ type: 'move', from: [move.fr, move.fc], to: [move.tr, move.tc] }));
    const state = (await played).state;
    expect(state.rated).toBe(false);
    expect(state.accounts).toEqual({ B: null, R: null });

    third.socket.close(1000, 'done');
    fourth.socket.close(1000, 'done');
  });

  it('keeps a private friend challenge out of the public lobby', async () => {
    const room = 'private-challenge';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, {
      name: 'Host', cfg: { ...E.PRESETS.standard, unlisted: true },
    });
    expect(host.welcome.state.unlisted).toBe(true);
    const lobby = env.LOBBY.getByName('global');
    expect((await lobby.list()).some((entry) => entry.room === room)).toBe(false);

    // A guest with the link still joins normally.
    const guest = await connect(stub, room, { name: 'Guest' });
    expect(guest.welcome.role).toBe(E.RED);
    expect((await lobby.list()).some((entry) => entry.room === room)).toBe(false);

    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
  });

  it('lists an ordinary open room in the public lobby', async () => {
    const room = 'public-challenge';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host', cfg: E.PRESETS.standard });
    expect(host.welcome.state.unlisted).toBe(false);
    expect((await env.LOBBY.getByName('global').list()).some((e) => e.room === room)).toBe(true);
    host.socket.close(1000, 'done');
  });

  it('mints its own seat token instead of trusting a client-chosen one', async () => {
    const room = 'token-mint';
    const stub = env.ROOM.getByName(room);
    const host = await connect(stub, room, { name: 'Host', token: 'guessable' });
    expect(host.welcome.role).toBe(E.BLUE);
    expect(host.welcome.token).not.toBe('guessable');
    expect(host.welcome.token).toMatch(/^[a-f0-9]{32}$/);

    // The weak token confers nothing; the seat is taken, so this connection is Red.
    const impostor = await connect(stub, room, { name: 'Impostor', token: 'guessable' });
    expect(impostor.welcome.role).toBe(E.RED);

    host.socket.close(1000, 'done');
    impostor.socket.close(1000, 'done');
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

  it('throttles repeated account minting from one source', async () => {
    const mint = () => exports.default.fetch('https://example.com/api/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({ name: 'Flood' }),
    });
    for (let attempt = 0; attempt < 6; attempt++) expect((await mint()).status).toBe(200);
    const blocked = await mint();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('cache-control')).toBe('no-store');

    // A different source is unaffected.
    const other = await exports.default.fetch('https://example.com/api/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
      body: JSON.stringify({ name: 'Elsewhere' }),
    });
    expect(other.status).toBe(200);
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

  it('records a started rated game resigned by a seated player', async () => {
    const ana = await createAccount('Ana');
    const bo = await createAccount('Bo');
    const room = 'rated-resign';
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
    const started = nextMessage(host.socket, (m) => m.type === 'state' && m.state.moves.length === 1);
    host.socket.send(JSON.stringify({ type: 'move', from: [move.fr, move.fc], to: [move.tr, move.tc] }));
    expect((await started).state.rated).toBe(true);

    const finished = nextMessage(host.socket, (m) => m.type === 'state' && m.state.endReason === 'resign');
    guest.socket.send(JSON.stringify({ type: 'resign' }));
    const final = (await finished).state;
    expect(final.gameOver).toBe(true);
    expect(final.winner).toBe(E.BLUE);
    expect(final.deltas).toEqual({ B: 16, R: -16 });

    const match = await env.DB.prepare('SELECT winner, reason FROM matches WHERE reason = ?1').bind('resign').first();
    expect(match).toEqual({ winner: E.BLUE, reason: 'resign' });
    host.socket.close(1000, 'done');
    guest.socket.close(1000, 'done');
  });
});

describe('admin stats', () => {
  const post = (key) => exports.default.fetch('https://example.com/api/admin/stats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(key === undefined ? {} : { key }),
  });

  it('rejects a missing or wrong key and serves stats for the right one', async () => {
    expect((await post()).status).toBe(401);
    expect((await post('nope')).status).toBe(401);

    const ok = await post('test-admin-key');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const { stats } = await ok.json();
    expect(stats.users).toHaveProperty('total');
    expect(stats.games).toHaveProperty('openNow');
    expect(Array.isArray(stats.top)).toBe(true);
    expect(Array.isArray(stats.recent)).toBe(true);
    expect(Array.isArray(stats.openGames)).toBe(true);
  });

  it('rejects non-POST methods', async () => {
    const res = await exports.default.fetch('https://example.com/api/admin/stats');
    expect(res.status).toBe(405);
  });
});

describe('Worker routes', () => {
  it('rejects lobby mutations and cross-origin browser sockets', async () => {
    const method = await exports.default.fetch('https://example.com/api/lobby', { method: 'POST' });
    expect(method.status).toBe(405);
    expect(method.headers.get('cache-control')).toBe('no-store');
    const showcaseMethod = await exports.default.fetch('https://example.com/api/showcase', { method: 'POST' });
    expect(showcaseMethod.status).toBe(405);
    expect(showcaseMethod.headers.get('cache-control')).toBe('no-store');
    const lobby = await exports.default.fetch('https://example.com/api/lobby');
    expect(lobby.status).toBe(200);
    expect(lobby.headers.get('cache-control')).toContain('s-maxage=3');
    const origin = await exports.default.fetch('https://example.com/ws?room=safe', {
      headers: { Upgrade: 'websocket', Origin: 'https://attacker.example' },
    });
    expect(origin.status).toBe(403);
  });
});
