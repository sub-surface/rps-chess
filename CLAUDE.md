# JANKEN (`rps-chess`) — working notes for agents

Rock–paper–scissors played like chess. Zero-build vanilla-JS client served by a Cloudflare
Worker, with one `GameRoom` Durable Object per match, one global `Lobby` DO, and D1 for accounts,
rated matches, and the public replay feed. Live at **rps.subsurfaces.net**.

**Read in this order:** this file → [`SPEC.md`](./SPEC.md) §0 (status table) → the sections of
`SPEC.md` your task touches. `SPEC.md` §7–§8 is the roadmap and the phased delivery plan;
[`docs/JPGN.md`](./docs/JPGN.md) is the notation format. `README.md` is player-facing.

## Commands

```sh
npm install
npm run dev            # wrangler dev — Worker, assets, DOs, local D1
npm run verify         # node --check on every module + full vitest suite  ← the gate
npm test               # vitest only (boots workerd; first run is slow)
npm run test:smoke     # Chromium through a local wrangler dev server
npm run deploy:dry     # verify + wrangler bundle, no upload, no DB writes
npm run tablebase      # re-solve the 3x3 board into public/tablebase/ (~2 min, all 7 variants)
npm run d1:migrate:local   # apply migrations to the local D1
npm run d1:migrate     # applies to PRODUCTION D1 (--remote)
npm run deploy         # verify → assert-clean → version stamp → d1:migrate → upload
npm run tail           # live production logs
```

`npm run verify` is the only gate that matters. Run it before committing.
**Never run `npm run deploy` unless explicitly asked** — it writes to the production database.

## Repo map

| Path | Responsibility |
| --- | --- |
| `public/engine.js` | Pure rules. **Single source of truth**, imported by browser *and* Worker. |
| `public/tablebase.js` | 3×3 addressing, symmetry, decoding **and the runtime oracle** (`oracleFor`, `probe`, `movesFrom`, `rankMoves`, `topMoves`). Shared with the generator, the atlas, the analysis panel, and the perfect bot. |
| `public/tablebase/` | Generated: one solved `.tb` per movement archetype, plus `manifest.json`. |
| `public/datapack.js` | Lazy store-only zip writer + `FORMAT.md` text for the atlas data pack. |
| `public/facts.js` | Did-you-know corpus, no-immediate-repeat picker, typewriter mount. |
| `public/assets/` | `rps-sprites.png` — the 128×64 sheet behind the `sprite` piece family. |
| `public/atlas.html`, `atlas.css`, `atlas.js` | `/atlas` — the tablebase page. Board is the hero; every chart loads it. |
| `public/notation.js` | JPGN writer, parser, and strict legality-checked replayer. |
| `public/gif.js` | Dependency-free indexed GIF encoder + deterministic board renderer. |
| `public/showcase.js` | Lazy replay theatre (recent games, bot variations). |
| `public/pieces.js` | Seven piece families; `glyph(type, color, style)`. Six are colour-aware SVG; `sprite` crops a raster sheet. |
| `public/game.js` | Everything client: play, bot, board/editor render, lobby, online socket, exports. |
| `public/index.html`, `style.css` | Markup and styling. No inline scripts (CSP). |
| `public/admin.html`, `admin.js` | Unlinked `noindex` metrics dashboard. |
| `public/_headers` | CSP, frame, MIME, referrer, permissions, CORP headers for static assets. |
| `src/worker.js` | Worker routes + `GameRoom` and `Lobby` Durable Objects. |
| `src/elo.js` | `eloDelta`, `START_RATING`. K=32, draws 0.5. |
| `migrations/` | D1 schema, applied by `deploy` before upload. |
| `scripts/tablebase.mjs` | Solves the 3×3 board with `engine.js` and writes `public/tablebase/`. |
| `scripts/version.mjs` | Stamps `public/version.json` (git SHA shown in the footer). |
| `scripts/assert-clean.mjs` | Refuses to deploy an uncommitted application tree. |
| `test/` | engine, notation, gif, pieces, elo, worker/DO suites. |

Planned additions carry a phase marker in `SPEC.md`: `public/topology.js` (Phase 1),
`scripts/simulate.mjs` and `docs/BALANCE.md` (Phase 5).

## Invariants

These are the reasons the codebase looks the way it does. Breaking one is a design change, not a
refactor.

1. **One engine.** `public/engine.js` is imported unchanged by the browser and by the Durable
   Object. Rules logic is never duplicated, re-derived, or approximated anywhere else — not in the
   bot, not in the preview, not in the server.
2. **No build step, no runtime dependencies.** Modules are served as-is and must run untranspiled
   in a modern browser *and* in `workerd`. Adding an npm package to the shipped app is a deviation
   that needs a stated reason. `devDependencies` are wrangler and vitest only.
3. **The server is authoritative.** `GameRoom` re-validates every action with the same engine call
   the client used. The client may *highlight* an obligation or a legal destination; it never
   decides one.
4. **Rules prose is generated.** `rulesSummary(cfg)`, `variantLabel(cfg)`, and `movementLabel(cfg)`
   produce every rules string from the config in play. Never hardcode a rule in markup — the rules
   flap and the how-to dialog read the same generated text, so they cannot drift.
5. **Two validators, two jobs.** `sanitizeCfg()` is total and never throws: it clamps and defaults
   any input into something playable. Rejection belongs in `validatePlayableCfg()` (Phase 1).
   Adding a throw to sanitization breaks restored browser state and historical records.
6. **A Durable Object instance outlives the room it hosted.** `storage.deleteAll()` does not clear
   memory, so `resetRoom()` must clear *every* instance field on expiry — otherwise the next
   occupants of a recycled room ID inherit the last pair's account bindings and get rated as them.
   Any new instance field goes in `resetRoom()` in the same edit.
7. **Presets spell out every compared field.** `presetOf()` matches on an exact field list; a
   preset that omits a field, or duplicates another preset's ruleset, silently reports the wrong
   name. Adding a variant is otherwise a one-file change.
8. **Rendering is diff-based.** `render()` compares `pieceKey`, `className`, `aria-label`, and a
   move-log key before touching the DOM. Don't replace subtrees every frame.
9. **Untrusted text is inert.** Chat and names are rendered with `textContent`, capped and
   stripped server-side. CSP forbids inline script; keep it that way.
10. **The atlas namespaces its CSS.** `public/style.css` is loaded first for the shared chrome and
    palette, so every board-ish class in `atlas.css` carries a `tb-` prefix. `.sq`, `.pal`,
    `.seg`, `.legend` and `.palette` already mean something else there; an unprefixed name
    silently inherits the game's rules.
11. **A solved tablebase describes the shipped rules.** Changing a preset or a movement archetype
    invalidates `public/tablebase/`. Rerun `npm run tablebase` in the same commit — the suite
    recounts the small material layers against `engine.js` and fails on stale artifacts.
12. **Comments explain why.** The codebase's comments carry reasoning that isn't recoverable from
    the code (why elimination ends on `capturesPossible()` and not "nothing en prise"; why the
    lobby fingerprints its metadata). Match that register — skip the ones that restate the line.
13. **`coordStyle` is a preference, not a rule.** It never enters `sanitizeCfg()`'s rules fields,
    `presetOf()`, authoritative state, or JPGN movetext. `sqName()`/`axisLabels()` default to
    `chess` so every historical call site keeps writing canonical coordinates; only display code
    passes a style. A record's `Coords` tag says how to *show* moves, never how to read them.
14. **A retired piece style must still resolve.** `pieceStyle` is persisted in browsers and named
    nowhere else, so an unknown ID falls back to the current default rather than rendering blank.
    `glyph()` owns that fallback; dropping a family is otherwise a one-file change.
15. **A glyph clips itself.** `.sq svg.pc` sets `overflow: visible` for the families that draw
    outside their box, so the raster `sprite` family crops with a *nested* `<svg>` viewport rather
    than relying on the outer one. Anything addressing a sheet by cell must clip structurally.
16. **`gif.js` stays DOM-free.** Theme is a palette index choice and piece artwork arrives as the
    optional `drawPiece` hook — never an import of `pieces.js`, never a canvas. The hook is never
    the asserted path: determinism is tested against the geometric renderer.

## Common tasks

### Add a variant

1. `PRESETS` entry in `engine.js`, spelling out **every** compared field.
2. `PRESET_INFO` label + tagline — its position sets the picker order via `PRESET_KEYS`.
3. `SPEC.md` §1 preset table and the `README.md` variant list.

The engine tests iterate `PRESET_KEYS`, so round-trip recognition and a playable opening are
covered automatically — but a ruleset identical to an existing preset will fail the round-trip
test, by design.

### Add a config field

1. `sanitizeCfg()` — clamp/default, absent value must reproduce historical behaviour.
2. `presetOf()`'s compared-field list **and** every entry in `PRESETS`.
3. `rulesSummary()` / `variantLabel()` if a player can feel it.
4. `index.html` control + `game.js` (`fillHome`, `readHome`, `markPreset`, preview facts).
5. `notation.js` — `rulesText()` and `parseRules()`, where an absent field defaults to the
   pre-existing rule, not the new one.
6. `docs/JPGN.md` §4 field table; `SPEC.md` §2.
7. Tests: a sanitize case and a JPGN round-trip.

### Add a protocol message

1. Handle it in `GameRoom.webSocketMessage` (rate limiting and the seat/token check already wrap
   every branch — keep the `seated` guard).
2. Add any new authoritative state to `stateMsg()`.
3. Client: `sendNet()` caller + `applyServerState()`.
4. `SPEC.md` §5, plus a `test/worker.test.js` case using the `connect()` helper.

### Change the schema

Add a numbered file in `migrations/`. Tests apply migrations automatically
(`test/apply-migrations.js`), and `deploy` applies them before upload. Never edit a landed
migration.

## Testing

- `test/engine.test.js`, `notation`, `gif`, `pieces`, `elo` are pure and fast. Build positions with
  `E.emptyBoard(n)` and assign cells directly rather than playing into a shape.
- `test/worker.test.js` runs inside `workerd` via `@cloudflare/vitest-pool-workers` against real DO
  stubs: `env.ROOM.getByName(...)`, `runInDurableObject`, `runDurableObjectAlarm`. Reuse the
  `connect()` and `nextMessage()` helpers at the top of that file.
- `e2e/game-smoke.spec.js` is the deliberately small browser gate. Install Chromium once with
  `npx playwright install chromium`; Playwright starts `wrangler dev` itself.
- `ADMIN_KEY` is bound to `test-admin-key` by `vitest.config.js`.
- The **room lifecycle** describe block covers transitions *between* games in one room (refusing to
  discard a started game, full reset on expiry, seat-token minting, signup throttling). Lifecycle
  changes belong there — single-game tests never reach those paths.

## Style

- Two-space indent, semicolons, single quotes, ES modules, `const` arrow helpers for one-liners.
- JS wraps around 110 columns; Markdown around 100.
- Identifiers are American (`color`, `sanitizeCfg`); prose and comments are British (`colour`,
  `recognises`). Both are deliberate — don't "fix" either.
- Commits are conventional (`feat:`, `fix:`, `docs:`, `chore:`) with a one-line summary plus a
  short body describing the behaviour change. Work lands on `main`.
- A feature lands end to end in one commit: engine + client + server + notation + tests + docs.
  A rule that exists in `engine.js` but not in `rulesSummary()`, `docs/JPGN.md`, and a test is
  half-shipped.

## Environment

- Windows host; PowerShell is primary, Git Bash is available. Use forward slashes in paths.
- `ADMIN_KEY` lives in `.dev.vars` locally (gitignored) and `wrangler secret put ADMIN_KEY` in
  production.
- `public/version.json` is generated and gitignored; `assert-clean.mjs` ignores it deliberately.
- `.assetsignore` keeps `*.md` out of the deployed asset bundle, so these docs are not served.
- `d1:migrate` is `--remote` (production). Local work uses `d1:migrate:local`.

## Where things stand

Sections 1–6 of `SPEC.md` describe shipped behaviour, except where a **[Phase N]** marker points
into the delivery plan in §8. Two of those markers are debts rather than features: `forcedCapture`
and the RPS restriction on checkers leaps are specified but not yet implemented (Phase 0). Phase 0b
is presentation — theme-aware GIF export and the theatre moving beside the play card — and lands
early because Phases 1, 3, and 4 all build on those surfaces.

Gold generals, hex boards, and alternating setup ship **unrated** — `isRatedEligible(cfg)` is the
single place that policy lives, and §8.9 lists what must be measured before it widens.
