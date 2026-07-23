# JANKEN — rock · paper · scissors chess

A minimal territory game. Rock–paper–scissors pieces move like chess pieces; every square you
land on is painted your colour. Fill the board, hold the most ground. Live at
**[rps.subsurfaces.net](https://rps.subsurfaces.net)**.

## Play

- **Rock** steps 1 (king) · **Paper** slides straight (rook) · **Scissors** slides diagonally (bishop).
- **RPS capture** (default): you may only take a piece you beat — rock>scissors>paper>rock.
- **Territory** (default): land only on empty *unclaimed* squares (or capture); the board fills and
  most squares wins.
- Modes: hot-seat, vs bot, bot-vs-bot, and **online** (share a link or pick from the lobby).
- Variants from the home menu: board size, pieces/type, up to 3 actions/turn, all-kings / all-queens
  movement, chess capture, pure elimination, custom starting positions.

See [`SPEC.md`](./SPEC.md) for the full rules and architecture.

## Stack

Zero-build static client (vanilla JS, no framework) served by a Cloudflare Worker. Online play uses
two Durable Objects — one **GameRoom** per match (authoritative, validates every move over
WebSockets) and one global **Lobby** of open games. Rules live in `public/engine.js`, imported by
both the browser and the Worker so client hints always match server validation.

```
public/    index.html · style.css · game.js (client) · engine.js (shared rules) · favicon.svg
src/       worker.js  (Worker + GameRoom + Lobby Durable Objects)
scripts/   version.mjs (stamps public/version.json with the git commit for the footer)
```

## Develop / deploy

```sh
npm install
npm run dev       # wrangler dev — local server with DO emulation
npm run deploy     # stamps version.json, then wrangler deploy
```

Worker `rps-chess` · custom domain `rps.subsurfaces.net` · account Sub-Surface · repo
`sub-surface/rps-chess`.
