// Deterministic, dependency-free animated GIF export for JANKEN games.
// The renderer draws directly into an indexed palette, keeping downloads small and
// avoiding a canvas readback or a large GIF library on the initial page load.
import * as E from './engine.js';

// Two palettes, one per theme, with identical index meanings. Nothing downstream — the encoder, the
// frame sampler, the tests — knows which one is in play, which is why the index layout is fixed
// even where a slot goes unused.
//
// Slots 9 and 14 are the last-move wash, one per square parity. They are a lift of the square
// beneath rather than a colour of their own: a highlight that competes with Blue and Red for
// attention makes a two-player board harder to read, not easier.
export const PALETTES = {
  dark: [
    [10, 10, 12],      //  0 dark square
    [20, 20, 24],      //  1 light square
    [20, 31, 61],      //  2 Blue-owned dark
    [28, 41, 75],      //  3 Blue-owned light
    [58, 21, 25],      //  4 Red-owned dark
    [70, 29, 34],      //  5 Red-owned light
    [77, 124, 254],    //  6 Blue piece
    [229, 72, 77],     //  7 Red piece
    [32, 32, 39],      //  8 grid
    [30, 29, 44],      //  9 last move, dark parity
    [242, 242, 245],   // 10 highlight
    [134, 134, 143],   // 11 muted
    [0, 0, 0],         // 12
    [255, 255, 255],   // 13
    [42, 41, 58],      // 14 last move, light parity
    [0, 0, 0],         // 15
  ],
  light: [
    [232, 232, 236],   //  0 dark square
    [246, 246, 248],   //  1 light square
    [196, 209, 240],   //  2 Blue-owned dark
    [214, 224, 248],   //  3 Blue-owned light
    [242, 202, 204],   //  4 Red-owned dark
    [250, 219, 221],   //  5 Red-owned light
    [40, 84, 208],     //  6 Blue piece
    [190, 40, 46],     //  7 Red piece
    [206, 206, 212],   //  8 grid
    [214, 212, 232],   //  9 last move, dark parity
    [24, 24, 27],      // 10 highlight
    [110, 110, 118],   // 11 muted
    [0, 0, 0],         // 12
    [255, 255, 255],   // 13
    [230, 228, 244],   // 14 last move, light parity
    [0, 0, 0],         // 15
  ],
};
// An export with no theme keeps the dark palette, which is the path the Workers-runtime tests take.
const paletteFor = (theme) => (theme === 'light' ? PALETTES.light : PALETTES.dark);
const LAST_DARK = 9, LAST_LIGHT = 14;

const push16 = (out, value) => {
  out.push(value & 255, (value >> 8) & 255);
};

function lzw(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize;
  let nextCode;
  let dictionary;
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes = [];

  const reset = () => {
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
    dictionary = new Map();
  };
  const write = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 255);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  // The decoder learns a dictionary entry only after reading the next code, so
  // code-width growth deliberately happens one emitted data code after the
  // encoder allocates the threshold entry.
  const writeData = (code) => {
    write(code);
    if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
  };

  reset();
  write(clearCode);
  if (indices.length) {
    let prefix = indices[0];
    for (let index = 1; index < indices.length; index++) {
      const suffix = indices[index];
      const key = `${prefix},${suffix}`;
      const found = dictionary.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      writeData(prefix);
      if (nextCode < 4096) {
        dictionary.set(key, nextCode++);
      } else {
        write(clearCode);
        reset();
      }
      prefix = suffix;
    }
    writeData(prefix);
  }
  write(endCode);
  if (bitCount) bytes.push(bitBuffer & 255);
  return bytes;
}

export function encodeGif({ width, height, frames, palette = PALETTES.dark, loop = 0 }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('GIF dimensions must be positive integers');
  }
  if (!Array.isArray(frames) || !frames.length) throw new Error('GIF requires at least one frame');
  const tableSize = 2 ** Math.max(1, Math.ceil(Math.log2(palette.length)));
  if (tableSize > 256) throw new Error('GIF palette cannot exceed 256 colours');
  const sizeCode = Math.log2(tableSize) - 1;
  const minCodeSize = Math.max(2, Math.log2(tableSize));
  const out = [71, 73, 70, 56, 57, 97]; // GIF89a
  push16(out, width);
  push16(out, height);
  out.push(0x80 | 0x70 | sizeCode, 0, 0);
  for (let index = 0; index < tableSize; index++) {
    out.push(...(palette[index] || [0, 0, 0]));
  }

  // NETSCAPE2.0 loop extension. A loop count of zero means forever.
  out.push(0x21, 0xff, 0x0b, ...new TextEncoder().encode('NETSCAPE2.0'), 0x03, 0x01);
  push16(out, loop);
  out.push(0);

  for (const frame of frames) {
    if (!(frame.pixels instanceof Uint8Array) || frame.pixels.length !== width * height) {
      throw new Error('GIF frame dimensions do not match');
    }
    const delay = Math.max(1, Math.min(65535, Math.round(frame.delay ?? 45)));
    out.push(0x21, 0xf9, 0x04, 0x04);
    push16(out, delay);
    out.push(0, 0);
    out.push(0x2c);
    push16(out, 0); push16(out, 0); push16(out, width); push16(out, height);
    out.push(0, minCodeSize);
    const compressed = lzw(frame.pixels, minCodeSize);
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const block = compressed.slice(offset, offset + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

const setPixel = (pixels, width, height, x, y, colour) => {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = colour;
};
const fillRect = (pixels, width, height, x, y, w, h, colour) => {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w)), y1 = Math.min(height, Math.ceil(y + h));
  for (let row = y0; row < y1; row++) pixels.fill(colour, row * width + x0, row * width + x1);
};
const line = (pixels, width, height, x0, y0, x1, y1, colour, thick = 1) => {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    const radius = Math.max(0, Math.floor((thick - 1) / 2));
    fillRect(pixels, width, height, x0 - radius, y0 - radius, radius * 2 + 1, radius * 2 + 1, colour);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
};
const circle = (pixels, width, height, cx, cy, radius, colour, thick = 1) => {
  for (let step = 0; step < Math.ceil(2 * Math.PI * radius * 1.4); step++) {
    const angle = step / Math.ceil(2 * Math.PI * radius * 1.4) * Math.PI * 2;
    fillRect(
      pixels,
      width,
      height,
      cx + Math.cos(angle) * radius - thick / 2,
      cy + Math.sin(angle) * radius - thick / 2,
      thick,
      thick,
      colour,
    );
  }
};
const polygon = (pixels, width, height, points, colour) => {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point[1]))));
  for (let y = minY; y <= maxY; y++) {
    const crossings = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index], b = points[(index + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      fillRect(pixels, width, height, crossings[index], y, crossings[index + 1] - crossings[index] + 1, 1, colour);
    }
  }
};

function drawPiece(pixels, width, height, type, colour, x, y, cell) {
  const cx = x + cell / 2, cy = y + cell / 2;
  const radius = cell * 0.27;
  const thick = Math.max(1, Math.round(cell * 0.055));
  if (type === 'rock') {
    polygon(pixels, width, height, [
      [cx - radius, cy + radius * 0.35], [cx - radius * 0.55, cy - radius * 0.65],
      [cx, cy - radius], [cx + radius * 0.8, cy - radius * 0.35],
      [cx + radius, cy + radius * 0.55], [cx + radius * 0.35, cy + radius],
      [cx - radius * 0.55, cy + radius * 0.9],
    ], colour);
  } else if (type === 'paper') {
    const left = cx - radius * 0.7, top = cy - radius;
    const right = cx + radius * 0.7, bottom = cy + radius;
    line(pixels, width, height, left, top, right, top, colour, thick);
    line(pixels, width, height, right, top, right, bottom, colour, thick);
    line(pixels, width, height, right, bottom, left, bottom, colour, thick);
    line(pixels, width, height, left, bottom, left, top, colour, thick);
    line(pixels, width, height, left + radius * 0.25, cy - radius * 0.25, right - radius * 0.2, cy - radius * 0.25, colour, thick);
    line(pixels, width, height, left + radius * 0.25, cy + radius * 0.25, right - radius * 0.2, cy + radius * 0.25, colour, thick);
  } else {
    line(pixels, width, height, cx - radius * 0.65, cy - radius, cx + radius * 0.35, cy + radius * 0.25, colour, thick);
    line(pixels, width, height, cx + radius * 0.65, cy - radius, cx - radius * 0.35, cy + radius * 0.25, colour, thick);
    circle(pixels, width, height, cx - radius * 0.43, cy + radius * 0.58, radius * 0.34, colour, thick);
    circle(pixels, width, height, cx + radius * 0.43, cy + radius * 0.58, radius * 0.34, colour, thick);
  }
}

// `paint` is an optional hook supplying a cell-sized block of palette indices for a piece, with 255
// meaning leave the square showing. It exists so a browser can export the artwork the player is
// actually looking at; with no hook this draws its own geometry, which is the only path under test.
// Copies a cell-sized index block onto the frame. 255 is the transparent index, chosen because it
// cannot collide with a sixteen-entry palette.
function blit(pixels, width, height, stamp, x, y, cell) {
  for (let dy = 0; dy < cell; dy++) {
    const py = y + dy;
    if (py < 0 || py >= height) continue;
    for (let dx = 0; dx < cell; dx++) {
      const value = stamp[dy * cell + dx];
      const px = x + dx;
      if (value === 255 || px < 0 || px >= width) continue;
      pixels[py * width + px] = value;
    }
  }
}

function renderBoard(board, lastMove, width, height, paint = null) {
  const pixels = new Uint8Array(width * height);
  const size = board.length;
  const cell = Math.floor(Math.min(width, height) / size);
  const span = cell * size;
  const left = Math.floor((width - span) / 2);
  const top = Math.floor((height - span) / 2);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const square = board[row][col];
    const light = (row + col) % 2 === 0;
    let colour = light ? 1 : 0;
    if (square.owner === E.BLUE) colour = light ? 3 : 2;
    if (square.owner === E.RED) colour = light ? 5 : 4;
    const isLast = lastMove
      && ((lastMove.fr === row && lastMove.fc === col) || (lastMove.tr === row && lastMove.tc === col));
    const wash = light ? LAST_LIGHT : LAST_DARK;
    // On unclaimed ground the wash replaces the square. On painted ground it becomes an inset
    // frame instead: sixteen colours cannot hold a lift of all six square colours, and whose
    // territory a square is matters more than where the last move went.
    if (isLast && square.owner === null) colour = wash;
    const x = left + col * cell, y = top + row * cell;
    fillRect(pixels, width, height, x, y, cell, cell, colour);
    if (isLast && square.owner !== null) {
      const inset = Math.max(1, Math.round(cell * 0.12));
      const far = cell - inset - 1;
      line(pixels, width, height, x + inset, y + inset, x + far, y + inset, wash);
      line(pixels, width, height, x + far, y + inset, x + far, y + far, wash);
      line(pixels, width, height, x + far, y + far, x + inset, y + far, wash);
      line(pixels, width, height, x + inset, y + far, x + inset, y + inset, wash);
    }
    if (!square.piece) continue;
    const stamp = paint && paint(square.piece.type, square.piece.color, cell);
    if (stamp) blit(pixels, width, height, stamp, x, y, cell);
    else drawPiece(pixels, width, height, square.piece.type, square.piece.color === E.BLUE ? 6 : 7, x, y, cell);
  }
  for (let index = 0; index <= size; index++) {
    line(pixels, width, height, left + index * cell, top, left + index * cell, top + span, 8);
    line(pixels, width, height, left, top + index * cell, left + span, top + index * cell, 8);
  }
  return pixels;
}

export function gameFrames(record, maxFrames = 160) {
  const cfg = E.sanitizeCfg(record?.cfg);
  const pieces = E.decodePos(record?.startPos || record?.pos, cfg.size);
  const board = pieces && E.decodeOwners(record?.startOwners || record?.own, pieces);
  if (!board) {
    if (!record?.moves?.length && Array.isArray(record?.board)) {
      return [{ board: E.cloneBoard(record.board), lastMove: record.lastMove || null }];
    }
    throw new Error('The game does not contain a replayable starting position');
  }
  const game = E.newGame(cfg, board);
  const snapshots = [{ board: E.cloneBoard(game.board), lastMove: null }];
  for (const recorded of record.moves || []) {
    const from = recorded.from, to = recorded.to;
    const move = {
      fr: from?.[0], fc: from?.[1], tr: to?.[0], tc: to?.[1],
    };
    if (game.gameOver || !E.isLegal(game.board, move, game.turn, cfg)) {
      throw new Error('The game contains an illegal replay move');
    }
    E.applyMove(game, move);
    snapshots.push({ board: E.cloneBoard(game.board), lastMove: { ...game.lastMove } });
  }
  if (snapshots.length <= maxFrames) return snapshots;
  const sampled = [snapshots[0]];
  const stride = (snapshots.length - 1) / (maxFrames - 1);
  for (let index = 1; index < maxFrames - 1; index++) sampled.push(snapshots[Math.round(index * stride)]);
  sampled.push(snapshots.at(-1));
  return sampled;
}

const frameWidth = (options) => Math.max(180, Math.min(600, Math.round(options.size || 320)));

// The frame width and square size an export will use. A caller that has to prepare artwork per
// square needs to know the size in advance, and deriving it a second time is how two renderers
// start disagreeing by a pixel.
export const frameGeometry = (boardSize, options = {}) => {
  const width = frameWidth(options);
  return { width, cell: Math.floor(width / boardSize) };
};

// `theme` selects a palette, `drawPiece` optionally supplies the client's own artwork. Both are
// omitted by every non-browser caller, which is what keeps this module DOM-free and deterministic.
export function exportGameGif(record, options = {}) {
  const width = frameWidth(options);
  const snapshots = gameFrames(record, options.maxFrames || 96);
  const paint = typeof options.drawPiece === 'function' ? options.drawPiece : null;
  const frames = snapshots.map((snapshot, index) => ({
    pixels: renderBoard(snapshot.board, snapshot.lastMove, width, width, paint),
    delay: index === snapshots.length - 1 ? 160 : 48,
  }));
  const bytes = encodeGif({ width, height: width, frames, palette: paletteFor(options.theme) });
  return new Blob([bytes], { type: 'image/gif' });
}
