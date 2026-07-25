# JPGN 1.1 — JANKEN Portable Game Notation

JPGN is JANKEN’s UTF-8, PGN-inspired interchange format. A `.jpgn` record is
human-readable, self-contained, and strict enough to replay without the website or
its database. It records:

- exact variant rules, including movement assigned independently to Rock, Paper,
  and Scissors;
- exact starting pieces and painted territory as separate layers;
- every individual action in multi-action turns;
- public game metadata, result, score, and termination reason;
- enough integrity information for a reader to reject an illegal or inconsistent
  record.

The in-game **Export → Copy JPGN** command writes a complete record. The reference
writer, parser, and legality-checked replayer are in `public/notation.js`.

## 1. Example

```text
[JPGN "1.1"]
[Event "JANKEN Online Game"]
[Site "https://rps.subsurfaces.net/"]
[Date "2026.07.24"]
[Blue "Blue"]
[Red "Red"]
[Result "*"]
[Variant "6×6 · R rook / P knight / S bishop · RPS · territory+"]
[Ruleset "Custom"]
[RulesetVersion "1.0"]
[Board "6x6"]
[StartLayout "rows"]
[Rules "size=6;perType=1;rockMove=rook;paperMove=knight;scissorsMove=bishop;capture=rps;territory=1;retread=1;trail=0;enclosure=0;threefold=1;layout=rows;actionsPerTurn=2;first=B"]
[Position "6:R..................................s"]
[Territory "6:B..................................R"]
[Rated "0"]
[Termination "unterminated"]
[Score "2-1 squares"]
[PlyCount "2"]
[Replayable "1"]

1.B1 Ra6-b6 1.B2 Rb6-c6 *
```

## 2. Record grammar

A record contains one tag pair per line, one blank line, whitespace-separated
movetext, and one final result token.

```text
record       = tag-line, { newline, tag-line }, newline, newline,
               movetext, result-token, [ newline ]
tag-line     = "[", tag-name, " ", quoted-value, "]"
tag-name     = letter, { letter | digit | "_" }
quoted-value = '"', { escaped-char | non-quote-char }, '"'
result-token = "1-0" | "0-1" | "1/2-1/2" | "*"
```

Within tag values, `"` is escaped as `\"` and `\` as `\\`. Newlines are
normalized to spaces. Readers must ignore unknown tags so minor extensions remain
forward-compatible.

## 3. Tags

### Required identity and result tags

| Tag | Meaning |
| --- | --- |
| `JPGN` | Format version. Writers emit `1.1`. |
| `Event` | Human-readable game class: local, online, rated, analysis, or another event name. |
| `Site` | Origin at which the game was played. |
| `Date` | UTC date as `YYYY.MM.DD`; unknown components may be `?`. |
| `Blue`, `Red` | Display names at export time. |
| `Result` | `1-0`, `0-1`, `1/2-1/2`, or `*` for unfinished. |
| `Termination` | Engine or adjudication reason described in section 8. |
| `Score` | Current/final Blue–Red value plus `squares` or `pieces`. |
| `PlyCount` | Number of individual actions in movetext. |

### Required variant and position tags

| Tag | Meaning |
| --- | --- |
| `Variant` | Human-readable summary; informative, not authoritative. |
| `Ruleset` | `Standard`, `King's Field`, `Painters`, or `Custom`. |
| `RulesetVersion` | Version of the named preset definition; currently `1.0`. |
| `Board` | Dimensions as `NxN`. Must match `Rules.size`. |
| `StartLayout` | Human-readable layout identifier. The exact position layers remain authoritative. |
| `Rules` | Canonical machine-readable rules from section 4. |
| `Position` | Exact starting piece layer from section 5. |
| `Territory` | Exact starting ownership layer from section 5. |
| `Replayable` | `1` only when the start and every move are complete enough for strict replay. |

### Optional context tags

Online records can include `Room`, `BlueElo`, and `RedElo`. Implementations may
add namespaced metadata tags, but game semantics must remain in the required
fields. `Rated` is emitted as `1` or `0`.

## 4. Canonical rules

`Rules` is a semicolon-separated set of `key=value` fields:

```text
size=3..13
perType=1..4
rockMove=king|rook|bishop|knight|queen|cross|longking
paperMove=king|rook|bishop|knight|queen|cross|longking
scissorsMove=king|rook|bishop|knight|queen|cross|longking
capture=rps|chess|checkers
territory=0|1
retread=0|1
trail=0|1
enclosure=0|1
threefold=0|1
layout=rows|corners|scattered
actionsPerTurn=1..3
first=B|R
```

Movement meanings:

| Value | Legal displacement |
| --- | --- |
| `king` | One square orthogonally or diagonally. |
| `rook` | Any unobstructed distance orthogonally. |
| `bishop` | Any unobstructed distance diagonally. |
| `knight` | A chess knight’s 2-by-1 jump; intervening squares do not matter. |
| `queen` | Any unobstructed distance orthogonally or diagonally. |
| `cross` | One square orthogonally. |
| `longking` | A king step, or an exact two-square orthogonal jump. |

Sliding pieces are `rook`, `bishop`, and `queen`. Only sliders paint intermediate
squares when `trail=1`; jumps never paint their intervening square. With
`capture=checkers`, all movement fields sanitize to `longking`, ordinary moves cannot
capture, and an exact two-square orthogonal jump must pass over and remove an adjacent
enemy while landing on an empty square. Other jumps ignore the intervening square.

A reader must pass decoded values through the same bounds and enum validation as
the rules engine. `retread`, `trail`, and `enclosure` are false when `territory=0`.

### 1.0 compatibility

JPGN 1.0 used one legacy `moveStyle` field:

- `classic` → Rock king, Paper rook, Scissors bishop;
- `kings` → all kings;
- `queens` → all queens.

The bundled parser accepts 1.0 records and expands that field to the three 1.1
movement assignments. New writers must emit the explicit 1.1 fields. Records that
omit `threefold` are read with repetition disabled, preserving the historical rules
under which they were written; new writers always emit it explicitly.

## 5. Starting position layers

`Position` is `<size>:<piece-layer>`. The layer contains exactly `size²`
row-major characters beginning at the visual top-left:

- `R`, `P`, `S`: Blue rock, paper, scissors;
- `r`, `p`, `s`: Red rock, paper, scissors;
- `.`: no piece.

`Territory` is `<size>:<owner-layer>` with the same dimensions:

- `B`: Blue-painted;
- `R`: Red-painted;
- `.`: neutral.

A piece’s cell must have the same owner as its colour. Keeping ownership separate
from pieces preserves painted empty squares and makes custom analysis starts exact.
`StartLayout` never overrides these layers.

## 6. Movetext

Each action is a prefix/move pair:

```text
<round>.<side><action> <piece><from><operator><to>
```

- `round` starts at 1 and increments when play cycles from Red to Blue;
- `side` is `B` or `R`;
- `action` starts at 1 for each side’s turn;
- `piece` is `R`, `P`, or `S`;
- squares use files `a`–`m` and ranks `1`–`13`;
- `-` denotes a non-capture and `x` a capture. For checkers capture, `x` marks removal
  of the jumped piece even though the destination is empty.

```text
1.B1 Rb6-c6 1.R1 Sh6-g5 2.B1 Pc5-c7
1.B1 Rb6-c6 1.B2 Pc5-c7 1.B3 Sd5-e5 1.R1 Rh1-h2 1.R2 Pg1-e2 1.R3 Sf1-e1
```

The second example is a three-actions-per-turn game. Every action repeats the
piece letter, so moving different pieces—or moving one piece repeatedly—remains
unambiguous. Movetext ends with the exact same result token as the `Result` tag.

## 7. Results and scoring

For completed territory games, compare painted squares. For completed elimination
games, compare surviving pieces. The higher value wins; equal values produce
`1/2-1/2`. A forced result from resignation, abandonment, or external adjudication
may differ from the board score, so both `Result` and `Score` are retained.
Threefold repetition is always a draw even when the current board score is unequal.

Unfinished records use `Result "*"`, `Termination "unterminated"`, and the current
score.

## 8. Termination values

- `territory`: no neutral square remains;
- `majority`: an enclosure game gave one side more than half the board;
- `elimination`: a player has no pieces;
- `nocaptures`: no surviving RPS piece type can capture another;
- `immobilization`: either player has no legal move;
- `repetition`: the same playable state occurred for the third time;
- `stall`: the bounded no-progress guard fired;
- `resign`: a seated player resigned;
- `abandon`: a rated player exceeded the disconnect grace period;
- `adjudication`: another explicit external decision;
- `unterminated`: play is active.

Only `resign`, `abandon`, and `adjudication` can impose a winner independently of
the reconstructed board. `repetition` imposes a draw independently of board score.

## 9. Strict replay algorithm

A strict reader should:

1. parse tag syntax and confirm a supported version;
2. parse and sanitize `Rules`;
3. verify `Board`, then decode `Position` and `Territory`;
4. verify `PlyCount` and the final result token;
5. for each action, verify round, side, and action number;
6. verify the source piece and whether `-`/`x` matches the destination;
7. validate the move through the JANKEN rules engine and apply it;
8. reject moves after a board-terminal state;
9. apply a forced winner only for an allowed adjudication reason;
10. verify the reproduced result, score, and board termination reason.

`replayJpgn()` implements this procedure and throws on malformed, out-of-turn,
illegal, or internally inconsistent records.

## 10. Extension and safety rules

- Readers must not depend on tag order and must ignore unknown tags.
- Readers must reject unsupported major semantics and `Replayable "0"` when strict
  replay is requested.
- Names and other metadata are inert text, never HTML or executable content.
- Importers should cap input bytes, tag count, and action count before processing
  untrusted files.
- Writers should retain exact starting layers even for known presets. Preset names
  can evolve; the recorded board cannot.
- A canonical file uses UTF-8, LF line endings, the tag order shown by the
  reference writer, and a trailing newline.

Suggested media type: `text/x-jpgn; charset=utf-8`. Suggested extension: `.jpgn`.
