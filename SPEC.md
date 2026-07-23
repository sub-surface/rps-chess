# JANKEN — spec

Rock-paper-scissors played like chess, on a square board. Live at **rps.subsurfaces.net**.
Zero-build static client + a Cloudflare Worker with two Durable Objects for online play.

## 1. Rules

Two players, **Blue** and **Red**, alternate turns. Each starts with `perType` of each piece
(rock, paper, scissors), arranged as a mirrored block per side (180° rotational symmetry → fair).

### Movement (`moveStyle`)
- **classic** (default): Rock = king (step 1), Paper = rook (slide orthogonally), Scissors = bishop (slide diagonally).
- **kings**: every piece steps one square (king).
- **queens**: every piece slides any direction.

Sliding pieces are blocked only by pieces; they glide over empty squares (painted or not).

### Capturing (`capture`)
- **rps** (default): you may only capture a piece you beat — rock>scissors>paper>rock. A piece you
  don't beat blocks you (can't land there).
- **chess**: capture anything.

### Goal (`territory`)
- **territory** (default): every square a piece lands on is painted your colour permanently. You may
  only *stop* on an empty **unclaimed** square or an enemy piece (sliders glide over painted squares),
  so each non-capturing move claims exactly one neutral square → the board always fills. **Most squares wins.**
  - `retread`: relax the above — allow stopping on any empty square (incl. your own). A no-progress
    guard then ends stalled games.
- **elimination**: no painting. Win by capturing all (or the most) enemy pieces.

### Turns (`actionsPerTurn`)
A turn is `actionsPerTurn` consecutive moves by the same player (default 1; configurable 1–3). The
turn passes early if the player runs out of legal moves. Territory + fixed action count keep every
game finite.

### End / result
- territory: board full, or neither side can move (double-pass), or no-progress stall → most squares.
- elimination: a side has no pieces, or double-pass/stall → most pieces.
- Odd board → territory games can't tie on a full board; early stops can draw.

### Presets
- **Standard**: 9×9, classic, RPS capture, territory, 1 action. (the default)
- **King's field**: 9×9, all-kings, RPS capture, elimination, 1 action.
- Any field may be overridden → **Custom**.

## 2. Config schema (`cfg`)

```
size 6..13 · perType 1..4 · moveStyle classic|kings|queens · capture rps|chess
territory bool · retread bool · actionsPerTurn 1..3 · first B|R
```
Client-only (not rules, not sent to server): `pieceStyle` (line|pixel), `coords`, `hints`, theme, flip, guest `name`.
`engine.sanitizeCfg()` clamps every rules field server-side — untrusted input can never make an oversized board or illegal value.

## 3. Architecture

- `public/engine.js` — pure rules (no DOM). **Single source of truth**, imported by the browser
  client *and* the Durable Object, so client hints always match server validation.
- `public/game.js` — client: homepage/lobby, board render, local play (hot-seat / vs-bot / bot-vs-bot),
  online client, appearance.
- `src/worker.js` — Worker (serves assets, routes `/ws`, `/api/lobby`) + two Durable Objects:
  - **GameRoom** (one per room): authoritative game state; validates every move (`isLegal`); assigns
    seats by unguessable token; broadcasts state over hibernatable WebSockets; registers/removes
    itself in the lobby; self-expires after 30 min idle via alarm.
  - **Lobby** (one global): list of open games (host name + variant) with a 20-min TTL prune.

### Online protocol (JSON over WS)
- connect: `/ws?room=&name=&token?=&cfg?=` → server replies `{type:'welcome', role:'B'|'R'|'S', token, state}`.
- client→server: `{type:'move', from:[r,c], to:[r,c]}` · `{type:'new', cfg}` · `{type:'sync'}`.
- server→all: `{type:'state', state}` on every change. `state` = board, turn, acts, moves, gameOver,
  lastMove, cfg, result, names, seats.
- Security: server authoritative; move legality re-checked server-side; identity is a capability
  (room id + per-seat token, both unguessable); message size capped; only seated players can move/restart.

## 4. Deploy

`npm run deploy` → writes `public/version.json` (git hash, shown in footer) then `wrangler deploy`.
Worker `rps-chess`, custom domain `rps.subsurfaces.net`, account Sub-Surface. Repo `sub-surface/rps-chess`.
