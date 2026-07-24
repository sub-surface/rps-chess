# JANKEN — rock · paper · scissors chess

A minimal territory game. Rock–paper–scissors pieces move like chess pieces; every square you
land on is painted your colour. Fill the board, hold the most ground. Live at
**[rps.subsurfaces.net](https://rps.subsurfaces.net)**.

## Play

- **Standard** gives Rock, Paper, and Scissors the same one-square king movement. Capturing
  still follows the RPS cycle, so piece identity remains strategically distinct.
- **RPS capture** (default): you may only take a piece you beat — rock > scissors > paper > rock.
- **Territory** (default): landing paints a square; Standard permits stepping back onto painted
  empty squares. The game ends when the board is claimed or either player cannot move, and most
  squares wins.
- Modes: hot-seat, vs bot, bot-vs-bot, and **online** (share a link or pick from the lobby).
- **Rated play**: one-click device accounts ("get rated"), Elo ratings, lichess-style profile
  pages (`#u=id`), 30-second abandonment forfeits, and Elo-proximity **quick match**. Games
  with guests stay unrated. Change your username anytime in the **you are** field; rated profiles
  update automatically. Transfer codes (options → Preferences) move an account between devices.
  A game that is under way can only be finished or resigned — never discarded — so a result
  always follows a started rated game.
- **Analysis board**: move either side freely under the current rules, place or erase pieces,
  then continue hot-seat, vs bot, or as an **online challenge from that exact position**.
- Click or drag pieces to move. Right-click draws precisely aligned **arrows and highlights**
  (shift/alt recolour); drag the corner grip to resize, press `f` to flip, and click moves in the
  log to review.
- Online games include rate-limited, ephemeral player chat (spectators may read) and resignation.
- **Ten named variants**, each a real combination rather than a slider preset — Standard,
  Skirmish (6×6, one of each), Triple step (3 actions/turn), Cavalry (all knights), Painters
  (queens with ink trails), Ambush (scattered start), Siege (corners, no re-tread), Expanse
  (13×13, four of each), King's field (rook/knight/bishop, elimination), and Melee (chess
  capture, elimination) — plus **Custom**. See `SPEC.md` §1.
- Everything the presets are built from is still yours to set: board size, pieces/type, up to
  3 actions/turn, independent movement assignments (`king`, `rook`, `bishop`, `knight`,
  `queen`, `cross`, or `long king`) per RPS piece, chess capture, elimination, ink trails,
  rows/corners/scattered layouts, and custom starting positions.
- **Contextual rules everywhere**: a `rules` tab on the board's left edge slides out the whole
  game explained from scratch *for the variant you are playing* — and the same text backs the
  how-to-play dialog. It is generated from the rules engine, so it can never go stale.
- The Standard 9×9 start uses centred facing blocks: Blue occupies b4–c6, with Rock/Paper/Scissors
  ordered vertically, and Red uses its 180° mirror on g4–h6.
- Four piece styles — line, solid, pixel, and kanji (石 紙 鋏) — in the Preferences dialog.
- The home selector shows a live variant stage: board preview with movement arrows, the actual
  starting formation and ownership, per-piece movement cards, action count, first player,
  capture rule, and goal — all generated from the same rules engine used during play. Hovering
  a variant previews it across the whole stage without selecting it.
- A lazy-loaded **variant theatre** starts with the newest completed online game and cycles
  through Standard, King's Field, and a daily-seeded random bot variant. It pauses off-screen,
  while hidden, and for reduced-motion users.
- **Export** copies replay-complete JPGN 1.1 or downloads a dependency-free animated GIF.
  See [`docs/JPGN.md`](./docs/JPGN.md).

See [`SPEC.md`](./SPEC.md) for the complete rules, protocol, and lifecycle.

## Stack

The zero-build vanilla-JS client is served by a Cloudflare Worker. Online play uses one
**GameRoom** Durable Object per match and one global **Lobby** Durable Object:

- `GameRoom` owns authoritative state, validates every move, hibernates with WebSockets, tracks
  presence, preserves disconnected seats for a short reconnect window, mints its own seat
  capabilities, and expires idle rooms — resetting all instance state, since a Durable Object
  outlives the room it hosted.
- `Lobby` stores open games as indexed SQLite rows rather than rewriting one shared object.
- **D1** holds accounts, rated-match history, a bounded recent-replay feed, and signup-throttle
  buckets; `GameRoom` records each rated result transactionally and queues the compact public
  replay only after its authoritative state is persisted. See `SPEC.md` §5b and `migrations/`.
- `public/engine.js` is imported by both browser and Worker, so previews, hints, bots, tests, and
  server validation use one implementation.

```text
public/      index.html · style.css · game.js · engine.js · notation.js · gif.js · showcase.js · admin.html · admin.js · favicon.svg · _headers
src/         worker.js (Worker + GameRoom + Lobby Durable Objects) · elo.js
migrations/  D1 schema (wrangler d1 migrations apply rps-chess [--local|--remote])
scripts/     version.mjs · assert-clean.mjs
docs/        JPGN portable notation specification
test/        engine, notation, GIF, Elo, and Worker/Durable Object regression tests
```

### Admin dashboard

`/admin` is an unlinked, `noindex` page showing live user and game metrics from D1. It's gated by
an `ADMIN_KEY` Worker secret (constant-time compared server-side, held only in `sessionStorage`):

```sh
wrangler secret put ADMIN_KEY          # production — paste a long random value
echo 'ADMIN_KEY=some-dev-key' > .dev.vars   # local `wrangler dev` (gitignored)
```

Infrastructure metrics (requests, CPU, errors, D1/DO usage) live in the Cloudflare dashboard,
linked at the bottom of the page.

## Develop and verify

```sh
npm install
npm run dev          # local Worker, assets, and Durable Objects
npm run verify       # syntax checks + Workers-runtime tests
npm run deploy:dry   # verify + build a no-upload Wrangler bundle
npm run d1:migrate   # apply pending D1 migrations before deploying code that needs them
```

This release adds `migrations/0003_signups.sql`, so run `npm run d1:migrate` **before**
deploying it — `/api/account` throttling reads the new table.

`npm run deploy` verifies the app, refuses an uncommitted application tree, stamps
`public/version.json` with the exact commit, and then runs `wrangler deploy`. Commit release
changes before deploying so the footer always identifies the source that is live.

Worker `rps-chess` · custom domain `rps.subsurfaces.net` · repo `sub-surface/rps-chess`.
