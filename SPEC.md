# JANKEN — specification

Rock–paper–scissors played like chess on a square board. The production app is
**rps.subsurfaces.net**: a zero-build static client plus a Cloudflare Worker with Durable Objects
for authoritative online play.

## 1. Rules

Two players, **Blue** and **Red**, alternate turns. Each starts with `perType` of each piece
(rock, paper, scissors), arranged with 180° rotational symmetry.

### Movement (`moveStyle`)

- **classic** (default): Rock = king, Paper = rook, Scissors = bishop.
- **kings**: every piece steps one square in any direction.
- **queens**: every piece slides in any direction.

Sliding pieces are blocked by pieces, but may pass over empty painted squares.

### Capturing (`capture`)

- **rps** (default): a piece may capture only what it beats — rock > scissors > paper > rock.
  A non-capturable enemy blocks movement.
- **chess**: any enemy piece may be captured.

### Goal (`territory`)

- **territory** (default): every landing square is painted permanently. A piece may stop on an
  empty unclaimed square or a capturable enemy. Most squares wins.
  - `retread` permits stopping on painted empty squares. The no-progress guard still guarantees
    termination.
  - `trail` makes sliding moves paint the **unclaimed** squares they pass over (never repainting
    claimed ground).
- **elimination**: there is no painting. Capture all opposing pieces, or hold the most when a
  double-pass/stall ends the game.

### Starting layout (`layout`)

All layouts have 180° rotational symmetry: **rows** (centred blocks, default), **corners**
(blocks anchored to opposite corners), and **scattered** (random cells within each player's near
half — fair because the generated board itself is the shared state).

### Turns (`actionsPerTurn`)

A turn contains 1–3 consecutive moves by the same player. It passes early if that player has no
legal move. The game ends on a full territory board, elimination, double-pass, or the bounded
no-progress guard.

### Presets

- **Standard**: 9×9, classic, RPS capture, territory, one action.
- **King's field**: 9×9, all kings, RPS capture, elimination, one action.
- **Painters**: 9×9, all queens, RPS capture, territory with ink trails, one action.
- Overriding any rules field produces **Custom**.

## 2. Config schema

```text
size 6..13 · perType 1..4 · moveStyle classic|kings|queens · capture rps|chess
territory bool · retread bool · trail bool · layout rows|corners|scattered
actionsPerTurn 1..3 · first B|R
```

Client-only preferences are `pieceStyle` (`line|solid|pixel|kanji`), `coords`, `hints`, theme,
board flip, and guest name. `engine.sanitizeCfg()` clamps every rules field at browser restore and
at the server boundary.

## 3. Client architecture

- `public/engine.js`: pure rules and the single source of truth.
- `public/game.js`: selector preview, local play, bot, board/editor rendering, lobby, and resilient
  online client.
- The selector preview creates a synthetic board and calls `engine.legalDest()`; it does not
  duplicate movement rules.
- The game board and editor palette are built only when play begins. Piece SVGs, move logs, and
  classes are updated only when their values change.
- The lobby polls immediately, then every 12 seconds; it pauses while hidden, prevents overlapping
  requests, times out stalled requests, and exponentially backs off after errors.
- Online sockets reconnect with jittered exponential backoff. Network loss, reconnecting,
  replacement-tab, and expired-room states are explicit.

## 4. Worker and Durable Objects

### `GameRoom` — one coordination object per room

- Owns the canonical game and re-validates each move with `engine.isLegal()`.
- Uses the WebSocket Hibernation API and serialized connection attachments.
- Assigns seats with unguessable capability tokens. A reconnect with the same token keeps its
  colour and fences the older connection.
- Broadcasts player names, occupied seats, and live presence.
- Holds a disconnected seat for 60 seconds, then releases it by alarm. This allows genuine
  reconnects without leaving abandoned rooms permanently full.
- Refreshes a 30-minute idle expiry on meaningful player activity. Expiry removes the lobby row,
  notifies/ closes sockets, and calls `storage.deleteAll()`.
- Caps spectators and per-connection message rate. Messages are size-limited and move coordinates
  must be integers.

### `Lobby` — one global index

- Uses the existing SQLite-backed Durable Object as a table keyed by room.
- Adds/removes one row per change, prunes at the same 30-minute horizon, retains at most 100 rows,
  and returns the newest 40.
- Migrates the original whole-object `games` key on first construction.
- `/api/lobby` has a three-second edge cache to absorb bursts; clients still render fresh results
  on their normal polling cadence.

### HTTP and WebSocket boundary

- `/ws` accepts GET upgrades only, validates room IDs, and rejects mismatched browser origins.
- `/api/lobby` accepts GET only.
- Static assets carry CSP, frame, MIME-sniffing, referrer, permissions, and cross-origin headers.
- Structured error logs contain event and room context, never seat tokens. Logs are retained and
  traces are sampled at 5%.

## 5. Online protocol

Connect:

```text
/ws?room=&name=&token?=&cfg?=
```

`cfg` may carry a `pos` — a compact custom starting position (one char per cell: `.` empty,
`R/P/S` Blue, `r/p/s` Red), validated by `engine.decodePos()` (both sides present, ≤ 12 pieces
each). Challenge rooms keep their position across rematches.

The server replies:

```text
{ type: "welcome", role: "B"|"R"|"S", token, state }
```

Client → server:

```text
{ type: "move", from: [r,c], to: [r,c] }
{ type: "new", cfg, pos? }
{ type: "auth", id, secret }
{ type: "sync" }
```

Server → client:

```text
{ type: "state", state }
{ type: "error", msg }
{ type: "expired" }
```

`state` contains board, turn, actions used, moves, game-over status, last move, sanitized config,
result, names, occupied seats, presence, and the rating fields below. Blue may select the config
for a new online game; Red rematches with the current config.

## 5b. Accounts and ratings (D1)

Accounts are device-bound pseudonyms in D1 (`accounts`, `matches` tables; `migrations/`): an
unguessable id plus a secret whose SHA-256 hash is stored. Endpoints (all `no-store`):

- `POST /api/account` `{name}` → `{id, secret, name, rating}` — mint an account.
- `POST /api/account/verify` `{id, secret}` → `{account}` — used by the transfer-code restore.
- `POST /api/account/name` `{id, secret, name}` — rename.
- `GET /api/profile?id=` → `{account, matches}` — public stats plus the 20 most recent rated games.

### Admin

`GET /admin` is an unlinked, `noindex` dashboard. `POST /api/admin/stats {key}` returns
application metrics (user/game counts, top-rated, newest, recent matches, open games) when `key`
matches the `ADMIN_KEY` Worker secret, compared in constant time; failures throttle. The key lives
only in the browser's `sessionStorage`. Infrastructure metrics (requests, CPU, errors, D1/DO
usage) are not stored here — they live in the Cloudflare dashboard, linked from the page.

A seated player binds an account by sending `auth` over the socket after `welcome`. When **both**
seats are bound at the first move, the game snapshots as **rated** with a fresh `matchId`. On game
over (or 30-second disconnect abandonment, adjudicated by alarm while the opponent is present),
`finishRated` applies plain Elo (K=32, draws 0.5) — one D1 batch transaction covers the match
insert and both rating updates, and the match-id primary key makes duplicate reports roll back
harmlessly. `state` then carries `rated`, `winner`, `endReason`, `deltas`, `ratings`, `accounts`,
and `pos`; the lobby row carries the host's rating for Elo-proximity quick match. Games involving
any guest stay unrated.

## 6. Verification and release

Workers-runtime tests cover config clamping, movement/capture/turn invariants, randomized
termination, SQLite lobby operations, role assignment, server-side move validation, token
reconnect fencing, seat-grace release, room expiry, route methods, and origin checks.

```sh
npm run verify
npm run deploy:dry
npm run deploy
```

Production deploy is intentionally guarded: application files must be committed before the
version stamp and upload can run.
