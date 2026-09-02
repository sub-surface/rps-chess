import { describe, expect, it } from 'vitest';
import {
  SquareTopology,
  HexTopology,
  topologyFor,
} from '../public/topology.js';

describe('SquareTopology adapter', () => {
  it('instantiates canonical square boards with accurate cells and counts', () => {
    const topo = new SquareTopology(9);
    expect(topo.size).toBe(9);
    expect(topo.cellCount).toBe(81);
    expect(topo.cells()).toHaveLength(81);
    expect(topo.has(0, 0)).toBe(true);
    expect(topo.has(8, 8)).toBe(true);
    expect(topo.has(-1, 0)).toBe(false);
    expect(topo.has(9, 4)).toBe(false);
  });

  it('computes 180° rotational symmetry opposite correctly', () => {
    const topo = new SquareTopology(9);
    expect(topo.opposite([0, 0])).toEqual([8, 8]);
    expect(topo.opposite([4, 4])).toEqual([4, 4]); // center is invariant
    expect(topo.opposite([1, 2])).toEqual([7, 6]);
  });

  it('labels coordinates in chess and grid styles', () => {
    const topo = new SquareTopology(9);
    expect(topo.coordinateLabel([0, 0], 'chess')).toBe('a9');
    expect(topo.coordinateLabel([8, 8], 'chess')).toBe('i1');
    expect(topo.coordinateLabel([0, 0], 'grid')).toBe('a1');
    expect(topo.coordinateLabel([8, 8], 'grid')).toBe('i9');
  });

  it('generates rays for all movement archetypes including gold general', () => {
    const topo = new SquareTopology(5);
    // King at center (2, 2)
    const kingRays = topo.rays([2, 2], 'king');
    expect(kingRays).toHaveLength(8);

    // Gold general orientation: Blue vs Red
    const blueGold = topo.rays([2, 2], 'gold', 'B').flat();
    expect(blueGold).toContainEqual([2, 3]); // forward (increasing files)
    expect(blueGold).not.toContainEqual([1, 1]); // never diag back
    expect(blueGold).not.toContainEqual([3, 1]); // never diag back

    const redGold = topo.rays([2, 2], 'gold', 'R').flat();
    expect(redGold).toContainEqual([2, 1]); // forward for Red (decreasing files)
  });

  it('constructs setup zones for deployment play', () => {
    const topo = new SquareTopology(9);
    const blueZone = topo.setupZone('B');
    const redZone = topo.setupZone('R');
    expect(blueZone.length).toBe(27); // 3 files * 9 rows
    expect(redZone.length).toBe(27);
    expect(blueZone.every(([r, c]) => c < 3)).toBe(true);
    expect(redZone.every(([r, c]) => c >= 6)).toBe(true);
  });
});

describe('HexTopology adapter', () => {
  it('counts radius-r cells accurately: 1 + 3r(r-1)', () => {
    // Radius 4: 1 + 3*4*3 = 37
    const hex4 = new HexTopology(4);
    expect(hex4.cellCount).toBe(37);
    expect(hex4.cells()).toHaveLength(37);

    // Radius 6: 1 + 3*6*5 = 91 (the analogue to 9x9 Standard's 81)
    const hex6 = new HexTopology(6);
    expect(hex6.cellCount).toBe(91);
    expect(hex6.cells()).toHaveLength(91);

    // Radius 8: 1 + 3*8*7 = 169
    const hex8 = new HexTopology(8);
    expect(hex8.cellCount).toBe(169);
    expect(hex8.cells()).toHaveLength(169);
  });

  it('orders cells canonically by increasing r then increasing q', () => {
    const hex = new HexTopology(4);
    const cells = hex.cells();
    for (let i = 1; i < cells.length; i++) {
      const prev = cells[i - 1], curr = cells[i];
      if (prev[1] === curr[1]) {
        expect(curr[0]).toBeGreaterThan(prev[0]);
      } else {
        expect(curr[1]).toBeGreaterThan(prev[1]);
      }
    }
  });

  it('calculates 180° rotation as exact cube negation (-q, -r, -s)', () => {
    const hex = new HexTopology(6);
    expect(hex.opposite([0, 0])).toEqual([0, 0]);
    expect(hex.opposite([2, -3])).toEqual([-2, 3]);
    expect(hex.opposite([-4, 1])).toEqual([4, -1]);
  });

  it('computes cube distance between axial coordinates', () => {
    const hex = new HexTopology(6);
    expect(hex.distance([0, 0], [0, 0])).toBe(0);
    expect(hex.distance([0, 0], [1, 0])).toBe(1);
    expect(hex.distance([0, 0], [2, -2])).toBe(2);
    expect(hex.distance([-3, 1], [2, 1])).toBe(5);
  });

  it('generates 6 edge rays for rooks and 6 vertex rays for bishops', () => {
    const hex = new HexTopology(6);
    const rookRays = hex.rays([0, 0], 'rook');
    expect(rookRays).toHaveLength(6);
    // Center to edge in radius 6 has 5 steps along ray
    expect(rookRays[0]).toHaveLength(5);

    const bishopRays = hex.rays([0, 0], 'bishop');
    expect(bishopRays).toHaveLength(6);

    // King has 12 destinations at the center
    const kingRays = hex.rays([0, 0], 'king');
    expect(kingRays).toHaveLength(12);

    // Knights have 12 jumps
    const knightRays = hex.rays([0, 0], 'knight');
    expect(knightRays).toHaveLength(12);

    // Gold general must be rejected on hex
    expect(() => hex.rays([0, 0], 'gold')).toThrow(/rejects gold archetype/);
  });

  it('maps Blue and Red setup zones symmetrically via cube negation', () => {
    const hex = new HexTopology(6);
    const blueZone = hex.setupZone('B');
    const redZone = hex.setupZone('R');
    expect(blueZone.length).toBe(redZone.length);
    expect(blueZone.length).toBeGreaterThan(0);

    // Negating every coordinate in Blue's zone must produce a coordinate in Red's zone
    for (const coord of blueZone) {
      const opp = hex.opposite(coord);
      expect(redZone).toContainEqual(opp);
    }
  });

  it('resolves topologies through topologyFor() factory', () => {
    expect(topologyFor({ topology: 'square', size: 7 }).topology).toBe('square');
    expect(topologyFor({ topology: 'hex', radius: 6 }).topology).toBe('hex');
  });
});
