# JANKEN — rock · paper · scissors chess

A minimal strategy game. Rock–paper–scissors pieces move like chess pieces and may take only
what they beat, so identity is as much a wall as a weapon. Outlast your opponent — or switch on
**territory** and race to paint the board. Live at
**[rps.subsurfaces.net](https://rps.subsurfaces.net)**.

## Play

- **Standard** gives Rock, Paper, and Scissors the same one-square king movement. Nothing is
  painted: you take what you beat, and the game ends the moment no capture is possible any
  more — whoever has more pieces standing wins.
- **RPS capture** (default): you may only take a piece you beat — rock > scissors > paper > rock.
  A piece you cannot take blocks you instead.
- **Checkers capture**: every piece becomes a Long king. Step one square normally, or leap
  exactly two squares straight over an adjacent enemy onto an empty square to remove it.
- **Territory** is an opt-in mode used by Painters, Siege and friends: landing paints a square
  permanently, and most squares wins once the board is claimed.
- **Melee** adds enclosure to territory: close a loop around an orthogonally connected region
  to claim every square inside and remove trapped pieces. The first side past half the board wins.
- **Threefold repetition** is universal and enabled for every named variant: the third occurrence
  of the same position, side to move, and action within a multi-action turn is an automatic draw.
  Custom rules expose it as a checkbox.
- **One click to play.** The home page leads with a play card: your name, the variant you are
  on, and four ways in — **Play online** (a public room anyone in the lobby can join),
  **Challenge a friend** (a private room, its link copied to your clipboard, never listed),
  **vs Bot**, and **Over the board**. Quick match and bot-vs-bot sit alongside. The header
  carries `play ▸` and `analysis` from every screen.
- **Rated play**: one-click device accounts ("get rated"), Elo ratings, lichess-style profile
  pages (`#u=id`), 30-second abandonment forfeits, and Elo-proximity **quick match**. Games
  with guests stay unrated. Change your username anytime in the **you are** field; rated profiles
  update automatically. Transfer codes (options → Preferences) move an account between devices.
  A game that is under way can only be finished or resigned — never discarded — so a result
  always follows a started rated game.
- **Analysis board**: move either side freely, place or erase pieces, switch named rules in place,
  mirror Blue into Red, rotate or reset the position, then continue over the board, vs bot, or as
  an **online challenge from that exact position**. Customise rules through the existing selector
  without losing the draft. Reachable from the header on any screen; opened mid-game it loads the
  live position.
- Click or drag pieces to move. Right-click draws precisely aligned **arrows and highlights**
  (shift/alt recolour); drag the corner grip to resize, press `f` to flip, and click moves in the
  log to review.
- Online games include rate-limited, ephemeral player chat (spectators may read) and resignation.
  Spectators can use the move log, arrow keys, or board controls to review any earlier position
  without losing their place when another live move arrives.
- **Eleven named variants**, each a real combination rather than a slider preset — Standard,
  Skirmish (3×3, one of each, elimination), Triple step (3 actions/turn), Cavalry (all knights),
  Painters (queens with ink trails), Ambush (scattered start), Siege (corners, no re-tread), Expanse
  (13×13, four of each), King's field (rook/knight/bishop, elimination), Checkers (Long kings
  with leap captures), and Melee (all kings, RPS captures, territory enclosure) — plus
  **Custom**. See `SPEC.md` §1.
- **Skirmish is solved.** [`/atlas`](https://rps.subsurfaces.net/atlas) publishes an exact
  tablebase for the 3×3 board — all 415,550 positions, for each of the seven movement
  archetypes. Set up any position and it will tell you whether it is won, lost or drawn and in
  how many plies. Every one of the 192 openings the game can legally deal is a draw.
- Everything the presets are built from is still yours to set: board size, pieces/type, up to
  3 actions/turn, independent movement assignments (`king`, `rook`, `bishop`, `knight`,
  `queen`, `cross`, or `long king`) per RPS piece, one-click movement sets (all kings, all Long
  kings, rook/knight/bishop, or all queens), RPS/chess/checkers capture, elimination, ink trails,
  enclosure captures, threefold repetition, rows/corners/scattered layouts, and custom starting
  positions.
- **Contextual rules everywhere**: a `rules` tab on the board's left edge slides out the whole
  game explained from scratch *for the variant you are playing* — and the same text backs the
  how-to-play dialog. It is generated from the rules engine, so it can never go stale.
- The Standard 9×9 start uses centred facing blocks: Blue occupies b4–c6, with Rock/Paper/Scissors
  ordered vertically, and Red uses its 180° mirror on g4–h6.
- Fourteen crisp, colour-aware piece styles in Preferences: line, solid, pixel, kanji (石 紙 鋏),
  rounded kawaii, chunky blob, geometric, hand-drawn, origami, sticker, retro arcade, halftone,
  ghost line, and long shadow.
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
  outlives the room it hosted. Online rematches alternate the seated colours so first move
  advantage rotates between players.
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
npx playwright install chromium   # once, for the browser smoke test
npm run dev          # local Worker, assets, and Durable Objects
npm run verify       # syntax checks + Workers-runtime tests
npm run test:smoke   # Chromium: choose a variant, play a move, open analysis
npm run deploy:dry   # verify + build a no-upload Wrangler bundle
npm run d1:migrate   # apply pending D1 migrations on their own (deploy runs this for you)
```

GitHub Actions runs verification, the Chromium smoke test, and dry-run packaging on every push
and pull request.

`npm run deploy` verifies the app, refuses an uncommitted application tree, stamps
`public/version.json`, **applies pending D1 migrations**, and only then uploads — so schema
always lands before the code that depends on it. `npm run d1:migrate` runs them alone.

Commit release changes before deploying so the footer always identifies the source that is live.

Worker `rps-chess` · custom domain `rps.subsurfaces.net` · repo `sub-surface/rps-chess`.
