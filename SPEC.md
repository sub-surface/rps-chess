# JANKEN — specification

Rock–paper–scissors played like chess on a square board. The production app is
**rps.subsurfaces.net**: a zero-build static client plus a Cloudflare Worker with Durable Objects
for authoritative online play.

## 1. Rules

Two players, **Blue** and **Red**, alternate turns. Each starts with `perType` of each piece
(rock, paper, scissors), arranged with 180° rotational symmetry.

### Movement (`rockMove`, `paperMove`, `scissorsMove`)

Each RPS piece independently receives one movement archetype:

- **king**: one square in any direction;
- **rook**: slides orthogonally;
- **bishop**: slides diagonally;
- **knight**: jumps in the chess 2-by-1 pattern;
- **queen**: slides orthogonally or diagonally;
- **cross**: one square orthogonally;
- **long king**: a king step or an exact two-square orthogonal jump.

Sliding pieces are blocked by pieces, but may pass over empty painted squares.
Knight and long-king jumps ignore the intervening square. Only rook, bishop, and queen are
sliders, so only those archetypes can paint intermediate squares with ink trails.

Legacy `moveStyle=classic|kings|queens` configs remain readable and expand to explicit
per-piece movement fields at the trust boundary.

### Capturing (`capture`)

- **rps** (default): a piece may capture only what it beats — rock > scissors > paper > rock.
  A non-capturable enemy blocks movement.
- **chess**: any enemy piece may be captured.

### Goal (`territory`)

- **territory**: every landing square is painted permanently. A piece may stop on an
  empty square permitted by `retread`, or a capturable enemy. Most squares wins.
  - `retread` permits stopping on painted empty squares and defaults on whenever territory is
    enabled. The no-progress guard still guarantees termination.
  - `trail` makes sliding moves paint the **unclaimed** squares they pass over (never repainting
    claimed ground).
  - `enclosure` claims any orthogonally connected region sealed from the board edge by a closed
    loop of the moving side's territory. Every square inside flips to that side and enemy pieces
    inside are removed. The first side to own more than half the board wins immediately.
- **elimination** (the default, and what Standard plays): there is no painting. Capture all
  opposing pieces, or hold the most when the game ends. It ends as soon as **no capture is
  possible any more** — judged on surviving piece *types*, not geometry: under RPS rules a side
  holding only rocks can never take a side holding only rocks, however either of them moves.
  `engine.capturesPossible()` decides this, and it is deliberately not "nothing is currently en
  prise", which would be true on move one. Immobilization and the no-progress guard remain as
  backstops.

### Starting layout (`layout`)

All layouts have 180° rotational symmetry: **rows** (centred side-facing blocks, default),
**corners** (blocks anchored to opposite corners), and **scattered** (random cells within each
player's near half — fair because the generated board itself is the shared state). On the
Standard 9×9 board, Blue's R/P/S rows fill b4–c6 and Red occupies the exact 180° mirror on
g4–h6. Narrow boards wrap wider piece sets across additional centred rows without overlap.

### Turns (`actionsPerTurn`)

A turn contains 1–3 consecutive moves by the same player. The game ends immediately when either
player has no legal move, either player has no pieces, no neutral territory remains, an enclosure
game reaches a strict board majority, the same playable state occurs for the third time, or the
bounded no-progress guard fires. Repetition identity includes the piece layer, painted territory
when active, side to move, and the action already used in a multi-action turn. There is no
pass/double-pass phase: a mobile player cannot pad their score against an immobilized opponent.

### Presets

`engine.PRESETS` is the named variant library; `engine.PRESET_INFO` carries each one's label
and tagline, and `PRESET_KEYS` fixes the picker's order. Every preset spells out all fourteen
compared rules fields, so `presetOf()` recognises one exactly — and a test asserts each preset
round-trips to its own key, since a duplicate ruleset would silently report the earlier name.

| Preset | Rules |
| --- | --- |
| **Standard** | 9×9, all kings, RPS capture, elimination, one action |
| **Skirmish** | 6×6, one piece per type, territory with re-tread |
| **Triple step** | Three actions per turn, territory with re-tread |
| **Cavalry** | All knights, territory with re-tread |
| **Painters** | All queens, territory with ink trails, no re-tread |
| **Ambush** | Scattered random start, territory with re-tread |
| **Siege** | Corner stand-off, territory without re-tread |
| **Expanse** | 13×13, four per type, territory with re-tread |
| **King's field** | Rock rook / Paper knight / Scissors bishop, elimination |
| **Melee** | All kings, RPS capture, territory with re-tread and enclosure; first past half wins |

Overriding any rules field produces **Custom**. Adding a variant is a one-file change: a
`PRESETS` entry plus its `PRESET_INFO` label and tagline, after which the picker, previews,
JPGN `Ruleset` tag, and rules text all pick it up.

## 2. Config schema

`territory` is **opt-in**: an absent flag sanitizes to `false`, so a room created with no config
is Standard. `retread`, `trail`, and `enclosure` are forced off whenever `territory` is off.

```text
size 6..13 · perType 1..4
rockMove|paperMove|scissorsMove king|rook|bishop|knight|queen|cross|longking
capture rps|chess
territory bool · retread bool · trail bool · enclosure bool · layout rows|corners|scattered
threefold bool (default true) · actionsPerTurn 1..3 · first B|R
```

Every named variant sets `threefold=true`. The parameters UI exposes it as a top-level checkbox;
turning it off makes the ruleset Custom. New games count their initial state as occurrence one.
Persisted rooms created before tracking existed seed their current state as occurrence one rather
than inventing history that was never stored.

Client-only preferences are `pieceStyle` (the IDs exported by `public/pieces.js`), `coords`,
`hints`, theme, board flip, and guest name. The fourteen SVG families are colour-aware and remain
asset-free; invalid or retired style IDs fall back to `line`. `engine.sanitizeCfg()` clamps every
rules field at browser restore and at the server boundary.

The client separates the two lifetimes: `cfg` is the live config the board plays under, which an
online room's rules overwrite, while `ownRules` is the variant this player chose. Only `ownRules`
(plus view preferences) is persisted, and returning Home restores it — so visiting someone else's
game never rewrites your saved preset.

## 3. Client architecture

- `public/engine.js`: pure rules and the single source of truth.
- `public/notation.js`: JPGN 1.1 exporter, 1.0-compatible parser, and strict
  legality-checked replayer.
- `public/gif.js`: lazy, dependency-free indexed GIF encoder and deterministic board renderer.
- `public/showcase.js`: lazy recent-game/bot replay theatre with visibility and reduced-motion
  guards.
- `public/game.js`: selector preview, local play, bot, board/editor rendering, lobby, exports,
  and resilient online client.
- The selector preview renders the actual start formation plus a synthetic selected piece, then
  calls `engine.legalDest()` for its arrows and destinations. Its movement mapping, first player,
  actions, capture mode, goal, ownership, and layout all come from the sanitized config.
- Home leads with the play card — name, current variant, and the four ways into a game — so the
  first action is reachable without scrolling, on a phone as much as a desktop. Variant choice
  is a refinement below it, and the variant theatre closes the page as ambient flavour.
- The variant stage sits above the collapsed rules editor, so picking a variant is visual by
  default. Hovering or focusing a preset chip previews that variant across the whole stage —
  board, per-piece movement cards, description, and facts — without committing to it; leaving
  the chip restores the selected config.
- `engine.rulesSummary(cfg)` explains the game from scratch **for the config passed in**, and is
  the single source for both the board-side rules flap and the how-to-play dialog. Nothing about
  the rules is hardcoded in markup, so the two can never drift from the variant being played.
  A shared movement archetype is stated once ("Every piece…") rather than three times.
- The rules flap is a tab clipped to the board's left edge, in its own column beside
  `.board-stage`; the annotation overlay, banner, and resize grip keep positioning against the
  stage, so the board remains an exact square regardless of the tab.
- The game board and editor palette are built only when play begins. Piece SVGs, move logs, and
  classes are updated only when their values change.
- The analysis panel can swap named rules without leaving the board. Its custom-rules action
  reuses the Home rules editor and preserves the draft when returning; only a board-size change
  resets the position. Mirror rebuilds Red from Blue (pieces and territory), Rotate turns the
  entire position 180°, and Reset uses the selected rules' starting layout.
- Board interaction supports click-to-move and pointer drag-and-drop through one commit path.
  The annotation SVG maps exactly to the board's inner content box.
- Online spectators reconstruct the position history from the room's authoritative start layers
  and move list. They can scrub with the move log, buttons, or keyboard; incoming moves append to
  the history without pulling a spectator away from the historical ply they are reviewing.
- The lobby polls immediately, then every 12 seconds; it pauses while hidden, prevents overlapping
  requests, times out stalled requests, and exponentially backs off after errors.
- Online sockets reconnect with jittered exponential backoff. Network loss, reconnecting,
  replacement-tab, and expired-room states are explicit.

## 4. Worker and Durable Objects

### `GameRoom` — one coordination object per room

- Owns the canonical game and re-validates each move with `engine.isLegal()`.
- Uses the WebSocket Hibernation API and serialized connection attachments.
- Mints its own unguessable seat capability tokens. A client-supplied token is honoured only
  when it already holds that seat, so no client can choose a weak capability for itself; a
  reconnect with a valid token keeps its colour and fences the older connection.
- A room created with `unlisted` (the friend challenge) never enters the global lobby index.
  The flag is persisted with the room and survives rematches, so a private room stays private.
- Refuses to discard a game in progress. `new` is accepted only once the game is over or while
  the board is still untouched, so a losing player cannot escape a started rated result — the
  only ways out are finishing, resigning, or the abandonment alarm.
- Broadcasts player names, occupied seats, and live presence.
- Holds a disconnected seat for 60 seconds, then releases it by alarm. This allows genuine
  reconnects without leaving abandoned rooms permanently full.
- Refreshes a 30-minute idle expiry on meaningful player activity. Expiry removes the lobby row,
  notifies/closes sockets, calls `storage.deleteAll()`, and resets **every** field of the
  instance via `resetRoom()`. A Durable Object instance outlives the room it hosted and
  `deleteAll()` does not touch memory, so a partial reset would let the next occupants of a
  recycled room ID inherit the previous pair's account bindings — and be rated as them.
- Caps spectators and per-connection message rate. Messages are size-limited and move coordinates
  must be integers.
- Relays sanitized player chat directly to connected sockets without putting chat into Durable
  Object storage. A separate short-window limiter protects chat while spectators remain read-only.
- Accepts resignation only from a current seated player after both seats are occupied. A rated
  game is recorded only if ratedness was already locked by its first move.
- After persisting a completed game, queues one idempotent, compact replay write to D1 for the
  homepage feed. This historical feed does not add coordination load to the Lobby object.

### `Lobby` — one global index

- Uses the existing SQLite-backed Durable Object as a table keyed by room.
- Adds/removes one row per change, prunes at the same 30-minute horizon, retains at most 100 rows,
  and returns the newest 40. Expiry pruning is time-gated to once per minute rather than issuing
  a delete query on every lobby poll.
- Each room persists whether it is currently indexed plus a compact metadata fingerprint.
  Unchanged moves and presence broadcasts return locally instead of issuing a cross-object SQL
  delete/update; only open/closed or host-metadata transitions touch the global index.
- Migrates the original whole-object `games` key on first construction.
- `/api/lobby` has a three-second edge cache to absorb bursts; clients still render fresh results
  on their normal polling cadence.

### HTTP and WebSocket boundary

- `/ws` accepts GET upgrades only, validates room IDs, and rejects mismatched browser origins.
- `/api/lobby` accepts GET only.
- `/api/showcase` accepts GET only and serves the newest bounded replay rows behind a 30-second
  edge cache.
- Static assets carry CSP, frame, MIME-sniffing, referrer, permissions, and cross-origin headers.
- Structured error logs contain event and room context, never seat tokens. Logs are retained and
  traces are sampled at 5%.

## 5. Online protocol

Connect:

```text
/ws?room=&name=&token?=&cfg?=
```

`cfg` may carry `unlisted: true`, which keeps the room out of the public lobby. It may also
carry a `pos` — a compact custom starting piece position (one char per cell: `.`
empty, `R/P/S` Blue, `r/p/s` Red) — plus `own`, a matching paint layer (`B`, `R`, or `.`).
Both are validated by the shared engine; positions require both sides and at most
`engine.MAX_PIECES_PER_SIDE` each — one constant derived from the `perType` clamp, so the piece
budget cannot drift between what `blocksBoard` generates and what `decodePos` accepts.
Challenge rooms keep both exact layers across rematches.

The server replies:

```text
{ type: "welcome", role: "B"|"R"|"S", token, state }
```

Client → server:

```text
{ type: "move", from: [r,c], to: [r,c] }
{ type: "new", cfg, pos?, own? }
{ type: "auth", id, secret }
{ type: "chat", text }
{ type: "resign" }
{ type: "sync" }
```

Server → client:

```text
{ type: "state", state }
{ type: "chat", role, name, text, ts }
{ type: "error", msg }
{ type: "expired" }
```

`state` contains board, exact starting piece/paint layers, listing privacy, start time, turn, actions used,
structured moves, game-over reason, last move, sanitized config, result, names, occupied seats,
presence, and the rating fields below. Blue may select the config and custom position for a new
online game; Red rematches with the current config and position. Chat is a separate transient
message and never appears in `state`.

## 5b. Accounts and ratings (D1)

Accounts are device-bound pseudonyms in D1 (`accounts`, `matches`, `showcases`, and `signups`
tables; `migrations/`): an
unguessable id plus a secret whose SHA-256 hash is stored. Endpoints (all `no-store`):

- `POST /api/account` `{name}` → `{id, secret, name, rating}` — mint an account. This is the
  only unauthenticated endpoint that writes an unbounded row, so it is throttled to 6 per hour
  per source (`429` beyond that). The bucket is a salted, truncated hash of `cf-connecting-ip`,
  stored in `signups` and pruned as it ages out — countable, never stored against an account,
  and not reversible to an address without the deployment secret. A request without the edge's
  `cf-connecting-ip` header is not throttled, as there is nothing trustworthy to attribute.
- `POST /api/account/verify` `{id, secret}` → `{account}` — used by the transfer-code restore.
- `POST /api/account/name` `{id, secret, name}` — rename.
- `GET /api/profile?id=` → `{account, matches}` — public stats plus the 20 most recent rated games.
- `GET /api/showcase` → `{games}` — up to four compact, replayable completed games. The table
  retains only the newest 40 rows, while the client uses bot variations when the feed is empty
  or offline.

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
harmlessly. `state` then carries `rated`, `winner`, `endReason`, `deltas`, `ratingError`,
`ratings`, `accounts`, and `pos`; the lobby row carries the host's rating for Elo-proximity
quick match. Games involving any guest stay unrated. A rating write that fails is logged **and**
reported as `ratingError`, so the result banner says so rather than showing a silent no-op.

The Home screen's **you are** field is always editable. For a bound account, changes are
debounced to `/api/account/name`, so the profile and future room identity update without creating
a new account.

## 5c. Portable game notation

**JPGN 1.1** is the canonical copy/export format. It includes event metadata, named ruleset and
version, explicit movement assignments, exact sanitized rules, separate starting piece and
ownership layers, ratings when available, structured multi-action movetext, result, score, and
termination reason. Its parser also accepts legacy 1.0 `moveStyle` records, replays every action
through `engine.isLegal()`, and rejects inconsistent captures, turns, or results.

The GIF exporter reconstructs the same exact position/action stream, samples only when a game is
exceptionally long, draws an indexed geometric board, and encodes GIF89a entirely on demand.

The complete format and replay procedure are specified in [`docs/JPGN.md`](./docs/JPGN.md).

## 6. Verification and release

Workers-runtime tests cover config clamping, every movement archetype, capture/turn invariants,
jump/trail separation, randomized termination, JPGN replay, GIF structure, SQLite lobby
operations, public showcase recording, role assignment, server-side move validation, token
reconnect fencing, seat-grace release, room expiry, route methods, and origin checks.

A dedicated **room lifecycle** group covers the transitions *between* games in one room, which
single-game tests never reach: refusing to discard a started game, full instance reset on expiry
(a recycled room must not inherit the previous pair's accounts or rate them), server-minted seat
tokens, and the account-minting throttle.

```sh
npm run verify
npm run deploy:dry
npm run deploy
```

`deploy` applies pending D1 migrations between the version stamp and the upload, so a release
that needs a new table cannot reach production before the table does. `deploy:dry` deliberately
omits it — a dry run must not touch the production database.

Production deploy is intentionally guarded: application files must be committed before the
version stamp and upload can run.
