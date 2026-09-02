# JANKEN — specification

Rock–paper–scissors played like chess on a square board. Zero-build static client plus a
Cloudflare Worker with Durable Objects for authoritative online play. Live at
**rps.subsurfaces.net**. Read [`CLAUDE.md`](./CLAUDE.md) first for the repo map and invariants.

## 0. How to read this

`[x]` shipped · `[ ]` not built · `[~]` partial, defect noted inline.

Sections 1 to 6 are the contract: what the site *is*, stated as tersely as it can be stated
without losing a decision. Section 7 is the backlog in dependency order, and is the only place
that says what to build next. Section 8 holds design detail for unbuilt features that would be
expensive to re-derive. Section 9 lists the traps.

An unchecked box in sections 1 to 6 is a debt against something already specified; an unchecked
box in section 7 is work not yet started.

## 1. Rules

Two players, **Blue** and **Red**, alternate turns. Each starts with `perType` of each piece
(rock, paper, scissors), arranged with 180° rotational symmetry. JANKEN faces the armies left to
right, so Blue's forward is increasing files.

### Movement — `rockMove` / `paperMove` / `scissorsMove`

Each RPS type independently takes one archetype. Only rook, bishop and queen slide, so only they
can paint ink trails.

| | |
| --- | --- |
| [x] `king` | one square any direction |
| [x] `rook` | slides orthogonally |
| [x] `bishop` | slides diagonally |
| [x] `knight` | chess 2-by-1 jump |
| [x] `queen` | slides orthogonally or diagonally |
| [x] `cross` | one square orthogonally |
| [x] `longking` | king step, or exact two-square orthogonal jump |
| [ ] `gold` | colour-oriented single step (§8.1) |

Sliders are blocked by pieces but pass over painted empty squares. Knight and ordinary long-king
jumps ignore the intervening square. Legacy `moveStyle=classic|kings|queens` still parses and
expands to the three explicit fields at the trust boundary.

### Capturing — `capture`

- [x] **rps** (default): a piece captures only what it beats, rock > scissors > paper > rock. A
  non-capturable enemy blocks movement.
- [x] **chess**: any enemy may be captured.
- [x] **checkers**: ordinary moves cannot capture. An exact two-square orthogonal leap over an
  adjacent enemy onto an empty square removes the jumped piece. Sanitization forces all three
  movement fields to `longking` so the rule is always usable. No chaining.
  - [x] The leap requires that the mover **beats** the jumped piece in the RPS cycle: Paper
    leaps Rock, Rock leaps Scissors, Scissors leaps Paper. A non-beaten enemy blocks the leap
    exactly as it blocks a landing capture. Games stamped `rulesVersion=1.0` keep the original
    unrestricted leap; nothing else can reach it.
- [x] `forcedCapture` (default `false`, independent of the capture mechanism). When on, the engine
  checks the side to act before **each action**: if any legal capture exists anywhere in that
  army, every non-capturing move is illegal. Recomputed after each action of a multi-action turn.
  Applies to RPS landing captures, chess captures and RPS-legal checkers leaps; a leap over a
  non-beaten enemy never creates an obligation. It does not require the longest capture, grant a
  bonus action, or chain. `sideHasCapture()` is the one predicate; `legalDest()` filters on it, so
  the client's highlights, the bot's search and the server's validation cannot disagree.

### Goal — `territory`

- [x] **elimination** (default, what Standard plays): no painting. Capture all opposing pieces, or
  hold the most when the game ends. It ends as soon as **no capture is possible any more**, judged
  on surviving piece *types* rather than geometry: under RPS rules a side holding only rocks can
  never take a side holding only rocks, however either moves. `engine.capturesPossible()` decides
  this. It is deliberately not "nothing is currently en prise", which would be true on move one.
- [x] **territory**: every landing square is painted permanently. A piece may stop on an empty
  square permitted by `retread`, or on a capturable enemy. Most squares wins.
  - [x] `retread` allows stopping on painted empty squares; defaults on with territory.
  - [x] `trail` makes sliding moves paint the **unclaimed** squares crossed, never repainting.
  - [x] `enclosure` claims any orthogonally connected region sealed from the edge by a closed loop
    of the mover's territory, flipping every square inside and removing enemy pieces there. First
    side past half the board wins immediately.

### Starting layout — `layout`

All layouts have 180° rotational symmetry.

- [x] **rows** (default): centred side-facing blocks. On Standard 9×9, Blue fills b4–c6 and Red the
  exact mirror on g4–h6. Narrow boards wrap wider piece sets across extra centred rows.
- [x] **corners**: blocks anchored to opposite corners.
- [x] **scattered**: random cells in each player's near half, fair because the generated board is
  itself the shared state.
- [x] **azel**: a named formation rather than a generated one — three scissors screening rock,
  paper, rock on the two files nearest each player, vertically centred. Alone among the layouts its
  material is **not** uniform: two rocks, one paper and three scissors a side, fixed, whatever
  `perType` says. `startingMaterial(cfg)` is the single place that asymmetry is expressed, and
  `rulesSummary()`, the preview and JPGN all read it rather than assuming `perType` describes the
  board. Needs 4×4 or larger to keep the two walls disjoint, so `sanitizeCfg()` reads `layout`
  before `size` and clamps the board up rather than dealing an impossible position.

### Turns — `actionsPerTurn`

- [x] 1 to 3 consecutive moves by the same player. The game ends immediately when either player has
  no legal move, either has no pieces, no neutral territory remains, an enclosure game reaches a
  strict majority, the same playable state occurs a third time, or the bounded no-progress guard
  fires. Repetition identity covers the piece layer, painted territory when active, side to move,
  and actions already used this turn. There is no pass phase: a mobile player cannot pad their
  score against an immobilized opponent.

### Presets

`PRESETS` is the library, `PRESET_INFO` carries label and tagline, `PRESET_KEYS` fixes picker
order. Every preset spells out **every** compared field so `presetOf()` recognises it exactly.

| | Preset | Rules |
| --- | --- | --- |
| [x] | **Standard** | 9×9, all kings, RPS, elimination, one action |
| [x] | **Skirmish** | 3×3, one per type, elimination |
| [x] | **Azel's wall** | 5×5, azel layout, all kings, RPS, elimination |
| [x] | **Triple step** | three actions, territory with re-tread |
| [x] | **Cavalry** | all knights, territory with re-tread |
| [x] | **Painters** | all queens, territory with ink trails, no re-tread |
| [x] | **Ambush** | scattered start, territory with re-tread |
| [x] | **Siege** | corner stand-off, territory without re-tread |
| [x] | **Expanse** | 13×13, four per type, territory with re-tread |
| [x] | **King's field** | Rock rook / Paper knight / Scissors bishop, elimination |
| [x] | **Checkers** | 8×8, all long kings, RPS-restricted leap captures, forced captures, elimination |
| [x] | **Melee** | all kings, RPS, territory with re-tread and enclosure, first past half wins |
| [ ] | **Hex field** | radius 6 hex, otherwise Standard (§8.2) |
| [ ] | **Setup chess** | 9×9 alternating placement, King's-field movement (§8.3) |

Overriding any rules field gives **Custom**. Adding a variant is a one-file change plus §1 and
`README.md`; a ruleset identical to an existing preset fails the round-trip test by design.

## 2. Config schema

```text
topology square|hex (default square)                    [§8.2]
size 3..13 (square) · radius 4..8 (hex)                 [§8.2]
perType 1..4 (clamped to board/layout capacity)
rockMove|paperMove|scissorsMove <archetype>
capture rps|chess|checkers · forcedCapture bool
rulesVersion 1.0|1.1 (migration and replay only, never a setting)
territory bool · retread bool · trail bool · enclosure bool
layout rows|corners|scattered|azel
setup fixed|alternating (default fixed)                 [§8.3]
threefold bool (default true) · actionsPerTurn 1..3 · first B|R
```

- [x] `territory` is opt-in; an absent flag sanitizes to `false`, so a room created with no config
  is Standard. `retread`, `trail`, `enclosure` are forced off when `territory` is off.
- [x] Every named variant sets `threefold=true`; the UI exposes it, and turning it off gives
  Custom. New games count their initial state as occurrence one. Rooms persisted before tracking
  existed seed their current state as occurrence one rather than inventing history.
- [x] Movement macros (all kings, all long kings, rook/knight/bishop, all queens) fill only the
  three canonical fields and add no config field. Choosing checkers capture applies the long-king
  macro; moving away from that set returns capture to RPS.
- [x] An absent `forcedCapture` stays `false` everywhere, including persisted rooms and JPGN
  written before the field existed, so historical Checkers games keep their legality.
- [x] `rulesVersion` stamping. New games carry the current version. A persisted in-progress game
  without the stamp finishes under legacy 1.0 (unrestricted leap); its rematch starts under the
  current rule. The legacy path exists only in `GameRoom`'s hydration and in `parseRules()`, and is
  never a setting. `presetOf()` deliberately does not compare it: it says which edition a game
  finishes under, not what variant it is, so a legacy record keeps its preset name.
- [x] `layout=azel` forces `perType` to 2 — six pieces, stated as 3 × 2 — so the field stays
  comparable across records even though the deal is 2/1/3.

### Client-only preferences

Not rules. Never compared by `presetOf()`, never sent as authoritative state.

- [x] `pieceStyle` (IDs from `public/pieces.js`), `coords`, `hints`, theme, board flip, guest name.
  An invalid or retired style ID falls back to `line`.
- [x] `coordStyle` chess|grid, `zen` bool, `botLevel` normal|perfect.
- [x] `cfg` is the live config the board plays under, which an online room's rules overwrite;
  `ownRules` is the variant this player chose. Only `ownRules` plus view preferences persist, so
  visiting someone else's game never rewrites your saved preset.

### Two validators, two jobs

- [x] `sanitizeCfg()` is a **total, non-throwing canonicalizer**. It clamps, defaults, expands
  legacy fields and returns something playable for any input including hostile network payloads.
  It is the only place a rules field acquires its final value.
- [ ] `validatePlayableCfg()` **rejects**: combinations sanitization could only paper over by
  silently converting one advertised game into another. Called at live-room creation, rematch and
  analysis challenge; local play does not need it because falling back to Standard is honest
  there. **[D6]**

## 3. Client

| | Module | Responsibility |
| --- | --- | --- |
| [x] | `engine.js` | pure rules, single source of truth |
| [x] | `notation.js` | JPGN 1.1 writer, 1.0-compatible parser, strict legality-checked replayer |
| [x] | `gif.js` | lazy dependency-free indexed GIF encoder plus deterministic board renderer, DOM-free |
| [x] | `pieces.js` | colour-aware SVG piece families, `glyph(type, color, style)` |
| [x] | `showcase.js` | lazy replay theatre, visibility and reduced-motion guarded |
| [x] | `tablebase.js` | 3×3 addressing, symmetry, decoding; shared with the generator |
| [x] | `game.js` | preview, local play, board and editor render, lobby, exports, online client |
| [x] | `bot.js` | one opponent for every ruleset: derived weights, alpha-beta through `applyMove()` (§6g) |
| [x] | `bot-tuning.js` | generated weight overrides keyed by ruleset fingerprint; ignored when stale |
| [x] | `atlas.js` | `/atlas`, the tablebase page |
| [x] | `puzzle.html`, `puzzle.js`, `puzzle.css` | `/puzzle`, the focused solver-checked daily puzzle |
| [x] | `lab.js` | exact state-space counting and seeded self-play, shared by `scripts/lab.mjs` and the atlas |
| [ ] | `topology.js` | square and hex lattice adapters, the only code that knows what a cell is **[D6]** |

- [x] Home leads with the play card (name, current variant, the four ways into a game) so the first
  action needs no scrolling. Variant choice is a refinement below it.
- [x] The variant stage sits above the collapsed rules editor. Hovering or focusing a preset chip
  previews that variant across board, movement cards, description and facts without committing;
  leaving restores the selected config.
- [x] The selector preview renders the real start formation plus a synthetic selected piece and
  calls `engine.legalDest()` for arrows. Everything it shows comes from the sanitized config.
- [x] `rulesSummary(cfg)` explains the game from scratch **for the config passed in** and is the
  single source for the board-side rules flap and the how-to dialog, so the two cannot drift. A
  shared archetype is stated once ("Every piece…") rather than three times.
- [x] The rules flap is a tab clipped to the board's left edge in its own column beside
  `.board-stage`; annotation overlay, banner and resize grip position against the stage, so the
  board stays an exact square regardless of the tab.
- [x] Board and editor palette are built only when play begins. Piece SVGs, move logs and classes
  update only when their values change.
- [x] The analysis panel swaps named rules without leaving the board. Its custom-rules action
  reuses the Home editor and preserves the draft; only a board-size change resets the position.
  Mirror rebuilds Red from Blue, Rotate turns the position 180°, Reset uses the layout.
- [x] Click-to-move and pointer drag share one commit path. The annotation SVG maps exactly to the
  board's inner content box.
- [x] Spectators reconstruct history from the room's authoritative start layers and move list, and
  can scrub; incoming moves append without pulling them off the ply under review.
- [x] The lobby polls immediately then every 12s, pauses while hidden, prevents overlap, times out
  stalled requests and backs off exponentially. Sockets reconnect with jittered backoff; network
  loss, reconnecting, replaced-tab and expired-room states are explicit.
- [x] Today's puzzle sits under the theatre on Home, hidden until the tablebase answers — a puzzle
  nobody can mark is worse than none — and links to `/puzzle`. It loads later than the theatre
  because it pulls a table down and nothing on the page waits for it.
- [x] `/puzzle` is a dedicated, spoiler-safe solving surface for that same daily position, with
  random follow-ups, active piece artwork, and immediate correct/wrong feedback. The Atlas keeps
  its puzzle section as the deeper analysis surface rather than being the only place to solve.
- [x] The theatre sits **beside the play card**, stacking beneath it on narrow screens. It opens on
  the newest completed game of the variant on show and falls back to a bot game generated under
  exactly those rules. Every ruleset change **restarts** it rather than mutating a game in flight,
  debounced once inside `showcase.js` so a dragged slider starts one game. `/api/showcase` is
  fetched at most once per visit and never on a restart: switching variants is a filter over what
  is already in hand plus a local simulation.

## 4. Worker and Durable Objects

### `GameRoom`, one per room

- [x] Owns the canonical game and re-validates every move with `engine.isLegal()`.
- [x] WebSocket Hibernation API with serialized connection attachments.
- [x] Mints its own unguessable seat tokens. A client-supplied token is honoured only if it already
  holds that seat, so no client can pick a weak capability; a valid-token reconnect keeps its
  colour and fences the older connection.
- [x] `unlisted` rooms never enter the lobby index, and the flag survives rematches.
- [x] Refuses to discard a game in progress. `new` is accepted only once the game is over or while
  the board is untouched, so a losing player cannot escape a rated result: the ways out are
  finishing, resigning, or the abandonment alarm.
- [x] Broadcasts names, occupied seats and presence. Holds a disconnected seat 60s then releases it
  by alarm.
- [x] Refreshes a 30-minute idle expiry on meaningful activity. Expiry removes the lobby row,
  notifies and closes sockets, calls `storage.deleteAll()` and resets **every** instance field via
  `resetRoom()`.
- [x] Caps spectators and per-connection message rate; messages are size-limited and coordinates
  must be integers.
- [x] Relays sanitized chat straight to sockets without storing it, behind its own short-window
  limiter. Spectators stay read-only.
- [x] Accepts resignation only from a seated player once both seats are occupied.
- [x] After a completed game, queues one idempotent compact replay write to D1 for the feed.
- [ ] Lifecycle tests use `hasStarted()` / `ratingLockPoint()` rather than `moves.length === 0`.
  **[D7]**

### `Lobby`, one global index

- [x] SQLite-backed DO used as a table keyed by room: one row per change, pruned at the same
  30-minute horizon, at most 100 rows retained, newest 40 returned. Pruning is time-gated to once
  a minute rather than deleting on every poll.
- [x] Each room persists whether it is indexed plus a metadata fingerprint, so unchanged move and
  presence broadcasts return locally instead of issuing a cross-object SQL write. Only open/closed
  or host-metadata transitions touch the index.
- [x] Migrates the original whole-object `games` key on first construction.

### HTTP and WebSocket boundary

- [x] `/ws` GET upgrades only, validated room IDs, mismatched browser origins rejected.
- [x] `/api/lobby` GET only, three-second edge cache. `/api/showcase` GET only, 30-second cache.
- [x] Static assets carry CSP, frame, MIME, referrer, permissions and cross-origin headers.
- [x] Structured error logs carry event and room context, never seat tokens. 5% trace sampling.

## 5. Online protocol

```text
connect  /ws?room=&name=&token?=&cfg?=
server   { type:"welcome", role:"B"|"R"|"S", token, state }
client→  { type:"move", from:[r,c], to:[r,c] } · { type:"new", cfg, pos?, own? }
         { type:"auth", id, secret } · { type:"chat", text } · { type:"resign" } · { type:"sync" }
         { type:"place", piece, to }                                        [§8.3]
server→  { type:"state", state } · { type:"chat", role, name, text, ts }
         { type:"error", msg } · { type:"expired" }
```

- [x] `cfg` may carry `unlisted`, plus `pos` (one char per cell: `.` empty, `R/P/S` Blue, `r/p/s`
  Red) and `own` (`B`, `R`, `.`). Both are validated by the shared engine; positions need both
  sides and at most `engine.MAX_PIECES_PER_SIDE` each, one constant so `blocksBoard` and
  `decodePos` cannot drift. Challenge rooms keep both layers across rematches.
- [x] `state` carries board, exact start layers, listing privacy, start time, turn, actions used,
  structured moves, game-over reason, last move, sanitized config, result, names, seats, presence
  and the rating fields. Blue selects config and position for a new online game; Red rematches
  with the current ones. Chat is transient and never in `state`.
- [x] On rematch the two seated players swap colours, their seat tokens move with them, and both
  receive a fresh `welcome` before the new state, so the first mover alternates fairly.

## 6. Accounts, notation, tablebase, release

### 6a. Accounts and ratings (D1)

- [x] Device-bound pseudonyms: unguessable id plus a secret stored as its SHA-256 hash. Tables
  `accounts`, `matches`, `showcases`, `signups`. All endpoints `no-store`.
- [x] `POST /api/account {name}` mints one, throttled to 6/hour per source. The bucket is a
  salted truncated hash of `cf-connecting-ip`, stored in `signups` and pruned as it ages out:
  countable, never stored against an account, not reversible without the deployment secret. A
  request with no `cf-connecting-ip` is not throttled, there being nothing trustworthy to
  attribute.
- [x] `POST /api/account/verify {id,secret}` for transfer-code restore, `POST /api/account/name`
  to rename, `GET /api/profile?id=` for public stats plus the 20 most recent rated games,
  `GET /api/showcase` for up to four replayable completed games (newest 40 retained).
- [x] A seated player binds an account with `auth` after `welcome`. When **both** seats are bound
  at the rating lock point, the game snapshots as rated with a fresh `matchId`. On game over, or
  30-second disconnect abandonment adjudicated by alarm while the opponent is present,
  `finishRated` applies plain Elo (K=32, draws 0.5) in one D1 batch, and the match-id primary key
  makes a duplicate report roll back harmlessly. A failed rating write is logged **and** reported
  as `ratingError` so the banner says so. Any guest keeps the game unrated.
- [x] `GET /admin` is an unlinked `noindex` dashboard; `POST /api/admin/stats {key}` compares
  `ADMIN_KEY` in constant time and throttles failures. The key lives only in `sessionStorage`.
  Infrastructure metrics stay in the Cloudflare dashboard, linked from the page.
- [ ] `isRatedEligible(cfg)`, the single place the policy lives. Eligible: square topology, fixed
  start, the seven original archetypes, any capture, any goal. Not eligible: gold, hex,
  alternating setup. An ineligible ruleset plays unrated and says so **in the play card and the
  room status line**, never only in the end-of-game banner. **[D6]**
- [ ] Username and password accounts with create-account and login pages. **[D3]**

### 6b. JPGN

- [x] **JPGN 1.1** is canonical: event metadata, named ruleset and version, explicit movement
  assignments, exact sanitized rules, separate piece and ownership layers, ratings when available,
  structured multi-action movetext, result, score, termination reason. The parser accepts legacy
  1.0 `moveStyle` records, replays every action through `engine.isLegal()` and rejects
  inconsistent captures, turns or results. Format: [`docs/JPGN.md`](./docs/JPGN.md).
- [x] Optional `Coords "grid"` tag. Display metadata only: move text stays chess-style so two
  records of the same game are byte-identical whatever the author's preference. **[A1]**
- [x] `forcedCapture` in `Rules` (absent ⇒ false) and `RulesetVersion` carrying the rules edition
  (absent ⇒ 1.0, so a record written under the unrestricted leap still replays).
- [ ] **JPGN 2.0** for hex and setup, selected from the game itself: a fixed-start square game
  stays 1.1 byte-for-byte. A 2.0 reader accepts every 1.0 and 1.1 square record. **[§8.2, §8.3]**

### 6c. GIF export

- [x] Reconstructs the exact position and action stream, samples only when a game is very long,
  draws an indexed board and encodes GIF89a entirely on demand.
- [x] **Theme.** Two sixteen-entry palettes with identical index meanings, the existing dark set
  and a light counterpart, selected at export time. The index layout is deliberately unchanged so
  the encoder, sampler and tests never know which palette is in play; an absent theme keeps dark,
  which is the Workers-runtime test path.
- [x] **Last move.** The saturated purple is replaced by a low-contrast wash in **two** palette
  entries (slots 9 and 14), one per square parity. It reads as a light lift of the square beneath
  it rather than a third colour competing with the two players. On unclaimed ground the wash fills
  the square; on painted ground it becomes an inset frame instead, because sixteen colours cannot
  hold a lift of all six square colours and whose territory a square is matters more than where the
  last move went. A test asserts each wash sits near the square it lifts, far from both player
  colours, and still distinguishable between parities.
- [x] **Piece style.** An optional `drawPiece` hook carries the client's active `pieceStyle`.
  `game.js` rasterizes the `pieces.js` glyph per `(type, colour, style, cell)` to an
  `OffscreenCanvas`, quantizes to the palette and caches it. `gif.js` imports nothing from
  `pieces.js` and touches no DOM: with no hook, in tests or in a DO, it draws its own geometry
  exactly as today. Browser rasterization is not byte-identical across engines, so it is never the
  asserted path.

### 6d. The 3×3 tablebase

- [x] Skirmish is small enough to solve outright and `/atlas` publishes the solution. Six labelled
  pieces, each captured or on one of nine squares, give **207,775** placements and **415,550**
  turn-states. `scripts/tablebase.mjs` enumerates them, walks every legal move with `engine.js`
  and works backwards from the terminals: won where some move reaches a lost position, lost where
  every move reaches a won one, drawn where it never resolves.
- [x] The solver states no rule of its own. Movement, capture and termination come from the module
  the browser and the DO play by, so a published verdict is a verdict about the shipped game. That
  is why a preset change forces regeneration rather than a footnote.
- [x] One variant per movement archetype, everything else held at Skirmish. A uniform archetype is
  what makes relabelling rock→paper→scissors an automorphism, so each variant's symmetry group is
  D₄ × C₃, order 24; a mixed assignment would keep only D₄.
- [x] `public/tablebase/<id>.tb` is one gzipped byte per turn-state, value in bits 6–7 and DTM in
  bits 0–5. `manifest.json` carries per-variant cfg, W/D/L, material layers, opening grid and
  sizes. Placements address themselves by a base-10 key over the six pieces, digit 0 captured and
  1–9 a square, so a lookup is arithmetic into a flat array rather than a search. Symmetry is
  therefore presentation, not storage: 406 KB flat, 43–158 KB compressed.
- [x] Two limits are deliberate and stated on the page. Values are **positional**, ignoring the
  no-progress clock exactly as chess tablebases ignore the fifty-move rule; for the king variant
  that clock changes 5,952 of 415,550 verdicts (1.43%) and no legal opening. Threefold cannot
  change a positional verdict at all, since a forced win never needs to revisit a position.
- [x] All **192** placements with 180° rotational symmetry, every position a JANKEN layout can
  legally deal, are drawn under all seven archetypes, and none of them is a zugzwang. That is a
  fact about the openings, not about the game: elsewhere in the table the side to move decides the
  result outright, and a smaller set of positions punishes whoever has to move (§6g).
- [x] A runtime lookup API — `oracleFor(cfg)`, `probe`, `movesFrom`, `rankMoves`, `topMoves` — so the
  atlas, the analysis panel and the perfect bot all read one path. Lazy: a 9×9 game fetches nothing.
- [x] **Puzzles.** `findPuzzle()` and `dailyPuzzle()` live beside the oracle, because the atlas and
  the home page must pose the *same* daily puzzle and two copies of the picker would eventually
  pose two. A puzzle is a won position with distance 3–11 where at least three moves are legal and
  at most two keep the win: a position where everything wins teaches nothing and one with a single
  legal move is not a choice. The accepted answers are exactly `topMoves`, so a puzzle cannot be
  marked wrong. Seeded by UTC day plus variant, so `#puzzle=daily` derives the position on both
  pages rather than passing one between them.
- [x] **Answers toggle.** The atlas tints every destination by result and draws arrows at the best
  move, which is the point of the page and precisely what a puzzle cannot have on screen. One
  `spoilers` flag governs the dots, the arrows, the ranked ordering and the move list's verdict
  column; loading a puzzle turns it off and finishing one turns it back on. It is a toggle rather
  than a puzzle-only mode so any position can be studied blind.
- [x] **Reachability.** The generator also walks forward from all 192 deals and records which
  states play can actually enter, per material layer, in `manifest.json`. The table covers every
  position the pieces can form; a game only ever moves forward from a deal, so the two are not the
  same set and the difference is large and archetype-dependent: **99.5%** of the table is reachable
  under kings, **99.6%** under long kings, **84.5%** under crosses, **12.2%** under knights and
  **4.5%** under bishops. A colour-bound or parity-bound piece cannot assemble most of what the
  board allows. Like every other verdict here it ignores the clock, so it is an upper bound.

### 6f. The laboratory, for the boards nobody will solve

- [x] `public/lab.js` holds two kinds of claim and keeps them apart. **Counting is exact**:
  `stateSpace()` counts distinguishable arrangements in BigInt and reproduces the tablebase's
  207,775 placements and 192 openings on the 3×3, which is the check that the formula is the right
  one. **Playing is measured**: `playout()` is seeded self-play under the shipped engine, and every
  rate carries a 95% Wilson interval.
- [x] `scripts/lab.mjs` writes `public/atlas/lab.json` — the ladder for 3×3 to 13×13 and a run of
  600 games a size under greedy and random policies. Deterministic: same seed, same bytes, no
  timestamps. Solve cost is priced from the run that produced `public/tablebase/` (128,000 moves a
  second on one core) and from measured branching, not from a hoped-for rate, which puts the 3×3
  estimate at 20 seconds against the 21 it really took.
- [x] The honest answer to **D9**: a 5×5 is 179 TB of table and roughly 700 single-core years of
  walking; a 9×9 is 1.3 ZB, more storage than has been manufactured. Openings stay countable at
  every size — 22,109,068,800 of them on a 9×9, exactly. The page prints whatever the current
  dataset says rather than these figures, so a re-measure moves it.
- [x] The atlas can extend the committed run in the reader's own browser (`mergeSummaries`), so the
  intervals narrow in front of them rather than being asserted.

### 6g. The bot, and what it is measured against

- [x] `public/bot.js` is one opponent for every ruleset, imported by the client, the tests and the
  tuner. Four levels — casual, normal, strong, perfect — are four **budgets** on one program, not
  four programs. An unknown persisted level resolves to normal, exactly as a retired piece style
  resolves to the default.
- [x] It searches by **playing moves through `applyMove()`**, on a real game object. Painting, ink
  trails, enclosure, capture obligations, multi-action turns, threefold and every ending are
  therefore the engine's, not a copy's, and a rule the engine gains is a rule the bot plays under
  the same day. This is what closes the old debt in §9.10.
- [x] Iterative-deepening alpha-beta with a capture-only quiescence search, delta pruning, killer
  moves and a history table. Depth is never fixed: the budget is spent and whatever depth it
  bought is used, so one setting covers a 3×3 pocket board and a 13×13 campaign. Turn direction
  follows `game.turn` rather than the parity of the depth, because a `triple` turn does not
  alternate.
- [x] Everything the bot believes about a variant is **derived from the variant**. The capture
  graph is read out of `captureTarget()` on a purpose-built board; a piece's base value starts from
  its average legal destination count on an empty board of this size, so a knight is cheap on a 3×3
  and dear on a 13×13; the scoreboard term follows `territory`; and a piece's worth moves with the
  enemy material it eats and is eaten by, which is off automatically under chess capture because
  then everything eats everything. A variant nobody has ever played gets a considered opinion
  rather than a default.
- [x] `public/bot-tuning.js` carries measured weight overrides keyed by a fingerprint of the exact
  ruleset, prefixed by the weight-vector schema. **Tuning is an optimisation, never a rule**: a
  fingerprint that matches nothing in play is never looked up, so a stale entry is ignored rather
  than honoured. This is deliberately the opposite of `public/tablebase/`, which describes the rules
  and must be regenerated with them.
- [x] `npm run tune` measures and tunes in one pass, deterministically. Its objective is *regret* —
  how much worse the move played was than the best available — graded against the solved table on
  the 3×3, where a mistake is a fact, and against the same search given 25,000 nodes everywhere
  else, where it is an opinion and the row is labelled as a lower bound. Positions with nothing to
  get wrong are excluded and counted. A tuned vector is kept only if it also holds its own in a
  head-to-head match, because agreeing with a deep search is not the same as winning games.
- [x] `public/atlas/bots.json` publishes the result and §16 of the atlas prints it. The finding is
  a shape: on the 3×3 sixteen times the search wins nothing — every game drawn, which is what a
  solved drawn board looks like from inside — and the value of depth rises with the board.

### 6e. Verification and release

```sh
npm run verify        # node --check every module + full vitest suite   ← the gate
npm run test:smoke    # Chromium through a local wrangler dev server
npm run deploy:dry    # verify + bundle, no upload, no DB writes
npm run deploy        # verify → assert-clean → stamp → d1:migrate → upload
```

- [x] Workers-runtime tests cover config clamping, every archetype, capture and turn invariants,
  jump/trail separation, randomized termination, backward-compatible JPGN replay, GIF structure,
  SQLite lobby operations, showcase recording, role assignment, server-side move validation, token
  reconnect fencing, seat-grace release, room expiry, route methods and origin checks.
- [x] A dedicated **room lifecycle** group covers transitions *between* games in one room, which
  single-game tests never reach: refusing to discard a started game, full instance reset on expiry,
  server-minted seat tokens, and the account-minting throttle.
- [x] The browser smoke starts a local Worker, selects Skirmish, plays a legal move and carries the
  position into analysis. GitHub Actions runs syntax, Workers-runtime, browser and dry-run
  packaging checks on every push and pull request.
- [x] `deploy` applies pending D1 migrations between the version stamp and the upload, so a release
  needing a new table cannot land before the table does. `deploy:dry` deliberately omits it.
  Application files must be committed before the stamp and upload can run.
- [x] The suite recounts the small tablebase material layers against `engine.js`, so a stale
  `public/tablebase/` fails the gate.

## 7. Backlog, in dependency order

Tiers are barriers: everything in a tier may proceed in parallel, and nothing in a tier starts
before the previous one settles. `needs` names the blocking item. Ownership is by file, because
`game.js` and `atlas.*` are the contended surfaces: two agents in either will collide.

### Tier A, foundations

| | ID | Item | Files | Needs |
| --- | --- | --- | --- | --- |
| [x] | **A1** | `coordStyle` chess\|grid. `grid` labels rows a,b,c… downward and columns 1,2,3… rightward, so `a1` is top-left. `sqName(r,c,size,style)` defaults to `chess`, keeping every existing call. Authoritative state and JPGN move text stay canonical; the client formats labels from coordinates at render time, so a preference can never enter a rated record. Reaches board coordinates, move log, analysis, GIF captions, atlas, JPGN `Coords` tag. | `engine.js` `notation.js` `game.js` `atlas.js` `index.html` `docs/JPGN.md` tests | — |
| [x] | **A2** | Piece styles 14 → 7. Keep `line` (default), `solid`, `kanji`, `kawaii`, `origami`, `arcade`; drop `pixel`, `blob`, `geometric`, `doodle`, `sticker`, `halftone`, `ghost`, `longshadow`. Add `sprite` from `public/assets/rps-sprites.png` (128×64, 32px cells, alpha; column 0 empty, columns 1–3 rock/paper/scissors, row 0 Blue, row 1 Red) rendered `image-rendering: pixelated` inside the existing `glyph()` contract. Retired IDs already fall back to `line`. | `pieces.js` `game.js` `atlas.js` tests | — |
| [x] | **A3** | Tablebase runtime lookup. `tablebase.js` gains a browser-side loader and `probe(cfg, board, turn)` returning `{ value, dtm, moves: [{move, value, dtm}] }`, or `null` when the position is not a solved archetype. Lazy fetch, cached per variant, so nothing loads for a 9×9 game. One code path serves analysis, the bot and the atlas. | `tablebase.js` | — |
| [x] | **A4** | Asset hygiene: sprite sheets into `public/assets/`, old `rps sprites.png` removed, prompt scratch files out of the tree. | repo root | — |

### Tier B, on the foundations

| | ID | Item | Files | Needs |
| --- | --- | --- | --- | --- |
| [x] | **B0** | Rules debt: `forcedCapture`, the RPS restriction on checkers leaps, `rulesVersion` stamping. Makes §1 and §2 true. `sideHasCapture(board, colour, cfg)` plus obligation-aware filtering in `isLegal()`/`allMoves()`, recomputed **before each action**. `presetOf()` compares fifteen fields. Independent **Forced captures** checkbox. Tests: obligation filtering, per-action recomputation, a blocked non-beaten leap, a 1.0 record replaying unchanged, preset round-trips. | `engine.js` `notation.js` `game.js` `index.html` `docs/JPGN.md` tests | — |
| [x] | **B1** | GIF export: two palettes, the two-entry last-move wash, the `drawPiece` hook (§6c). | `gif.js` `game.js` tests | A2 |
| [x] | **B2** | Analysis tablebase verdicts: whenever the analysis position is a solved 3×3 archetype, show win/loss/draw, distance to mate, and the ranked move list, sourced from A3 and never re-derived. | `game.js` `index.html` `style.css` | A3 |
| [x] | **B3** | Perfect bot tier: a difficulty option that plays a top-valued tablebase move, breaking ties by shortest DTM when winning and longest when losing. Offered only when A3 resolves the ruleset. | `game.js` | A3 |
| [x] | **B4** | Atlas ↔ engine connection: the atlas honours the active `pieceStyle`, theme and `coordStyle` instead of hardcoding `line`, and gains an **arrow legend**. Arrows are already coloured by the mover's result and weighted by opacity; the page never says so, which is the actual defect. | `atlas.*` | A1 A2 |
| [x] | **B5** | Data provenance: a `csv` affordance on every chart emitting exactly the numbers it drew, plus one `janken-3x3-data.zip` holding the seven `.tb` files, `manifest.json`, `FORMAT.md` and aggregate CSVs. The `.tb` files are the database; re-encoding 2.9M rows as SQLite would add 30 MB and no capability. | `atlas.*` `scripts/tablebase.mjs` | — |

### Tier C, presentation and quality of life

| | ID | Item | Files |
| --- | --- | --- | --- |
| [ ] | **C1** | Atlas prose and flow: standard 3×3 kings first with variants kept as their own home, no em dashes, concise and witty where wit costs no clarity, every claim next to its number. Unbiased about the 192 symmetric openings: they are what a JANKEN layout deals, not what the game is, and the page should say which claims are about the whole state space and which are about reachable play. |
| [ ] | **C2** | Atlas reflow and motion: the board stays the hero, sections animate on entry, the "full access tool" feel is not traded for a scrollytale. |
| [x] | **C3** | Nav: the atlas link moves from the footer to the top right beside analysis and theme, renamed **atlas**. |
| [x] | **C4** | Zen mode: hotkey `z` plus a button, hiding chrome down to board and turn. |
| [x] | **C5** | Did-you-know corpus with a typewriter reveal beneath the title on Home and beside the logo elsewhere. Facts about JANKEN findings, Conway, Shannon, and combinatorial game theory generally. Large enough that a returning visitor keeps meeting new ones, and shuffled without immediate repeats. |
| [x] | **C6** | Sounds shaped like their pieces: a knock for rock, a rustle for paper, a snip for scissors, still synthesized with no assets. |
| [x] | **C7** | Background: RPS shapes alongside the tetrominoes, subtly animated, reduced-motion aware. |
| [x] | **C8** | Dynamic favicon following theme and game state. |
| [x] | **C9** | Interaction polish: pieces fill their squares, drag follows the pointer without layout thrash. |
| [x] | **C10** | Theatre beside the play card (§3), opening on the newest completed online game then previewing the active ruleset from the first hover, focus, selection or edit. Every ruleset change **restarts** the game rather than mutating one in flight, debounced so a dragged slider starts one game rather than ten. `/api/showcase` is fetched at most once per visit and never on restart. |

### Tier D, larger work and dreams

| | ID | Item | Notes |
| --- | --- | --- | --- |
| [x] | **D1** | Stronger default bot | `public/bot.js`: iterative-deepening alpha-beta with quiescence, searching through `applyMove()` itself rather than a copy of it, on weights derived from the ruleset in play (§6g). Measured against the tablebase by `npm run tune`, which also tunes per variant and publishes the ladder the atlas prints. It did not need D6 after all — searching on a real game object was the way to stop reimplementing move application, not a topology adapter. |
| [x] | **D2** | Atlas as laboratory: 5×5 prospects and 9×9 combinatorics | State-space arithmetic for 5×5 (and what a solve would cost in bytes and hours), plus the 9×9 count and what is knowable without solving it. Cheap to compute, high value, and it is what makes the atlas about the game rather than about one board. |
| [ ] | **D3** | Login coherence | Usernames and passwords, create-account and login pages, no email verification. The D1 `accounts` table and `secret_hash` already exist, so this is UX plus a password KDF, not new infrastructure, and it stays inside the Cloudflare free tier. |
| [ ] | **D4** | Start position as a first-class choice | The 3×3 result says orientation matters, and cramming permutations into the parameters menu would be clunky. Promote the analysis board instead: set up a position, see its verdict live beside it, play it. That is the same surface the setup variant needs, so build it once. |
| [ ] | **D5** | `npx rps-3x3` CLI | Ships as `cli/` in **this** repo publishing `rps-tablebase`, not a separate repo: invariant 11 ties a solved table to the shipped `engine.js`, and a version boundary between them would let the tables rot silently. Terminal board, probe by position, best-move list, DTM ladder, opening grid, W/D/L aggregates. |
| [ ] | **D6** | Topology adapter and the two validators | `public/topology.js` with a square adapter over the current arrays, `engine.js` stops indexing boards directly, `cellCount` replaces `size × size` in the no-progress bound and enclosure majority, the bot calls the shared `applyBoardMove()`, and `validatePlayableCfg()` / `isRatedEligible()` arrive. **Golden fixtures are the acceptance test**, generated from the post-B0/B1 engine *before* the refactor: every preset's start layers, a full legal-destination map per archetype, repetition keys, one byte-for-byte JPGN 1.1 record, a fallback-path GIF frame, a room lifecycle transcript. Done when they still match exactly. |
| [ ] | **D7** | Gold general (§8.1), hex lattice (§8.2), setup play (§8.3) | In that order. All three ship unrated. |
| [ ] | **D8** | `scripts/simulate.mjs` and `docs/BALANCE.md` | Deterministic seeded self-play with no network or D1, reporting per condition: branching factor, first-player win rate, capture rate, enclosure frequency, draw/threefold/stall distribution, median and tail length, dead starts, per-archetype survival value. A fast smoke keeps it honest in CI; long runs are manual. Then, and only then, an in-site bot tourney simulator for the games no tablebase can settle. |
| [x] | **D9** | 5×5 tablebase, if D2 says it is affordable | Answered, and the answer is no: 179 TB and ~700 core-years (§6f). The arithmetic is published on `/atlas` with its CSV. Reopen only if the reachable subset turns out to be small enough to enumerate directly — under bishops it is 4.5% of the 3×3, which is the one hint that a reachability-first solve might be a different question. |
| [ ] | **D10** | Four-player, later six-player on hex | Sketch only. Turn order, elimination and the RPS cycle with four armies all need design before any code. |
| [ ] | **D11** | Structural consolidation | Lichess-shaped compartments as the site grows: analysis, atlas, profile and play as separate surfaces over one engine rather than one page that keeps absorbing features. The repo stays single: one engine, one tablebase, one deploy. |
| [ ] | **D12** | External: a JANKEN entry in the subsurfaces.net arcade | Lives in the `digital-garden` project, not here. |
| [ ] | **D13** | Azel's wall reachability-first experiment | A bounded attempt to map, then only if it closes, solve the one 5×5 Azel start. It is not a generic 5×5 tablebase; the procedure and publication gates are in §8.6. |
| [ ] | **D14** | Atlas multi-page decomposition & variant combinatorics playground | Split the monolithic `/atlas` into dedicated pages/subsurfaces. Rather than a single massive page centered on the 3×3 tablebase, turn the atlas into a rich playground to explore the combinatorics, state spaces, and set theory across variants (3×3 solved spaces, Azel reachability, 5×5/9×9 state spaces, cyclic capture topologies). See §8.7. |

## 8. Design notes for unbuilt features

Detail that would be expensive to re-derive. None of it may be accepted in a live room until its
engine, server, client, bot, replay and termination tests land together.

### 8.1 Gold general (`gold`)

An eighth archetype assignable independently to Rock, Paper or Scissors. It is a movement role,
not a fourth capture identity: a Rock moving as a gold general is still Rock in the RPS cycle and
keeps the Rock artwork.

One square forward, diagonally forward either side, sideways either side, or straight back. Never
diagonally backward. Blue's forward is increasing files, so Blue's relative destinations are
`[-1,0] [+1,0] [0,-1] [0,+1] [-1,+1] [+1,+1]` and Red's are the exact 180° rotation: the shape
shown to either player is the same viewed from their own side. It neither slides nor jumps.

Because this is the first colour-oriented role, direction belongs to the topology adapter's
movement query, never to the UI or the bot. Legal destinations must receive the mover's colour and
previews must show the orientation. Mirrored test positions must prove Blue and Red receive exact
rotations. The hex adapter **rejects** `gold` through `validatePlayableCfg()` rather than treating
it as `cross`; a hex gold general can be designed later but must stay directionally distinct from
the six-neighbour hex `cross` first.

### 8.2 Hex lattice (`topology`, `radius`)

`radius=4..8` counts the centre cell and the cells to an outer corner, so a radius-`r` board has
`1 + 3r(r-1)` cells: 37, 91 (the closest analogue to Standard's 81) and 169. A radius label keeps
area and edge distance explicit where `n×n` would mislead.

Sanitization keeps only the active dimension: square configs canonicalize `size` and discard
`radius`, hex the reverse. `presetOf()` compares `topology` plus the active dimension so two
textually different configs cannot describe the same board.

Axial `(q,r)` with implied `s=-q-r`. On the board when `max(|q|,|r|,|s|) < R`. Negating all three
cube coordinates is the exact 180° opponent transform. Canonical order is increasing `r` then
increasing `q`, and must never depend on insertion order.

| Archetype | Hex meaning |
| --- | --- |
| `cross` | one step to any of the six edge neighbours |
| `rook` | slides the six edge rays (the three lattice axes) |
| `bishop` | slides six vertex-diagonal rays, primitive cube vectors the permutations of `(1,1,-2)` and opposites |
| `queen` | the union, twelve rays in the interior |
| `king` | one non-sliding rook or bishop step, up to twelve destinations |
| `knight` | one of twelve jumps, permutations of `(1,2,-3)` and opposites |
| `longking` | a king step, plus an exact two-cell move along a rook ray |
| `gold` | rejected, §8.1 |

A bishop ray has no intervening lattice cell between successive destinations, but a later one is
still blocked by the first occupied destination. Under checkers capture the long king's two-cell
rook move requires an adjacent enemy and empty landing, removing it only when the mover beats it.
Ink trails paint actual ray destinations crossed, never a geometric point where no cell exists.

Territory connectivity and enclosure use the six **edge** neighbours, not the twelve king
destinations, so vertex contact never closes a boundary. A region reaches the exterior when it
holds a cell at cube distance `radius - 1`. Majority is strictly more than half of `cellCount`.

Layouts become topology operations: **rows** places facing bands in opposite sectors with a
neutral central band, **corners** anchors at opposite vertices, **scattered** samples one near
sector and mirrors by cube negation. Every generated position stays collision-free, exactly
symmetric and large enough for `3 × perType` a side.

The square CSS grid is not this geometry. Hex rendering uses one SVG view box for polygons,
pieces, hit targets, annotations, coordinates and transforms. Logical coordinates stay in the
engine, pixel centres in the renderer. Keyboard navigation follows the six edge directions and
screen-reader labels expose axial coordinates plus a friendlier name.

JPGN 2.0 adds `Topology "hex"` and `Radius`, prefixes compact layers with `H<radius>:` and writes
coordinates as parenthesized axial pairs, `R(-2,+1)-(-1,+1)`.

**Expected dynamics, hypotheses not claims.** Radius 6 is slightly larger than Standard with a
shorter-looking six-directional front; interior kings have twelve destinations and queens twelve
rays, so contact and branching rise without more actions. Six equivalent flanks and no corner
bunker should reward encirclement and lateral attack. Bishops stay bound to one of three colour
complexes while knights, rooks and kings bridge them, sharpening the type-to-archetype assignment:
losing the wrong bridge can strand a nominal material lead. An enclosure around one cell needs a
six-cell ring, favouring broad arcs over tiny boxes. More rays amplify RPS blocking, so a screen
the attacker cannot take can hold several intersecting lanes and removing it can open them at
once.

### 8.3 Setup play (`setup`)

`setup=fixed|alternating` is a phase rule, not another layout. `alternating` starts from an empty
board and requires one placement per setup turn from a fixed inventory before movement begins;
`actionsPerTurn` does not apply during setup.

**Setup chess** is based on King's field rather than all-kings Standard: 9×9, two of each type,
Rock rook / Paper knight / Scissors bishop, RPS, elimination, one action, threefold on. Different
movement roles make deployment a real strategic phase; six identical kings would add ceremony.

`alternating` is Custom-selectable, but `validatePlayableCfg()` restricts what may accompany it in
a live room: elimination, one action, non-checkers capture. Territory, enclosure, leaps and
multi-action turns interact with a placement phase in ways nothing has measured, so they are
rejected rather than guessed at. Topology is deliberately **not** part of that restriction.

`setupZone(colour)` is a topology operation. Square: Blue's leftmost three files against Red's
rightmost three with a three-file neutral gap. Hex: the same shape along the facing axis, Blue the
lowest third of `q` and Red the highest, cube negation mapping one onto the other exactly. Zone
depth is `floor(columns / 3)` where columns is `size` or `2·radius - 1`, and a zone that cannot
hold `3 × perType` is rejected.

On a setup turn the player picks one remaining type and one empty cell in their own zone.
Placement sets the piece and its matching ownership layer even where an elimination preset ignores
ownership. No placing in the opponent's zone, moving a placed piece, passing, capturing, painting,
or starting a game move early.

Strict alternation, Blue first, for `6 × perType` plies, twelve for Setup chess. Red gets the
informational advantage of placing last and Blue the tempo advantage of moving first: simpler than
a snake draft and it splits the two asymmetries. If one dominates, swap setup-first independently
of `first` rather than changing the visible sequence.

State gains `phase setup|play`, `setupTurn`, `setupPly`, `remaining {B:{...},R:{...}}`,
`placements [{c, piece, to}]`, and `startMode generated|setup|position`. Only `GameRoom` advances
the phase. After the final valid placement the server verifies both sides have legal movement,
freezes the layers, sets `phase=play` and `turn=first`, and seeds threefold occurrence one. Setup
is monotonic: placements never enter repetition keys or reset the no-progress counter.

Setup is part of the match. Once the first placement is committed the room cannot be reset to
escape a bad deployment, ratedness locks there rather than at the first move, and reconnect grace,
resignation and abandonment apply across both phases. Rematches return to an empty setup board.
Spectators may scrub placement plies, read-only.

Analysis challenges are deliberately different: an exact position enters `phase=play` already
frozen with `startMode=position`, so a client cannot submit an arbitrary board as though an
opponent had agreed to its deployment.

JPGN 2.0 writes placements before movetext, `S1.B Rb6 S1.R Ph4 S2.B Pc5 …`, and strict replay
re-applies every placement from the empty board and requires it to reproduce the frozen layers.

Bots need a deployment policy, not a formation: score legal placements by mobility, open slider
lanes, distance from friendly blockers, central access, RPS cover and vulnerability to the
opponent's remaining counters, with a shallow response term and a deterministic fallback ordering
for tests.

**Expected dynamics.** Deployment becomes a visible game of commitment and response. RPS blocking
turns formation into a counter-chain: a front Rock may screen a bishop-like Scissors from Paper
while a Paper behind it punishes the Rock counter, so material is symmetric but access to it is
not. Rooks want clear files, bishops colour-complex access, knights tolerate congestion, so one
inventory yields batteries, fortresses, raiders or deliberate screens. Visible alternation permits
mirroring, and initiative after the last placement is the main pressure against it. Twelve plies
lengthen the perceived opening, so the UI must state "placing 4 of 6" and the remaining inventory
more prominently than turn history, with shorter bot delays during setup.

### 8.4 Hex and setup compose by construction

Independent features, measured separately, but never allowed to become incompatible: neither may
contain code that knows about the other. Four rules make the cross-product fall out.

1. **Zones are geometry.** `setupZone(colour)` lives on the adapter beside `cells`, `neighbours`
   and `opposite`. The placement reducer asks for a cell set and never computes a file index.
2. **The phase reducer is topology-blind.** A placement is "an unplaced piece from my inventory,
   onto a cell in `setupZone(me)` that `has()` and is empty". No rows, columns or radius.
3. **JPGN 2.0 carries both dimensions at once.** `Topology`/`Radius` and `S<n>.<side>` tokens are
   orthogonal; a hex setup record simply has both, `S1.B R(-4,+1)`.
4. **The validator gates rules interactions, not lattices.** It rejects `alternating` with
   territory, enclosure, checkers or multi-action turns, and never consults `topology`.

Closing integration test: play, replay, export and re-import a radius-6 alternating-setup game. If
it needs one `if (hex)` inside the reducer, the abstraction is wrong and the fix is in the adapter.

### 8.5 Boundaries the extensions add

`public/topology.js`:

```text
cells · has · get/set · neighbours · rays · distance · opposite
coordKey · coordinateLabel · canonicalOrder · cellCount · setupZone
```

The square adapter wraps the current nested arrays, preserving their JSON shape and every square
position string. Movement generation asks for the rays or steps of an archetype at a coordinate
for a colour; most archetypes ignore it, `gold` does not. Checkers capture asks for the
intervening cell on a two-step rook ray rather than deriving a midpoint, then passes both pieces
through the same `canCapture()` used by landing captures.

One low-level `applyBoardMove()` owns capture, movement, trails, landing ownership and enclosure,
used by authoritative play, analysis and bot simulation alike. Above it the reducer exposes
`isLegalAction` · `applyAction` · `hasStarted` · `ratingLockPoint`. Worker lifecycle rules call
those predicates rather than inferring phase from `moves.length`.

The square DOM grid stays unchanged behind a board-view boundary; hex gets a dedicated SVG view.
The controller keeps owning selection, history, online state and modes, with no geometry branch
beyond choosing the view. Spectator history, the theatre and GIF export consume one phase-aware
replay frame stream containing both placements and moves.

## 9. Traps

Decided in advance, because a sweep has no natural place to discover them.

1. **Fixture ordering.** D6's goldens must come from the post-B0/B1 engine. Capture them before
   touching geometry, or the refactor bakes in pre-B0 checkers semantics, and a GIF frame captured
   before the palette change is a fixture of a colour scheme that no longer exists.
2. **`presetOf()` grows twice more** (hex, setup); B0 already took it to fifteen fields. Every
   preset must spell out every compared field or a variant silently reports an earlier preset's
   name, and the round-trip test catches it only if new presets are added to it. `rulesVersion`
   stays out of the comparison on purpose — it is an edition, not a variant.
3. **Keep the validators separate.** Every rejection belongs in `validatePlayableCfg()`. A throw
   inside `sanitizeCfg()` breaks restored browser state and every historical record.
4. **Forced capture is per action, not per turn**, and the client consults the same predicate the
   server enforces: the obligation is filtered inside `legalDest()`, so nothing downstream — the
   bot, the previews, `hasMove()`, the tablebase walk — can hold a second opinion. `sideHasCapture()`
   calls the raw geometry, not `legalDest()`, or it would recurse.
5. **`rulesVersion` is one-way.** The unrestricted leap is reachable from migration and replay
   only. No UI path may produce it.
6. **`size × size` is a hex bug.** The no-progress bound and the enclosure majority both assume a
   square board; both must become `cellCount`.

### 8.6 Azel's wall reachability-first experiment (`D13`)

**Question.** Can the exact 5×5 Azel's wall *starting position* be mapped far enough to yield a
useful, reproducible result, and does its reachable graph close within a deliberately conservative
budget? This does **not** reopen the rejected general 5×5 tablebase: the target is one fixed start
and its descendants, not every 5×5 arrangement.

**Fixed contract.** The experiment takes its board and rules exclusively from `E.PRESETS.azel` and
`E.blocksBoard()`: 5×5, all kings, RPS captures, elimination, one action, `layout=azel`, and the
fixed 2-rock / 1-paper / 3-scissors material on each side. It records the exact config fingerprint,
engine revision and positional-tablebase convention (`threefold=false` while walking), matching the
existing 3×3 solver's explicit choice to exclude history-dependent repetition from a position value.
No hand-built position, synthetic move generator, or alternate capture rule is allowed.

**Plan and gates.**

1. Add an isolated deterministic `scripts/azel-wall.mjs` that imports only the shared engine. Its
   first mode is a forward census from the fixed start, recording unique states, edges, material
   layers, terminal reasons, branching, repeated-state/SCC evidence and any unexpanded frontier.
   Every run has explicit state, edge, RAM and wall-time caps; a cap exits cleanly with `complete:
   false` rather than extending the job or guessing a verdict.
2. Commit a machine-readable `public/atlas/azel-wall.json` only when its config fingerprint, caps,
   traversal counters and completion status are present. A capped artifact is a **frontier census**,
   not solved data; it may describe exactly what was visited but must not label the root or an
   unclosed region win/draw/loss.
3. Attempt retrograde solving only after the reachable graph is proven closed. Build predecessor
   edges from the same recorded successors, audit every edge through `engine.js`, and publish an
   exact root result only when the full attractor audit passes. If closure does not fit the initial
   budget, stop after the census and report the measured obstacle plus the next safe cap to try.
4. Keep site impact local to a lazy Azel section in `/atlas`: initial-position diagram, material and
   frontier/layer figures, a visible `exact` versus `capped census` label, method/cap disclosure and
   CSV for the rows drawn. Existing 3×3 tablebase data, claims, loader, bot, home screen and gameplay
   remain untouched. The section remains absent until a validated artifact exists.
5. Before presentation, add deterministic script tests for start reconstruction, legal replay,
   stable output, cap handling and the complete-versus-capped claim boundary; then run the normal
   syntax, Vitest and browser gates. A benchmark that merely changes the cap is not a new result
   until it regenerates the committed artifact and its Atlas CSV.

**Exit conditions.** A successful session ends in either an audited exact result for the fixed root,
or a reproducible capped census with no overclaim. It never starts a whole-5×5 enumeration, changes
the shipped rules, or silently turns incomplete reachability into an Atlas verdict.

### 8.7 Atlas multi-page decomposition & variant combinatorics playground (`D14`)

**Problem statement.** Today `/atlas` is a single monolithic page predominantly centered around the solved 3×3 tablebase. While comprehensive for that specific domain, it crowds out the broader combinatorial, topological, and set-theoretic beauty of JANKEN's variant ecosystem. The atlas should evolve into an exploratory mathematical playground rather than a single static report.

**Decomposition & Structure.**
1. **Sub-surfaces & routing:** Split `/atlas` into modular sub-routes or views:
   - `/atlas/tablebase-3x3`: Solved 3×3 domain, DTM ladders, opening grids, attractor graphs, perfect play verifications.
   - `/atlas/combinatorics`: State-space arithmetic across board sizes (3×3, 5×5, 9×9, hex), branching factors, partition numbers, and layer sizing.
   - `/atlas/variants`: Interactive laboratory for exploring the set theory, reachability graphs, and cyclic capture dynamics across custom presets (Azel's wall reachability, asymmetric piece ratios, alternate win conditions).
   - `/atlas/bots`: Empirical tuning ladders, regret curves, and depth-versus-board scaling analysis.
2. **Interactive playground:** Empower visitors to slice and interact with variant combinatorics directly in the browser—toggling rule predicates, visualizing cyclic capture graph invariants, filtering reachable subsets, and inspecting state-space growth bounds.
3. **Data provenance:** Retain invariant §9b across all sub-pages: all displayed figures are dynamically read from machine-readable JSON/tablebase fixtures (`manifest.json`, `lab.json`, `bots.json`, `azel-wall.json`), with per-view CSV exports.
7. **Canonical order comes from the adapter.** Any reliance on object or `Map` insertion order
   makes `encodePos()` and repetition keys nondeterministic, corrupting threefold detection and
   JPGN round-trips in ways tests may catch only intermittently.
8. **Setup is monotonic.** Placements must not enter repetition keys or reset `dry`, or a setup
   game can draw before it starts.
9. **`moves.length === 0` appears in three lifecycle decisions** in `src/worker.js`: the lobby open
   test, the `new` refusal and the rating lock. All three become `hasStarted()` /
   `ratingLockPoint()`, or a setup game is resettable mid-draft and mis-rated.
10. ~~**The bot reimplements move application** inline in `game.js`.~~ Paid by D1: `bot.js`
    searches on a real game object and calls `applyMove()`, so gold and hex will reach the bot the
    moment they reach the engine. The trap survives as a rule — **nothing outside `engine.js` may
    apply a move** — and the client keeps no move-scoring code of its own.
11. **JPGN version selection is a compatibility test, not a preference.** Existing tests compare
    square records byte-for-byte, so the writer must keep emitting 1.1 for fixed square games.
12. **`MAX_PIECES_PER_SIDE` stays single-source.** A second constant lets `blocksBoard` and
    `decodePos` drift apart.
13. **Downstream decoders assume `cfg.size`.** `gif.js`, `showcase.js` and the variant preview each
    decode `startPos` with a square dimension; all three must go through the adapter.
14. **Annotations and flip are geometry.** The annotation SVG maps to the square board's content
    box; the hex view needs its own mapping inside the same boundary, not a second controller.
15. **The rating gate must be visible before the result**, in the play card and the room status
    line.
16. **`gif.js` must stay DOM-free.** The moment it imports `pieces.js` or reaches for a canvas it
    stops running in `workerd` and the GIF suite stops being able to test it. Piece rendering
    arrives as an argument or not at all, and the hook is never the asserted path.
17. **One debounce, one hover source.** The variant stage preview and the theatre restart fire from
    the same events. Two independent listeners will disagree about which ruleset is on show for a
    few hundred milliseconds, and a slider drag will start a game per tick.
18. **Later work extends B1's surfaces, never forks them.** A hex GIF renderer uses the same two
    palettes and the same `drawPiece` hook; setup placements reach the theatre through the shared
    frame stream. The theatre is a consumer of that stream, not a second replayer.
19. **`coordStyle` is a preference, not a rule.** It never enters `presetOf()`, authoritative
    state, or JPGN move text. A record's moves are canonical and a `Coords` tag only says how to
    show them, or two players' exports of one game stop being comparable.
20. **A retired piece style must still resolve.** `pieceStyle` is persisted in browsers and named
    in nothing else, so dropping an ID means falling back to `line`, never rendering blank.

## 9b. What the atlas may assert

Every figure printed on `/atlas` is read at render time out of `public/tablebase/manifest.json`,
a `.tb` file, `public/atlas/lab.json`, or `public/atlas/bots.json`. None is typed into the markup,
so a regenerated dataset moves the page and a stale one cannot hide behind prose. Two consequences
are rules, not habits:

1. **Every chart exports what it drew.** A `csv` button on each section emits exactly the rows on
   screen, and the data pack carries all seven tables, the manifest, `lab.json`, the format note
   and every aggregate CSV. A page that makes numeric claims and cannot produce the numbers is
   asking to be trusted instead of checked.
2. **Exact and measured are labelled differently.** Counting (state space, openings, reachability,
   every tablebase verdict) is exact and says so. Self-play is a sample, carries a 95% interval,
   and is calibrated in public against the one board where the truth is known: perfect play draws
   all 192 openings, the same board under self-play does not, and that gap is the stated size of
   the error in every larger row.

## 10. Rating gates

Ratings stay off for gold generals, hex boards and alternating setup. That is a decision, not an
oversight, and `isRatedEligible(cfg)` is the single place it is expressed. Widening it is a
separate auditable change, made per mode, only when D8's harness shows for that mode: a
first-player win rate within a defensible band of the square baseline; no dominant degenerate line;
a draw/threefold/stall distribution comparable to shipped square variants; a median length that
does not make abandonment the common ending; and for setup, placement diversity high enough that
deployment is a real decision.
