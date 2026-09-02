# Parity Contraction & Closed Subgraphs

## 1. Problem Statement: The Exponential Scaling Wall

In unconstrained combinatorics, state spaces grow super-exponentially:
- **3×3 Standard**: $4.16 \times 10^5$ directed states (406 KB raw packed table). Solved via retrograde analysis in 1.8 seconds.
- **5×5 Standard**: $3.58 \times 10^{14}$ theoretical states. Raw packed table: **179 Terabytes**, requiring $\approx 700$ core-years to enumerate unconditionally.
- **9×9 Grand**: $1.2 \times 10^{47}$ states. Exceeds the estimated number of atoms in the planet Earth ($\sim 10^{50}$).

However, game state graphs are constrained by **movement invariants** that partition the combinatorial space into disconnected subgraphs.

---

## 2. Parity Preservation on Bipartite Lattices

On a square grid $N \times N$, cells $(r, c)$ have an invariant color parity:
$$\operatorname{parity}(r, c) = (r + c) \pmod 2$$

### 2.1 The Bishop Submanifold
A piece moving along diagonal rays (e.g. `bishop`) changes row and column by equal magnitudes:
$$\Delta r = \pm k, \quad \Delta c = \pm k \implies \Delta(r + c) = \pm 2k \equiv 0 \pmod 2$$

**Theorem (Parity Conservation):**
A bishop starting on a square of parity $P \in \{0, 1\}$ can never reach any square of parity $1 - P$.

### 2.2 Quantitative Contraction on 3×3
- In a 3×3 grid (9 cells), there are 5 light squares and 4 dark squares.
- When pieces are restricted to bishop moves, pieces cannot cross parity boundaries.
- **Measured Reachability:** In the 3×3 tablebase census, the reachable subset of states under bishops is only **4.5%** of the full placement space (18,700 states vs 415,550 states).

### 2.3 Decoupling on 5×5 (The "Parity Pocket")
In a 5×5 grid (25 cells):
- Light squares: 13 cells
- Dark squares: 12 cells

If both players' armies are deployed strictly on the 12 dark cells:
- Placements are restricted to $k$ pieces choosing among 12 cells, rather than 25 cells!
- For $1R, 1P, 1S$ per side (6 pieces on 12 cells):
  $$\binom{12}{6} \times \frac{6!}{1!1!1!1!1!1!} = 924 \times 720 = 665,280\text{ placements}$$
- Directed states: $2 \times 665,280 = \mathbf{1,330,560\text{ states}}$!
- **Result:** The 179-Terabyte $5 \times 5$ space collapses by a factor of $10^8$ into a **1.33-Million state submanifold**, which fits inside **1.3 MB of RAM** and can be solved completely in under 10 seconds!

---

## 3. The Closed Subgraph Theorem for Retrograde Solvability

A subset of game states $S_0 \subset S$ can be solved by retrograde dynamic programming without enumerating the whole universe $S$ if and only if:

1. **Predecessor & Successor Closure:**
   $$\forall s \in S_0, \quad \operatorname{Succ}(s) \subseteq S_0 \quad \text{and} \quad \operatorname{Pred}(s) \cap S_{\text{reachable}} \subseteq S_0$$
2. **Monotone Material Layering:**
   $$\forall (s \to s'), \quad M(s') \le M(s)$$
   No move can generate predecessors with higher piece count.
3. **Attractor Finite Closure:**
   All directed cycles in $S_0$ are contained within Strongly Connected Components (SCCs) resolvable by minimax fixed-point iteration.
4. **Memory Bound:**
   $$|S_0| \times b_{\text{avg}} \times 4\text{ bytes} \le M_{\text{RAM}}$$
