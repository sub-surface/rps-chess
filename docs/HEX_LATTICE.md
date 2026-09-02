# Hexagonal Lattice Topology & The Solved Hex Tablebase

## 1. Geometry & Coordinate System

JANKEN supports hexagonal lattices using **axial coordinates $(q, r)$** with an implied third cube coordinate $s = -q - r$.
The lattice is constrained by a hexagonal boundary of radius $R \ge 2$:
$$\max(|q|, |r|, |s|) < R$$

The total number of cells on a board of radius $R$ is:
$$N(R) = 1 + 3R(R - 1)$$

| Radius $R$ | Total Cells | Gameplay analogue |
|---|---|---|
| $R = 2$ | **7 cells** | **The Hex Pocket (Solved Tablebase Domain)** |
| $R = 3$ | **19 cells** | Skirmish |
| $R = 4$ | **37 cells** | Compact Duel |
| $R = 5$ | **61 cells** | Intermediate Field |
| $R = 6$ | **91 cells** | **Standard (Closest analogue to 9×9 Standard's 81 cells)** |
| $R = 8$ | **169 cells** | Campaign |

### 1.1 Canonical Ordering
To guarantee deterministic serialization, hashing, and tablebase indexing, cells are ordered canonically by:
1. Increasing $r$ (row index), then
2. Increasing $q$ (column index).

### 1.2 180° Rotational Symmetry & Opponent Transformation
On a square board, 180° antipodal symmetry inverts rows and columns: $(r, c) \mapsto (N - 1 - r, N - 1 - c)$.
On a hexagonal board with origin at $(0, 0, 0)$, **180° rotation is exact cube coordinate negation**:
$$\operatorname{opposite}([q, r]) = [-q, -r] \iff (q, r, s) \mapsto (-q, -r, -s)$$
This maps Blue's deployment sector ($q \le -R + \text{depth}$) directly onto Red's deployment sector ($q \ge R - \text{depth}$) bijectively.

---

## 2. Movement Kinematics

On a hexagonal board, pieces interact along two distinct sets of axes:

```
          (0,-1)      (+1,-1)
             \         /
              \       /
   (-1,0) ───── (0,0) ───── (+1,0)   <-- 3 Edge Axes (Rook rays)
              /       \
             /         \
          (-1,+1)     (0,+1)
```

| Archetype | Destinations / Rays | Description |
|---|---|---|
| `cross` | 6 single steps | Steps to any of the 6 adjacent edge neighbours. |
| `rook` | 6 sliding rays | Slides continuously along the 3 lattice axes. |
| `bishop` | 6 sliding rays | Slides along the 6 vertex-diagonal rays: primitive cube vectors $(2, -1, -1), (1, 1, -2), (-1, 2, -1), (-2, 1, 1), (-1, -1, 2), (1, -2, 1)$. |
| `queen` | 12 sliding rays | The union of the 6 rook edge rays and 6 bishop diagonal rays. |
| `king` | 12 single steps | Steps to any of the 12 rook or bishop adjacent cells (6 edge + 6 diagonal). |
| `knight` | 12 leap cells | Jumps to any of the 12 permutations of $(1, 2, -3)$ and opposites. |
| `longking` | 12 steps + 6 leaps | King move (12), plus an exact 2-cell hop along the 6 rook rays. |
| `gold` | *Rejected* | Rejected by `validatePlayableCfg()` (§8.1) to preserve directional distinctness. |

### 2.1 Enclosure & Boundary Rules
- **Enclosure connectivity** uses strictly the 6 **edge neighbours**, not the 12 king destinations: vertex contact alone does not close a territory boundary.
- An enclosed region reaches the exterior when it contains any cell at cube distance $R - 1$.

---

## 3. The Radius-2 Hexagonal Solved Tablebase ("The 7-Cell Pocket")

### 3.1 Motivation & Parameters
On a radius-2 board ($R=2$), there are exactly **7 cells**:
- The origin: $(0, 0)$
- The 6 ring cells: $(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)$

Each player holds an exact Rock-Paper-Scissors triad:
- **Blue**: $\{R_B, P_B, S_B\}$
- **Red**: $\{R_R, P_R, S_R\}$
Total pieces on board: 6 pieces, occupying 6 of the 7 cells with exactly **1 empty hole** at full deal!

### 3.2 Combinatorial State Space
1. **Full Board ($M = 6$ pieces):**
   - 7 possible positions for the empty cell.
   - Permutations of the 6 distinct pieces across the remaining 6 cells: $6! = 720$.
   - Placements: $7 \times 720 = 5,040$.
   - Turn (Blue to move vs Red to move): $2 \times 5,040 = \mathbf{10,080\text{ directed states}}$.
2. **Subsequent Material Layers ($M < 6$):**
   - Layer $M=5$: $\binom{7}{5} \times \dots = 21 \times 360 \times 2 = 15,120$ states.
   - Layer $M=4$: $\binom{7}{4} \times \dots = 35 \times 180 \times 2 = 12,600$ states.
   - Layer $M \le 3$: Terminal deadlock sinks or trivial chases.
   - **Total state space for all layers:** $\approx 42,000$ states.

### 3.3 Retrograde Solution & Performance
Because the state space is under 50,000 states, retrograde analysis runs in under **200 milliseconds** in JavaScript/Node.js.
The resulting binary tablebase file (`hex-radius2-turn0.tb` and `hex-radius2-turn1.tb`) packs to under **25 KB** on disk, allowing zero-latency client-side lookup in the browser and serving as the perfect-play bot opponent for the Hex variant.
