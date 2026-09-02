// Topology adapter: square and hex lattice adapters.
// The single source of truth for lattice geometry, coordinates, rays, distance, and 180° symmetry.
// Implements SPEC §8.2, §8.4, §8.5.
// Zero external dependencies; runs in modern browser, Node.js, and workerd.

export const TOPOLOGIES = Object.freeze(['square', 'hex']);
export const MIN_HEX_RADIUS = 2;
export const MAX_HEX_RADIUS = 8;

// ── square topology adapter ──────────────────────────────────────────────────
export class SquareTopology {
  constructor(size) {
    this.topology = 'square';
    this.size = Math.max(3, Math.min(13, Math.floor(size || 9)));
    this.cellCount = this.size * this.size;
  }

  has(r, c) {
    return r >= 0 && r < this.size && c >= 0 && c < this.size;
  }

  cells() {
    const list = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        list.push([r, c]);
      }
    }
    return list;
  }

  coordKey(coord) {
    return `${coord[0]},${coord[1]}`;
  }

  opposite(coord) {
    return [this.size - 1 - coord[0], this.size - 1 - coord[1]];
  }

  distance(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  }

  coordinateLabel(coord, style = 'chess') {
    const [r, c] = coord;
    if (style === 'grid') {
      const rowLetter = String.fromCharCode(97 + r);
      return `${rowLetter}${c + 1}`;
    }
    const fileLetter = String.fromCharCode(97 + c);
    return `${fileLetter}${this.size - r}`;
  }

  neighbours(coord, mode = 'king') {
    const [r, c] = coord;
    const dirs = mode === 'edge' || mode === 'cross'
      ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
      : [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const res = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (this.has(nr, nc)) res.push([nr, nc]);
    }
    return res;
  }

  rays(coord, archetype, color = 'B') {
    const [r, c] = coord;
    const out = [];

    const slide = (dirs) => {
      for (const [dr, dc] of dirs) {
        const ray = [];
        let nr = r + dr, nc = c + dc;
        while (this.has(nr, nc)) {
          ray.push([nr, nc]);
          nr += dr;
          nc += dc;
        }
        if (ray.length) out.push(ray);
      }
    };

    const step = (dirs) => {
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (this.has(nr, nc)) out.push([[nr, nc]]);
      }
    };

    switch (archetype) {
      case 'cross':
        step([[-1, 0], [1, 0], [0, -1], [0, 1]]);
        break;
      case 'rook':
        slide([[-1, 0], [1, 0], [0, -1], [0, 1]]);
        break;
      case 'bishop':
        slide([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
        break;
      case 'queen':
        slide([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]);
        break;
      case 'king':
        step([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
        break;
      case 'knight':
        step([
          [-2, -1], [-2, 1], [-1, -2], [-1, 2],
          [1, -2], [1, 2], [2, -1], [2, 1],
        ]);
        break;
      case 'longking':
        // king step + two-square orthogonal leaps
        step([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
        step([[-2, 0], [2, 0], [0, -2], [0, 2]]);
        break;
      case 'gold': {
        // Gold general: 1 step forward, diag forward, sideways, straight back (never diag back)
        // Blue forward is increasing files (col + 1), Red is decreasing files (col - 1)
        const forward = color === 'B' ? 1 : -1;
        step([
          [0, forward],           // straight forward
          [-1, forward],          // diag forward left
          [1, forward],           // diag forward right
          [-1, 0],                // left
          [1, 0],                 // right
          [0, -forward],          // straight back
        ]);
        break;
      }
      default:
        step([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
    }
    return out;
  }

  setupZone(color) {
    const depth = Math.floor(this.size / 3);
    const cells = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (color === 'B' && c < depth) cells.push([r, c]);
        else if (color === 'R' && c >= this.size - depth) cells.push([r, c]);
      }
    }
    return cells;
  }
}

// ── hex topology adapter ─────────────────────────────────────────────────────
// Axial (q, r) with implied s = -q - r.
// Radius R counts center to corner: max(|q|, |r|, |s|) < R.
// Canonical order: increasing r, then increasing q.
export class HexTopology {
  constructor(radius) {
    this.topology = 'hex';
    this.radius = Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, Math.floor(radius || 6)));
    this.cellCount = 1 + 3 * this.radius * (this.radius - 1);
  }

  has(q, r) {
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) < this.radius;
  }

  cells() {
    const list = [];
    const R = this.radius;
    for (let r = -R + 1; r < R; r++) {
      const qMin = Math.max(-R + 1, -r - R + 1);
      const qMax = Math.min(R - 1, -r + R - 1);
      for (let q = qMin; q <= qMax; q++) {
        list.push([q, r]);
      }
    }
    return list;
  }

  coordKey(coord) {
    return `${coord[0]},${coord[1]}`;
  }

  // 180° rotation on hex is cube negation (-q, -r, -s)
  opposite(coord) {
    const q = coord[0] === 0 ? 0 : -coord[0];
    const r = coord[1] === 0 ? 0 : -coord[1];
    return [q, r];
  }

  distance(a, b) {
    const dq = a[0] - b[0];
    const dr = a[1] - b[1];
    const ds = (-a[0] - a[1]) - (-b[0] - b[1]);
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
  }

  coordinateLabel(coord) {
    const qStr = coord[0] >= 0 ? `+${coord[0]}` : String(coord[0]);
    const rStr = coord[1] >= 0 ? `+${coord[1]}` : String(coord[1]);
    return `(${qStr},${rStr})`;
  }

  // The 6 edge neighbours along lattice axes
  neighbours(coord) {
    const [q, r] = coord;
    const dirs = [
      [1, 0], [1, -1], [0, -1],
      [-1, 0], [-1, 1], [0, 1],
    ];
    const res = [];
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      if (this.has(nq, nr)) res.push([nq, nr]);
    }
    return res;
  }

  rays(coord, archetype) {
    if (archetype === 'gold') {
      throw new Error('Hex topology rejects gold archetype (§8.1)');
    }

    const [q, r] = coord;
    const out = [];

    // The 6 edge rays (rook rays along lattice axes)
    const ROOK_DIRS = [
      [1, 0], [1, -1], [0, -1],
      [-1, 0], [-1, 1], [0, 1],
    ];

    // The 6 vertex-diagonal rays (bishop rays: permutations of (1,1,-2) and opposites)
    const BISHOP_DIRS = [
      [2, -1], [1, 1], [-1, 2],
      [-2, 1], [-1, -1], [1, -2],
    ];

    const slide = (dirs) => {
      for (const [dq, dr] of dirs) {
        const ray = [];
        let nq = q + dq, nr = r + dr;
        while (this.has(nq, nr)) {
          ray.push([nq, nr]);
          nq += dq;
          nr += dr;
        }
        if (ray.length) out.push(ray);
      }
    };

    const step = (dirs) => {
      for (const [dq, dr] of dirs) {
        const nq = q + dq, nr = r + dr;
        if (this.has(nq, nr)) out.push([[nq, nr]]);
      }
    };

    switch (archetype) {
      case 'cross':
        step(ROOK_DIRS);
        break;
      case 'rook':
        slide(ROOK_DIRS);
        break;
      case 'bishop':
        slide(BISHOP_DIRS);
        break;
      case 'queen':
        slide([...ROOK_DIRS, ...BISHOP_DIRS]);
        break;
      case 'king':
        // one step in any of the 12 directions (6 edge + 6 vertex)
        step([...ROOK_DIRS, ...BISHOP_DIRS]);
        break;
      case 'knight': {
        // 12 jump destinations: permutations of (1, 2, -3) and opposites
        const KNIGHT_JUMPS = [
          [1, 2], [2, 1], [3, -1], [3, -2], [2, -3], [1, -3],
          [-1, -2], [-2, -1], [-3, 1], [-3, 2], [-2, 3], [-1, 3],
        ];
        step(KNIGHT_JUMPS);
        break;
      }
      case 'longking':
        // king step (12) + exact 2-cell jump along 6 rook rays
        step([...ROOK_DIRS, ...BISHOP_DIRS]);
        for (const [dq, dr] of ROOK_DIRS) {
          const nq = q + 2 * dq, nr = r + 2 * dr;
          if (this.has(nq, nr)) out.push([[nq, nr]]);
        }
        break;
      default:
        step([...ROOK_DIRS, ...BISHOP_DIRS]);
    }
    return out;
  }

  setupZone(color) {
    // Blue the lowest third of q, Red the highest third
    const cols = 2 * this.radius - 1;
    const zoneDepth = Math.floor(cols / 3);
    const cells = [];
    const all = this.cells();
    for (const [q, r] of all) {
      if (color === 'B' && q <= -this.radius + zoneDepth) cells.push([q, r]);
      else if (color === 'R' && q >= this.radius - zoneDepth) cells.push([q, r]);
    }
    return cells;
  }
}

export function topologyFor(cfg = {}) {
  if (cfg.topology === 'hex') {
    return new HexTopology(cfg.radius);
  }
  return new SquareTopology(cfg.size);
}
