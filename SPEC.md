# JANKEN — specification

Rock–paper–scissors played like chess on a square board. The production app is
**rps.subsurfaces.net**: a zero-build static client plus a Cloudflare Worker with Durable Objects
for authoritative online play.

Sections 1–6 are the contract for the game as specified. Section 7 designs the three extensions
that are not built yet, and section 8 is the delivery plan that lands everything, including the
handful of section 1–2 rules that the code has not caught up with. New contributors — human or
agent — should read [`CLAUDE.md`](./CLAUDE.md) first for the working map of the repo.

## 0. Status

Every statement in sections 1–6 is either already true of the code or carries an explicit
**[Phase N]** marker pointing at the phase in section 8 that makes it true. Nothing else in
sections 1–6 is aspirational.

| Area | Status |
| --- | --- |
| Movement archetypes (7), RPS/chess/checkers capture, territory, enclosure, threefold | shipped |
| Eleven named presets, custom rules, analysis board, JPGN 1.1, GIF, showcase | shipped |
| Worker, `GameRoom`/`Lobby` Durable Objects, protocol, accounts, ratings, admin | shipped |
| `forcedCapture` rule and the Checkers preset's forced leaps | **[Phase 0]** |
| RPS restriction on checkers leaps, `rulesVersion` stamping, JPGN `RulesetVersion "1.1"` | **[Phase 0]** |
| Theme-aware GIF palettes, muted last-move wash, exported piece style | **[Phase 0b]** |
| Variant theatre beside the play card, following the selected ruleset | **[Phase 0b]** |
| Topology adapter (`public/topology.js`) | **[Phase 1]** |
| Gold general movement role | **[Phase 2]** |
| Hexagonal boards (`topology`, `radius`), JPGN 2.0 | **[Phase 3]** |
| Alternating setup play (`setup`), placement protocol, Setup chess preset | **[Phase 4]** |
| Balance simulation harness and published data | **[Phase 5]** |
| Ratings for Gold, hex, or setup games | deliberately withheld — see §8.9 |

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
- **long king**: a king step or an exact two-square orthogonal jump;
- **gold general**: a colour-oriented single step — see §7.1. **[Phase 2]**

Sliding pieces are blocked by pieces, but may pass over empty painted squares.
Knight jumps and ordinary long-king jumps ignore the intervening square. With checkers capture,
the long king's two-square jump instead requires and removes an adjacent enemy. Only rook,
bishop, and queen are sliders, so only those archetypes can paint intermediate squares with
ink trails.

Legacy `moveStyle=classic|kings|queens` configs remain readable and expand to explicit
per-piece movement fields at the trust boundary.

### Capturing (`capture`)

- **rps** (default): a piece may capture only what it beats — rock > scissors > paper > rock.
  A non-capturable enemy blocks movement.
- **chess**: any enemy piece may be captured.
- **checkers**: ordinary moves cannot capture. An exact two-square orthogonal leap over an
  adjacent enemy onto an empty square removes the jumped piece **only when the moving piece beats
  it in the RPS cycle** **[Phase 0]**: Paper leaps Rock, Rock leaps Scissors, and Scissors leaps
  Paper. An enemy the mover does not beat blocks that leap just as it would block an RPS landing
  capture. Sanitization makes all three movement assignments `longking`, so the capture rule is
  always usable. A turn does not chain extra leaps.

`forcedCapture` **[Phase 0]** is a separate boolean rule and defaults to `false`. When it is
enabled, the engine checks the side to act before **each action**: if any legal capture exists
anywhere in that side's army, every non-capturing move is illegal. Capture availability is
recomputed after each action in a multi-action turn. The rule applies consistently to RPS landing
captures, unrestricted chess captures, and **RPS-legal** checkers leaps; a jump over an enemy the
mover does not beat never creates a capture obligation. Forced capture does not require a longest
capture, create a bonus action, or turn checkers into a chained multi-jump. The named **Checkers**
preset sets `forcedCapture=true`; Custom checkers games may switch it off.

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
and tagline, and `PRESET_KEYS` fixes the picker's order. Every preset spells out every compared
rules field, so `presetOf()` recognises one exactly — and a test asserts each preset round-trips
to its own key, since a duplicate ruleset would silently report the earlier name. The compared
field list grows with the schema: fourteen fields today, fifteen after Phase 0, and the topology
and phase fields after Phases 3 and 4.

| Preset | Rules |
| --- | --- |
| **Standard** | 9×9, all kings, RPS capture, elimination, one action |
| **Skirmish** | 3×3, one piece per type, territory with re-tread |
| **Triple step** | Three actions per turn, territory with re-tread |
| **Cavalry** | All knights, territory with re-tread |
| **Painters** | All queens, territory with ink trails, no re-tread |
| **Ambush** | Scattered random start, territory with re-tread |
| **Siege** | Corner stand-off, territory without re-tread |
| **Expanse** | 13×13, four per type, territory with re-tread |
| **King's field** | Rock rook / Paper knight / Scissors bishop, elimination |
| **Checkers** | 8×8, all Long kings, forced RPS-legal leap captures, elimination |
| **Melee** | All kings, RPS capture, territory with re-tread and enclosure; first past half wins |
| **Hex field** **[Phase 3]** | Radius 6 hex, all kings, RPS capture, elimination, one action |
| **Setup chess** **[Phase 4]** | 9×9, alternating placement, R rook / P knight / S bishop, elimination |

Overriding any rules field produces **Custom**. Adding a variant is a one-file change: a
`PRESETS` entry plus its `PRESET_INFO` label and tagline, after which the picker, previews,
JPGN `Ruleset` tag, and rules text all pick it up.

## 2. Config schema

`territory` is **opt-in**: an absent flag sanitizes to `false`, so a room created with no config
is Standard. `retread`, `trail`, and `enclosure` are forced off whenever `territory` is off.

```text
topology square|hex (default square)                       [Phase 3]
size 3..13 (square only) · radius 4..8 (hex only)          [Phase 3]
perType 1..4 (clamped to the selected board/layout capacity)
rockMove|paperMove|scissorsMove king|rook|bishop|knight|queen|cross|longking|gold
capture rps|chess|checkers · forcedCapture bool (default false; Checkers preset true)
territory bool · retread bool · trail bool · enclosure bool · layout rows|corners|scattered
setup fixed|alternating (default fixed)                    [Phase 4]
threefold bool (default true) · actionsPerTurn 1..3 · first B|R
```

`gold` is **[Phase 2]**, `topology`/`radius` are **[Phase 3]**, `setup` is **[Phase 4]**, and
`forcedCapture` is **[Phase 0]**. Everything else is live.

An absent `forcedCapture` remains `false`, including when reading persisted rooms or JPGN records
written before the field existed. This preserves the legality and replay of historical Checkers
games. New named presets spell the field out explicitly, and new JPGN exports always include it
in `Rules`.

The RPS restriction on checkers leaps is a rules revision rather than a silent reinterpretation
of completed games. New games stamp the current `rulesVersion`; an in-progress persisted game
without that stamp finishes under the legacy 1.0 behaviour, then a rematch starts under the
current rule. Strict JPGN replay likewise honours `RulesetVersion "1.0"` for historical records,
where checkers could leap any enemy, while new Checkers records use `RulesetVersion "1.1"` and
require the RPS match. The unrestricted legacy leap exists only inside migration/replay code and
is never exposed as a new-game setting.

Every named variant sets `threefold=true`. The parameters UI exposes it as a top-level checkbox;
turning it off makes the ruleset Custom. New games count their initial state as occurrence one.
Persisted rooms created before tracking existed seed their current state as occurrence one rather
than inventing history that was never stored.

The parameters UI also offers movement macros for all kings, all Long kings,
rook/knight/bishop, all queens, and — after Phase 2 — all Gold generals. They only fill the three
canonical movement fields; choosing one does not introduce another config field. Selecting
checkers capture applies the all-Long-king macro, while changing away from that movement set
returns capture to RPS. **Forced captures** is an independent checkbox: selecting the named
Checkers preset turns it on, but merely choosing the checkers capture mechanism in a Custom game
does not silently rewrite the player's setting.

Client-only preferences are `pieceStyle` (the IDs exported by `public/pieces.js`), `coords`,
`hints`, theme, board flip, and guest name. The fourteen SVG families are colour-aware and remain
asset-free; invalid or retired style IDs fall back to `line`. `engine.sanitizeCfg()` clamps every
rules field at browser restore and at the server boundary.

The client separates the two lifetimes: `cfg` is the live config the board plays under, which an
online room's rules overwrite, while `ownRules` is the variant this player chose. Only `ownRules`
(plus view preferences) is persisted, and returning Home restores it — so visiting someone else's
game never rewrites your saved preset.

### Two validators, two jobs

`engine.sanitizeCfg()` is a **total, non-throwing canonicalizer**. It never rejects: it clamps,
substitutes defaults, expands legacy fields, and returns a playable config for any input,
including restored browser state and hostile network payloads. It is the only place a rules field
acquires its final value.

`engine.validatePlayableCfg()` **[Phase 1]** is the opposite: it *rejects*. It refuses
combinations that sanitization could only paper over by silently converting one advertised game
into a different one — Gold generals on a hex board, a piece budget that cannot fit its legal
deployment sectors, or a milestone-gated rule that is not accepted in live rooms yet. Live-room
creation, rematches, and analysis challenges call it after sanitization; local play does not need
it, because a fallback to Standard is honest there.

## 3. Client architecture

- `public/engine.js`: pure rules and the single source of truth.
- `public/topology.js` **[Phase 1]**: square and hex lattice adapters — the only code that knows
  what a cell *is*.
- `public/notation.js`: JPGN 1.1 exporter, 1.0-compatible parser, and strict
  legality-checked replayer. JPGN 2.0 arrives with Phase 3.
- `public/gif.js`: lazy, dependency-free indexed GIF encoder and deterministic board renderer.
  It stays DOM-free — the client injects piece rendering rather than the encoder reaching for it.
- `public/showcase.js`: lazy replay theatre — recent completed games and bot demonstrations of a
  ruleset — with visibility and reduced-motion guards.
- `public/game.js`: selector preview, local play, bot, board/editor rendering, lobby, exports,
  and resilient online client.
- The selector preview renders the actual start formation plus a synthetic selected piece, then
  calls `engine.legalDest()` for its arrows and destinations. Its movement mapping, first player,
  actions, capture mode, goal, ownership, and layout all come from the sanitized config.
- Home leads with the play card — name, current variant, and the four ways into a game — so the
  first action is reachable without scrolling, on a phone as much as a desktop. Variant choice
  is a refinement below it.
- The variant theatre sits **beside the play card** **[Phase 0b]**, stacking directly beneath it
  on narrow screens, so the rules being chosen are visible in motion rather than only described.
  It opens on the newest completed online game, and switches for the remainder of the visit to
  demonstrating the active ruleset as soon as the player hovers, focuses, selects, or edits one.
  In that mode it plays the exact sanitized config on show — the hovered chip's rules while
  hovering, the selected rules otherwise — so it always agrees with the variant stage.
- Any ruleset change **restarts** the theatre's game rather than mutating the one in flight, since
  a board mid-game under one set of rules cannot honestly illustrate another. Restarts are
  debounced, so dragging a slider through ten values starts one game, not ten; the recent-game
  feed is fetched at most once per visit and never on restart. The theatre loads after first
  paint into a reserved box, pauses off-screen and while hidden, and shows reduced-motion users a
  still position.
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
  only ways out are finishing, resigning, or the abandonment alarm. "Untouched" is
  `engine.hasStarted()` **[Phase 4]**, not `moves.length === 0`, because a setup game starts at
  its first placement.
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
  game is recorded only if ratedness was already locked at `engine.ratingLockPoint()`
  **[Phase 4]** — the first move in a fixed-start game, the first placement in a setup game.
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
Challenge rooms keep both exact layers across rematches. When an online rematch starts, the two
seated players swap colours (and their server-issued seat tokens move with them), so the first
mover alternates fairly between games. Existing sockets receive a fresh `welcome` message with
their new role and token before the rematch state is broadcast.

The server replies:

```text
{ type: "welcome", role: "B"|"R"|"S", token, state }
```

Client → server:

```text
{ type: "move", from: [r,c], to: [r,c] }
{ type: "place", piece: "rock"|"paper"|"scissors", to: [r,c] }   [Phase 4]
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
presence, and the rating fields below. After Phase 4 it also carries `phase`, `setupTurn`,
`setupPly`, `remaining`, `placements`, and `startMode`. Blue may select the config and custom
position for a new online game; Red rematches with the current config and position. Chat is a
separate transient message and never appears in `state`.

Hex rooms **[Phase 3]** use the same messages. A coordinate pair is a lattice coordinate, not a
row/column pair: axial `[q, r]` on hex, row/column on square. The server validates it through the
topology adapter's `has()` before anything else touches it.

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
seats are bound at `engine.ratingLockPoint()`, the game snapshots as **rated** with a fresh
`matchId`. On game over (or 30-second disconnect abandonment, adjudicated by alarm while the
opponent is present), `finishRated` applies plain Elo (K=32, draws 0.5) — one D1 batch transaction
covers the match insert and both rating updates, and the match-id primary key makes duplicate
reports roll back harmlessly. `state` then carries `rated`, `winner`, `endReason`, `deltas`,
`ratingError`, `ratings`, `accounts`, and `pos`; the lobby row carries the host's rating for
Elo-proximity quick match. Games involving any guest stay unrated. A rating write that fails is
logged **and** reported as `ratingError`, so the result banner says so rather than showing a
silent no-op.

### The rating eligibility gate

One predicate, `engine.isRatedEligible(cfg)` **[Phase 1]**, decides whether a ruleset may be
rated at all. It is deliberately narrower than "is this config playable":

- eligible today: square topology, fixed start, the seven original movement archetypes, any
  capture rule, any goal;
- **not** eligible: Gold generals, hex boards, alternating setup — every mode introduced by
  Phases 2–4 ships unrated, however stable it is.

`GameRoom` consults it when a game locks ratedness; an ineligible ruleset simply plays unrated,
with the client saying so rather than silently dropping the rating afterwards. Widening the gate
is a one-line, auditable policy change made only after §8.9's data exists. The Home UI marks an
unrated variant in the play card and in the room's status line, so nobody discovers it at the end
of a game.

## 5c. Portable game notation

**JPGN 1.1** is the canonical copy/export format. It includes event metadata, named ruleset and
version, explicit movement assignments, exact sanitized rules, separate starting piece and
ownership layers, ratings when available, structured multi-action movetext, result, score, and
termination reason. Its parser also accepts legacy 1.0 `moveStyle` records, replays every action
through `engine.isLegal()`, and rejects inconsistent captures, turns, or results.

**JPGN 2.0** **[Phase 3]** adds hex topology and setup placements. A writer selects its version
from the game itself: a fixed-start square game is written as 1.1, byte-for-byte as today; a hex
or alternating-setup game is written as 2.0. A 2.0 reader accepts every 1.0 and 1.1 square record.

The GIF exporter reconstructs the same exact position/action stream, samples only when a game is
exceptionally long, draws an indexed board, and encodes GIF89a entirely on demand. **[Phase 0b]**
An exported GIF should look like the site the player is looking at:

- **Theme.** Two sixteen-entry palettes with identical index meanings — the existing dark set and
  a light counterpart — selected from the active theme at export time. The index layout is
  deliberately unchanged, so the encoder, the frame sampler, and the tests do not know which
  palette is in play. An export with no theme given keeps the dark palette, which is what the
  Workers-runtime tests exercise.
- **Last move.** The saturated purple highlight is replaced by a low-contrast wash carried in
  **two** palette entries, one per square parity, drawn from the spare slots. A highlight should
  read as a light lift of the square beneath it, not as a third colour competing with the two
  players — painted territory and the checker pattern must stay legible under it.
- **Piece style.** The exporter accepts an optional `drawPiece` hook and uses the client's
  selected `pieceStyle` through it, so a GIF carries the same artwork as the board it came from.
  The client builds that hook by rasterizing the `pieces.js` glyph for a `(type, colour, style,
  cell)` combination and quantizing it to the palette, caching per combination. `gif.js` itself
  imports nothing from `pieces.js` and touches no DOM: with no hook — in tests, in a Durable
  Object, in any non-browser caller — it draws its own geometry exactly as it does today.

That fallback is the point of the split. Browser rasterization is not byte-identical across
engines, so it is never the path under test; determinism is asserted against the geometric
renderer, and the styled renderer is a presentation layer over it.

The complete format and replay procedure are specified in [`docs/JPGN.md`](./docs/JPGN.md).

## 6. Verification and release

Workers-runtime tests cover config clamping, every movement archetype, capture/turn invariants,
jump/trail separation, randomized termination, backward-compatible JPGN replay, GIF structure,
SQLite lobby operations, public showcase recording, role assignment, server-side move validation,
token reconnect fencing, seat-grace release, room expiry, route methods, and origin checks.

A dedicated **room lifecycle** group covers the transitions *between* games in one room, which
single-game tests never reach: refusing to discard a started game, full instance reset on expiry
(a recycled room must not inherit the previous pair's accounts or rate them), server-minted seat
tokens, and the account-minting throttle.

```sh
npm run verify
npm run test:smoke
npm run deploy:dry
npm run deploy
```

The browser smoke starts a local Worker, selects Skirmish, plays a legal move on its 3×3 board,
and carries that position into analysis. GitHub Actions runs syntax, Workers-runtime, browser, and
dry-run packaging checks for every push and pull request.

`deploy` applies pending D1 migrations between the version stamp and the upload, so a release
that needs a new table cannot reach production before the table does. `deploy:dry` deliberately
omits it — a dry run must not touch the production database.

Production deploy is intentionally guarded: application files must be committed before the
version stamp and upload can run.

## 7. Extension design: Gold general, hex boards, and setup play

This section is the design target for Phases 2–4. None of it may be accepted in a live room or
advertised as playable until its engine, server, client, bot, replay, and termination tests land
together. Hex and alternating setup require JPGN 2.0 rather than being emitted in JPGN 1.1.

The three additions are deliberately independent — Gold general and Setup chess on square boards,
fixed-start games on hex boards — but they are built against shared abstractions so that their
combinations fall out rather than being special-cased. §7.4 states exactly what that costs.

### 7.1 Gold general movement role (`gold`)

Add **Gold general** as an eighth movement archetype assignable independently to Rock, Paper, or
Scissors. It is a movement role, not a fourth capture identity: a Rock moving as a Gold general
is still Rock for the RPS capture cycle and keeps the selected Rock artwork. This preserves the
three-part game while adding a directional piece.

On the square board, a Gold general moves exactly one square:

- one square forward;
- one square diagonally forward to either side;
- one square sideways to either side;
- or one square directly backward;
- never diagonally backward.

JANKEN faces the armies from left to right rather than bottom to top. **Blue therefore moves
forward toward increasing files (to the right), while Red moves forward toward decreasing files
(to the left).** In row/column coordinates, Blue's relative destinations are
`[-1,0]`, `[+1,0]`, `[0,-1]`, `[0,+1]`, `[-1,+1]`, and `[+1,+1]`; Red receives the exact
180° rotation. Thus the movement shown to either player is the same shape viewed from their own
side. The move neither slides nor jumps: a friendly piece blocks its destination and an enemy
there is capturable only under the active capture rule.

Because this is the first colour-oriented movement role, direction belongs to the topology
adapter's movement query rather than to the UI or bot. Legal destinations must receive the
moving piece's colour, and previews must show the orientation explicitly. Mirrored test positions
must prove that Blue and Red receive exact rotated move sets. The rules summary should say
"moves one step forward, forward-diagonal, sideways, or straight back" and identify which
direction is forward.

The movement selector gains `gold`, and the macro selector gains **all Gold generals**. It may be
used by Custom square games immediately once implemented. The hex adapter rejects `gold` through
`validatePlayableCfg()` rather than silently treating it as `cross` or inventing a
topology-specific meaning. A hex Gold general can be designed later, but it must remain
directionally distinct from the six-neighbour hex `cross` before the server accepts it.

### 7.2 Hexagonal lattice (`topology`, `radius`)

The config gains `topology=square|hex`, defaulting to `square`. Square games keep `size=3..13`
unchanged. A hex game uses `radius=4..8`, where radius counts the centre cell and the cells on a
straight line from the centre to an outer corner. A radius-`r` board therefore contains
`1 + 3r(r - 1)` cells: radius 4 has 37, radius 6 has 91 (the closest analogue to Standard's
81), and radius 8 has 169. Using a radius rather than a misleading `n×n` label keeps area and
edge distance explicit.

Sanitization retains only the active dimension: square configs canonicalize `size` and discard
`radius`, while hex configs canonicalize `radius` and discard `size`. Preset recognition compares
`topology` plus that active dimension, preventing two textually different configs from describing
the same board. The UI labels the control as `Board 9×9` or `Radius 6 · 91 cells`.

Rules code must not scatter `if (hex)` branches through the existing engine. A topology adapter
owns the finite cell set, adjacency, directional rays, distance, opposite-cell transform,
canonical iteration order, and coordinate notation. Board state is keyed by logical coordinates;
movement, layout, enclosure, repetition, bots, replay, and server validation consume the adapter.
Square games remain byte-for-byte compatible through a square adapter over their current
row/column coordinates.

Hex cells use axial coordinates `(q,r)`, with the implied cube coordinate `s=-q-r`. A cell is on
the radius-`R` board when `max(|q|, |r|, |s|) < R`. Negating all three cube coordinates gives
the exact 180° opponent transform. Canonical serialization orders cells by increasing `r`, then
increasing `q`; it must never depend on object or map insertion order.

The square movement names remain useful, but their hex meanings must be exact:

| Archetype | Hex-lattice movement |
| --- | --- |
| **cross** | One step to any of the six edge-adjacent cells. |
| **rook** | Slides along the six edge-adjacent rays (the three lattice axes). |
| **bishop** | Slides along six vertex-diagonal rays. Their primitive cube vectors are the permutations of `(1,1,-2)` and their opposites. |
| **queen** | The union of rook and bishop rays: twelve rays in the interior. |
| **king** | One non-sliding rook or bishop step: up to twelve destinations. |
| **knight** | One of the twelve jumps formed by permutations of `(1,2,-3)` and their opposites. |
| **long king** | A king step, plus an exact two-cell move along a rook ray. |
| **gold general** | Rejected on hex — see §7.1. |

A bishop ray has no intervening lattice cell between successive bishop destinations; later
destinations on that ray are still blocked by the first occupied bishop destination. Knights and
ordinary Long-king two-cell moves ignore intervening cells. Under checkers capture, the Long
king's two-cell rook-ray move instead requires an adjacent enemy and an empty landing cell, and
removes that adjacent piece only when the mover beats it in the RPS cycle. A sliding ink trail
paints each actual rook- or bishop-ray destination crossed, never a geometric point where no
board cell exists.

Territory connectivity and enclosure use the six **edge neighbours**, not the twelve king
destinations. A region reaches the exterior when it contains a cell with cube distance
`radius - 1`; a closed ring of owned cells seals it. This makes capture by enclosure topologically
unambiguous — touching at a vertex never closes a boundary. Majority remains strictly more than
half of the actual cell count.

The three generated layouts also become topology operations:

- **rows** places facing bands inside opposite sectors, leaving a neutral central band;
- **corners** anchors armies at opposite vertices;
- **scattered** samples one near-side sector and creates the opponent by cube negation.

Every generated position must remain collision-free, exactly symmetric, and large enough for
`3 × perType` pieces per side. Radius sanitization must reject any piece budget that cannot fit
its legal deployment sectors rather than silently dropping pieces.

The DOM's square CSS grid is not the geometry model for this board. Hex rendering should use one
SVG view box for polygons, pieces, hit targets, annotations, coordinates, and resize/flip
transforms. Logical coordinates stay in the engine; pixel centres stay in the renderer. Keyboard
navigation follows the six edge directions, and screen-reader labels expose axial coordinates
plus a friendlier displayed cell name.

Hex records require **JPGN 2.0** rather than overloading 1.1. They add `Topology "hex"` and
`Radius`, prefix compact position layers with `H<radius>:`, and write coordinates as parenthesized
axial pairs, for example `R(-2,+1)-(-1,+1)`. Position and ownership layers use the canonical
axial order above. A 2.0 reader still accepts every square 1.0/1.1 record; a 1.1 writer never
emits a hex game.

#### Expected hex dynamics

- Radius 6 is slightly larger than Standard but has a shorter-looking, six-directional front.
  Interior kings have twelve destinations instead of eight and queens have twelve rays instead
  of eight, so contact and tactical branching increase even without increasing actions per turn.
- There are six equivalent flanks and no square-grid corner bunker. Encirclement and lateral
  attack should matter more, while retreating to an extreme vertex offers less directional
  shelter than a ninety-degree square corner.
- Bishops remain bound to one of three colour complexes. Knights, rooks, and kings bridge those
  complexes, making the R/P/S-to-movement assignment strategically sharper than on the square
  board: losing the wrong bridge piece can strand a nominal material advantage.
- An enclosure around one cell needs a six-cell ring rather than the square game's four-cell
  orthogonal ring. Loops cost more locally, but vertex contact no longer creates visually
  confusing leaks. Territory play should therefore favour broad arcs and converging fronts over
  tiny tactical boxes.
- More attack rays amplify RPS blocking. A piece the attacker cannot take can screen several
  intersecting lanes, while a counter-piece that removes the screen may open multiple rays at
  once. This should produce more cascading position changes and fewer isolated one-lane duels.

These are hypotheses, not balance claims. Before enabling rated hex play, seeded bot and random
simulations must compare radius 4–8 against square boards of similar area: branching factor,
first-player win rate, capture rate, enclosure frequency, draw/threefold/stall rate, median game
length, and the survival value of each movement archetype. The first named hex preset —
**Hex field** — uses radius 6, one action, fixed rows, and otherwise Standard rules so topology is
the only large experimental variable.

### 7.3 Setup play (`setup`)

`setup=fixed|alternating` is a phase rule rather than another board layout. `fixed` is the
current generated-position behaviour. `alternating` begins from an empty board and requires each
player to place one piece per setup turn from a fixed inventory before normal movement begins.
`actionsPerTurn` does not apply during setup.

The named **Setup chess** preset is intentionally based on King's field rather than all-kings
Standard: square 9×9, two of each type, Rock rook / Paper knight / Scissors bishop, RPS capture,
elimination, one action, and threefold enabled. Different movement roles make deployment a real
strategic phase; choosing six starting squares for identical kings would add ceremony without
enough structure.

`alternating` is a Custom-selectable rule, not preset-only, but `validatePlayableCfg()` restricts
which *other* rules may accompany it in a live room: elimination goal, one action per turn, and a
non-checkers capture rule. Territory painting, enclosure, checkers leaps, and multi-action turns
interact with a placement phase in ways nothing has measured yet, so they are rejected rather
than guessed at. Topology is **not** part of that restriction — see §7.4.

Each side's legal setup zone is a topology operation, `setupZone(colour)`:

- **square**: Blue's zone is the leftmost three files and Red's is the rightmost three, matching
  the game's existing facing orientation and leaving a three-file neutral gap;
- **hex**: the same shape along the facing axis — Blue's zone is the lowest third of `q` values,
  Red's is the highest third, and the middle third is a neutral band. For radius 6 that is
  `q ≤ -3` against `q ≥ 3` with `|q| ≤ 2` neutral. Cube negation maps one zone exactly onto the
  other, so the two sides remain perfectly symmetric.

Zone depth is `floor(columns / 3)` on both lattices, where columns is `size` or `2·radius - 1`.
`validatePlayableCfg()` rejects any configuration whose zone cannot hold `3 × perType` pieces.

On a setup turn the player chooses one remaining Rock, Paper, or Scissors and one empty cell in
their own zone. Placement sets the piece and its matching ownership layer even though ownership is
ignored by an elimination preset. A player cannot place in the opponent's zone, move an already
placed piece, pass, capture, paint/enclose territory, or begin a game move early.

Setup order is strict alternation, Blue then Red, for `6 × perType` setup plies — twelve for the
Setup chess preset. With equal inventories, Red receives the informational advantage of placing
last and Blue receives the tempo advantage of making the first normal move. This is simpler to
understand than a snake draft and gives the two asymmetries to opposite players. It must still be
measured; if one advantage dominates, the preset may swap setup-first independently of `first`
rather than changing the visible sequence.

The authoritative game state gains:

```text
phase setup|play
setupTurn B|R
setupPly integer
remaining { B:{rock,paper,scissors}, R:{rock,paper,scissors} }
placements [{ c, piece, to }]
```

Only `GameRoom` may advance this phase online. A placement message is distinct from a move:

```text
{ type: "place", piece: "rock"|"paper"|"scissors", to: [r,c] }
```

After the final valid placement, the server verifies both sides have legal movement, freezes
the completed `startPos`/`startOwners`, changes `phase` to `play`, sets `turn=first`, seeds
threefold occurrence one, and accepts ordinary moves. Setup is monotonic, so placements do not
participate in threefold repetition or the no-progress counter. If the final placement would
produce an invalid playable position, it is rejected before the phase changes.

Setup is part of the match, not a disposable lobby. Once the first placement is committed, the
room cannot be reset to escape an unfavourable deployment. If both players authenticated before
that placement, ratedness locks there rather than at the first movement action; reconnect grace,
resignation, and abandonment then apply during both phases. Rematches return to an empty setup
board. Spectators receive and may scrub placement plies, but remain read-only.

Analysis challenges are deliberately different. Starting from an exact position created on the
analysis board enters `phase=play` with that position already frozen; it does not masquerade as a
completed setup draft. This preserves the existing custom-position workflow and prevents a
client from submitting an arbitrary board as though an opponent had agreed to its deployment.

JPGN 2.0 records setup before movetext with explicit placement tokens, for example:

```text
S1.B Rb6 S1.R Ph4 S2.B Pc5 S2.R Rh5
1.B1 Rb6-c6 1.R1 Ph4-g4
```

The final setup position remains in the normal position layers for fast validation, but strict
replay also applies every placement from the empty board and requires it to reproduce those
layers exactly. GIFs and the homepage theatre may show setup at a faster cadence than game moves,
but cannot omit it from a full replay.

Bots need a deployment policy, not a hard-coded formation. The first implementation should score
legal placements by mobility, open slider lanes, distance from friendly blockers, central access,
RPS cover, and vulnerability to the opponent's remaining counters; a shallow opponent-response
term is enough before attempting a full setup search. A fixed fallback ordering remains necessary
for deterministic tests and very small devices.

#### Expected setup dynamics

- Deployment becomes a visible sequential game of commitment and response. Placing a rook early
  claims a lane but reveals where Paper can be counter-screened; holding a mobile type back keeps
  more replies ambiguous but surrenders the best squares.
- RPS blocking turns formation into a counter-chain. A front Rock may screen a Bishop-like
  Scissors from Paper, while a Paper behind it can punish the Rock counter. Material is symmetric,
  but access to that material is not.
- Rooks prefer clear files, bishops need colour-complex access, and knights tolerate congestion.
  The same inventory can therefore produce open batteries, layered fortresses, dispersed raiders,
  or deliberately sacrificial screens before move one.
- Visible alternation permits mirror and counter-deployment strategies. The three-file zones and
  neutral gap prevent an immediate placement capture, but do not prohibit copycat structures;
  initiative after the final placement is the main pressure against perfect mirroring.
- Twelve placement plies lengthen the perceived opening substantially. The UI must state
  "placing 4 of 6" and the remaining inventory more prominently than ordinary turn history, and
  bot delays should be shorter during setup.

Before rated release, self-play must compare at least fixed formations, random legal deployment,
mobility-greedy deployment, and one-ply counter-deployment. Acceptance data includes colour win
rate, setup-square and placement-order diversity, time to first capture, immediate tactical
losses, immobilized/dead starts, threefold/stall rate, and total length with setup plies reported
separately. A dominant repeated formation is a balance finding, not a reason to hide deployment;
the response should be to adjust zone depth, setup-first/play-first balance, or the preset's
movement mapping.

### 7.4 Hex and setup compose by construction

Hex and setup are independent features, shipped and measured separately. They are not, however,
allowed to become incompatible: a hex board with alternating setup must work the day both exist,
because neither one is permitted to contain code that knows about the other.

Four rules make the cross-product fall out instead of costing a milestone:

1. **Zones are geometry, not squares.** `setupZone(colour)` lives on the adapter alongside
   `cells`, `neighbours`, and `opposite`. The placement reducer asks for a cell set and never
   computes a file index.
2. **The phase reducer is topology-blind.** `isLegalAction`/`applyAction` validate a placement as
   "an unplaced piece from my inventory, onto a cell in `setupZone(me)` that `has()` and is
   empty". Nothing in that sentence mentions rows, columns, or radius.
3. **JPGN 2.0 carries both dimensions at once.** `Topology`/`Radius` tags and `S<n>.<side>`
   placement tokens are orthogonal; a hex setup record simply has both, with placements written
   in the same axial form as moves: `S1.B R(-4,+1)`.
4. **The validator gates rules interactions, not lattices.** `validatePlayableCfg()` rejects
   `alternating` with territory, enclosure, checkers capture, or multi-action turns — real,
   unmeasured rules interactions. It does not consult `topology`.

Phase 4 closes with an integration test that plays, replays, exports, and re-imports a radius-6
alternating-setup game. If that test needs a single `if (hex)` branch inside the reducer, the
abstraction is wrong and the fix belongs in the adapter, not in the reducer.

The one thing the cross-product does **not** get for free is balance data. Hex-with-setup is its
own experimental condition in §8.7 and its own row in the rating gate.

### 7.5 Implementation shape

The extensions add two abstractions to the existing architecture — **topology** and **phase** —
and do not introduce a framework, build step, second rules engine, or topology-specific Worker.

#### Topology boundary

`public/topology.js` exports square and hex adapters with one compact contract:

```text
cells · has · get/set · neighbours · rays · distance · opposite
coordKey · coordinateLabel · canonicalOrder · cellCount · setupZone
```

The square adapter wraps the existing nested row/column arrays, preserving their JSON shape and
all square position strings. The hex adapter may key storage by axial coordinates, but canonical
iteration always comes from the adapter and never from object or map insertion order. Engine
code must not index a board directly after this extraction: movement, layout, enclosure, scoring,
termination, repetition, replay, bots, analysis, and server validation all use the same adapter.

Movement generation asks the adapter for the rays or steps of an archetype at a coordinate for a
specific colour. Most archetypes ignore colour; `gold` uses it to orient forward. Checkers capture
asks the adapter for the intervening cell on an exact two-step rook ray rather than deriving a
square midpoint itself, then passes the moving and jumped pieces through the same RPS
`canCapture()` predicate used by landing captures. The no-progress bound and enclosure majority
use `cellCount`, never `size × size`.

#### Action and phase boundary

One low-level `applyBoardMove()` owns capture, movement, trails, landing ownership, and
enclosure. Authoritative play, analysis, and bot simulation all use it instead of maintaining
parallel move implementations. Capture enumeration is likewise shared: `isLegalAction()` first
asks whether the acting side has any capture when `forcedCapture` is enabled, then rejects an
otherwise legal quiet move. The client may highlight that obligation, but never decides it.

Above it, the game reducer exposes:

```text
isLegalAction(game, action, actor)
applyAction(game, action)
hasStarted(game)
ratingLockPoint(game)
```

`applyAction` dispatches `move` during play and `place` during alternating setup. Worker lifecycle
rules — whether a room remains in the lobby, whether `new` may reset it, whether abandonment
applies, and when rated identities lock — call these state predicates rather than inferring phase
from `moves.length`.

Game state also records `startMode=generated|setup|position`. A normal preset uses `generated`,
alternating placement uses `setup`, and an exact analysis challenge uses `position` and begins in
`phase=play` even if its selected ruleset is Setup chess. JPGN 2.0 records this distinction so an
arbitrary analysis position can never masquerade as an agreed placement sequence.

#### Client, replay, and rating seams

The current square DOM grid remains unchanged behind a board-view boundary. Hex uses a dedicated
SVG view that owns polygons, pieces, hit targets, coordinates, annotations, keyboard navigation,
resize, and flip transforms in one view box. The controller continues to own selection, history,
online state, and modes; it should not contain geometry branches beyond choosing the view.

JPGN writing selects its version from the game: fixed square games remain 1.1 byte-for-byte,
while hex or alternating-setup games use 2.0. The 2.0 reader accepts all 1.0 and 1.1 square
records. Spectator history, the homepage theatre, and GIF export consume one phase-aware replay
frame stream containing both placements and moves.

`isRatedEligible(cfg)` (§5b) keeps the existing square variants eligible while Gold, hex, and
setup are introduced unrated. Durable Object storage and showcase payloads already hold structured
JSON, so these additions require no D1 schema change unless later production telemetry is
deliberately added.

## 8. Delivery plan

### 8.0 Working method

The work is planned as six phases and may be implemented in one continuous sweep, but each phase
remains independently reviewable. Focused checks run when a phase settles; the complete syntax,
Workers-runtime, browser, and packaging gates run over the assembled tree before commits begin.

That trades safety for speed, so the plan pays for it up front:

- §8.8 lists the traps that a mid-sweep discovery would otherwise force a rewrite around. They
  are decided before any code is written.
- Within the sweep, the phase **order** still matters where later work depends on earlier
  semantics — most sharply, the Phase 1 golden fixtures must be generated from the post-Phase-0
  engine, before the topology refactor touches anything.
- Commits are still made phase by phase, in order, so the history reads as six reviewable slices
  rather than one 4,000-line drop. A phase-specific failure is resolved before later work can hide
  its cause, while the final full gate proves the phases work together.
- `npm run verify` must pass on the complete tree before the first commit. Push once every phase
  is committed and the tree is clean.
- Nothing is deployed as part of this work. `npm run deploy` stays a deliberate, separate act.

### 8.1 Phase 0 — pay the rules debt

Sections 1 and 2 already specify two rules the code does not implement. This phase makes the
existing spec true before anything is built on top of it.

- `engine.sanitizeCfg()` gains `forcedCapture` (default `false`), independent of the capture
  mechanism: choosing checkers capture in a Custom game must not silently rewrite it.
- A `sideHasCapture(board, colour, cfg)` predicate and obligation-aware move filtering, applied by
  `isLegal()`/`allMoves()` and recomputed **before each action** of a multi-action turn. Client
  hints highlight the obligation; the server decides it.
- `captureTarget()`'s checkers branch requires the mover to beat the jumped piece in the RPS
  cycle. A non-beaten enemy blocks the leap.
- `rulesVersion` stamping: new games carry the current version; a persisted in-progress game
  without the stamp finishes under legacy 1.0 (unrestricted leap), and its rematch starts under
  the current rule. The legacy path exists only in migration/replay code.
- `PRESETS.checkers` sets `forcedCapture: true`; every preset spells the field out; `presetOf()`
  compares fifteen fields.
- `rulesSummary()` and `variantLabel()` describe the obligation and the RPS leap restriction.
- UI: an independent **Forced captures** checkbox in the rules editor, wired to `ownRules` and
  the preview facts.
- `notation.js`: `forcedCapture` in the `Rules` string, absent ⇒ `false`; `RulesetVersion "1.1"`
  written; `"1.0"` records replayed under the legacy leap.
- Tests: obligation filtering, per-action recomputation, a blocked non-beaten leap, a legacy 1.0
  record replaying unchanged, preset round-trips.
- Docs: `docs/JPGN.md` gains the field and the version semantics, and its stale `Ruleset` list is
  corrected to the full preset library. `README.md` describes forced captures.

### 8.2 Phase 0b — export and theatre presentation

Two presentation changes that are cheap now and expensive later: both touch surfaces that
Phases 3 and 4 extend, and the GIF palette change must land before Phase 1 freezes its golden
fixtures.

**GIF export (§5c).**

- Two sixteen-entry palettes with identical index meanings — the current dark set and a light
  counterpart. `exportGameGif(record, { theme })` selects one; an absent `theme` keeps the dark
  palette, so the Workers-runtime test path is unchanged.
- Retire the saturated purple last-move colour. The highlight becomes a low-contrast wash with
  **two** entries, one per square parity, taken from the spare palette slots — the checker
  pattern and any painted territory stay legible underneath it.
- `drawPiece` hook: `game.js` rasterizes the active `pieces.js` glyph per `(type, colour, style,
  cell)` into an `OffscreenCanvas`, quantizes to the palette, and caches it. `gif.js` calls the
  hook when given one and falls back to its own geometry when not. The exporter never imports
  `pieces.js` and never touches the DOM.
- Tests assert palette selection, the two-entry highlight, and that the no-hook path still
  produces today's structure. The rasterizer is exercised by hand in a browser, never in CI.

**Variant theatre (§3).**

- Move the theatre into the lead section beside the play card; on narrow screens it stacks
  directly beneath it, above the variant chips.
- It still opens on the newest completed online game, then switches for the rest of the visit to
  previewing the active ruleset on the first hover, focus, selection, or custom-rule edit.
- Every ruleset change restarts the game rather than mutating the running one, debounced so a
  dragged slider produces one restart. `/api/showcase` is fetched at most once per visit and
  never on restart.
- Existing guards hold: lazy module load after first paint, paused off-screen and while hidden,
  a still final position for reduced-motion users, and a reserved box so the play card never
  reflows when the theatre arrives.

### 8.3 Phase 1 — square topology adapter

Extract geometry without changing a single observable byte of square play.

- New `public/topology.js` exporting the §7.5 contract, with a square adapter over the current
  nested row/column arrays.
- `engine.js` stops indexing boards directly: movement, layout, enclosure, scoring, termination,
  repetition, replay, and `capturesPossible()` all consume the adapter. `cellCount` replaces
  `size × size` in the no-progress bound and the enclosure majority.
- `game.js`'s bot stops reimplementing move application inline and calls the shared
  `applyBoardMove()`; the server keeps calling the same reducer it already does.
- New `engine.validatePlayableCfg()` and `engine.isRatedEligible(cfg)` (§2, §5b), with `GameRoom`
  consulting both at room creation, rematch, and rating lock.
- **Golden fixtures are the acceptance test.** Generated from the post-Phase-0/0b engine *before*
  the refactor and committed as data: every preset's start layers, a full legal-destination map
  per archetype, repetition keys, a representative JPGN 1.1 record byte-for-byte, a fallback-path
  GIF frame, and a room lifecycle transcript. The refactor is done when those fixtures still
  match exactly.

### 8.4 Phase 2 — Gold general

- `gold` in `MOVEMENT_TYPES`, labels, descriptions, sentences, and the adapter's colour-aware
  movement query. No colour logic anywhere outside the adapter.
- Selector option, **all Gold generals** macro, preview arrows that show the orientation, rules
  summary text naming which direction is forward, analysis board, bots, notation enum, and
  server-side validation.
- Mirrored-position tests proving Blue and Red receive exact 180° rotations of each other's move
  sets, plus a test that `validatePlayableCfg()` rejects `gold` on hex once Phase 3 exists.
- Ships unrated (§5b) and in no named preset.

### 8.5 Phase 3 — hex lattice

- Hex adapter: axial storage, `max(|q|,|r|,|s|) < R` membership, six edge neighbours, the twelve
  king/queen rays, the twelve knight jumps, cube-negation `opposite`, canonical order by
  increasing `r` then `q`, `cellCount`, axial `coordinateLabel`, and `setupZone`.
- `topology`/`radius` in `sanitizeCfg()` with the inactive dimension discarded; `presetOf()`
  compares topology plus the active dimension; `validatePlayableCfg()` rejects impossible piece
  budgets and `gold` on hex.
- The three layouts as topology operations, each collision-free and exactly symmetric.
- Enclosure and territory over edge neighbours; majority strictly over half of `cellCount`.
- One SVG board view behind the board-view boundary: polygons, pieces, hit targets, coordinates,
  annotations, six-direction keyboard navigation, flip and resize — all in one view box. The
  square DOM grid is untouched.
- Hex renderers for the GIF exporter (reusing its existing scanline `polygon()`, both Phase 0b
  palettes, and the same `drawPiece` hook), the variant preview, and the theatre.
- **JPGN 2.0**: `Topology`/`Radius` tags, `H<radius>:` position and ownership layers, axial move
  coordinates, version selected from the game, and a 2.0 reader that still accepts every 1.0/1.1
  square record.
- Property tests: symmetry of generated layouts under cube negation, ray/blocking correctness per
  archetype, enclosure sealing and leak-freedom at vertices, canonical-order determinism, and
  randomized termination across radii 4–8.
- One unrated named preset, **Hex field**: radius 6, rows, one action, otherwise Standard.

### 8.6 Phase 4 — setup phase

- Phase-aware reducer: `isLegalAction`, `applyAction`, `hasStarted`, `ratingLockPoint`,
  `startMode`, over the shared `applyBoardMove()`.
- Game state gains `phase`, `setupTurn`, `setupPly`, `remaining`, `placements`; placements are
  excluded from repetition and the no-progress counter.
- `GameRoom`: `{type:"place"}` handling, `hasStarted()` replacing every `moves.length === 0`
  lifecycle test, ratedness locked at the first placement, reconnect/abandonment across both
  phases, rematch to an empty setup board, and a final-placement validity check before the phase
  flips.
- `validatePlayableCfg()` restricts `alternating` to elimination, one action, and non-checkers
  capture — and deliberately not by topology (§7.4).
- Client: placement UI with inventory and "placing 4 of 6", zone highlighting, shorter bot delays
  during setup, spectator scrubbing of placement plies, and one phase-aware replay frame stream
  feeding history, theatre, and GIF.
- Bot deployment policy scoring mobility, lanes, blockers, central access, RPS cover, and
  opponent counters, with a deterministic fixed fallback ordering for tests.
- **JPGN 2.0** placement tokens plus strict replay that re-applies every placement from the empty
  board and requires it to reproduce the frozen layers exactly.
- **Setup chess** preset (King's-field movement, square 9×9), unrated.
- Closing integration test: a radius-6 alternating-setup game played, replayed, exported, and
  re-imported — with no topology branch inside the reducer (§7.4).

### 8.7 Phase 5 — simulation harness and balance data

- `scripts/simulate.mjs`: a deterministic, seeded self-play harness runnable from the CLI with no
  network or D1 access, reporting per condition: branching factor, first-player win rate, capture
  rate, enclosure frequency, draw/threefold/stall distribution, median and tail game length,
  immobilized/dead starts, and per-archetype survival value.
- Conditions: square baselines, hex radii 4–8, Gold-general assignments, and the four deployment
  policies (fixed, random legal, mobility-greedy, one-ply counter) — plus hex × setup as its own
  condition.
- A fast smoke test keeps the harness honest in CI; the long runs are manual.
- Results and interpretation land in `docs/BALANCE.md`, with the raw seeded parameters recorded
  so any figure can be reproduced.

### 8.8 Anticipated issues

Decided in advance, because a single sweep has no natural place to discover them.

1. **Fixture ordering.** Phase 1's goldens must be generated from the post-Phase-0/0b engine.
   Capture them before touching geometry, or the refactor bakes in the pre-Phase-0 checkers
   semantics — and a GIF frame captured before the palette change is a fixture of a colour scheme
   that no longer exists.
2. **`presetOf()` grows three times** (Phase 0, 3, 4). Every preset must spell out every compared
   field or a variant silently reports an earlier preset's name. The round-trip test catches it
   only if new presets are added to it.
3. **Keep the validators separate.** `sanitizeCfg()` stays total and non-throwing; every rejection
   belongs in `validatePlayableCfg()`. Adding a throw to sanitization breaks restored browser
   state and every historical record.
4. **Forced capture is per action, not per turn**, and the client must consult the same predicate
   the server enforces — never its own copy.
5. **`rulesVersion` is one-way.** The unrestricted leap is reachable from migration and replay
   only; no UI path may produce it.
6. **`size × size` is a hex bug.** The no-progress bound (`engine.js` terminal reason `stall`) and
   the enclosure majority both assume a square board today; both must move to `cellCount`.
7. **Canonical order must come from the adapter.** Any reliance on object or `Map` insertion order
   makes `encodePos()` and repetition keys nondeterministic, which corrupts threefold detection
   and JPGN round-trips in ways tests may only catch intermittently.
8. **Setup is monotonic.** Placements must not enter repetition keys or reset `dry`, or a setup
   game can draw before it starts.
9. **`moves.length === 0` appears in three lifecycle decisions** in `src/worker.js` — the lobby
   open test, the `new` refusal, and the rating lock. All three must become `hasStarted()` /
   `ratingLockPoint()`, or a setup game is resettable mid-draft and mis-rated.
10. **The bot currently reimplements move application** inline in `game.js`. Until it calls
    `applyBoardMove()`, gold, hex, and forced capture will diverge between what the bot simulates
    and what the engine allows.
11. **JPGN version selection is a compatibility test, not a preference.** Existing tests compare
    square records byte-for-byte; the writer must keep emitting 1.1 for fixed square games.
12. **`MAX_PIECES_PER_SIDE` stays single-source.** Hex layers reuse it; a second constant would
    let `blocksBoard` and `decodePos` drift apart.
13. **Downstream decoders assume `cfg.size`.** `gif.js`, `showcase.js`, and the variant preview
    each decode `startPos` with a square dimension; all three must go through the adapter.
14. **Annotations and flip are geometry.** The annotation SVG maps to the square board's content
    box; the hex view needs its own mapping inside the same board-view boundary, not a second
    controller.
15. **The rating gate must be visible before the result.** An unrated variant says so in the play
    card and the room status line — never only in the end-of-game banner.
16. **`gif.js` must stay DOM-free.** The moment the encoder imports `pieces.js` or reaches for a
    canvas, it stops running in `workerd` and the GIF suite stops being able to test it. Piece
    rendering arrives as an argument or not at all, and the hook is never the asserted path.
17. **One debounce, one hover source.** The variant stage preview and the theatre restart fire
    from the same hover/focus/edit events. Wire them to one debounced signal — two independent
    listeners will disagree about which ruleset is on show for a few hundred milliseconds, and a
    slider drag will start a game per tick.
18. **Later phases extend Phase 0b's surfaces, never fork them.** Phase 3's hex GIF renderer uses
    the same two palettes and the same `drawPiece` hook rather than introducing a third scheme,
    and Phase 4's placements must appear in the theatre through the shared phase-aware frame
    stream — the theatre is a consumer of that stream, not a second replayer.

### 8.9 Rating gates

Ratings stay off for Gold generals, hex boards, and alternating setup for now — that is a
decision, not an oversight, and `isRatedEligible(cfg)` is the single place it is expressed.

Widening the gate is a separate, auditable change, made per mode, only when §8.7's harness shows,
for that mode:

- a first-player win rate within a defensible band of the square baseline;
- no dominant degenerate line (a single repeated formation, a forced early trade, or a piece
  archetype whose survival value collapses);
- a draw/threefold/stall distribution comparable to shipped square variants;
- a median game length that does not make abandonment the common ending;
- for setup, placement diversity high enough that deployment is a real decision;
- for hex × setup, its own row — passing hex and passing setup separately does not grant it.

Until then the modes are fully playable, fully replayable, exportable, and spectatable. They just
do not move anyone's Elo.
