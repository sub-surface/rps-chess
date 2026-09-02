# Lyapunov Potential Energy & Finite Termination Proofs

## 1. Conservative vs Non-Conservative Tournaments

In classical chess, material valuation is linear and scalar:
$$\text{Queen} \approx 9, \quad \text{Rook} \approx 5, \quad \text{Bishop} \approx 3, \quad \text{Knight} \approx 3, \quad \text{Pawn} \approx 1$$

In JANKEN, piece interaction is governed by a **tournament digraph $T = (V, E)$** where vertices represent piece types and directed edges represent capture dominance.

### 1.1 Cyclic Tournaments ($\mathbb{Z}/3\mathbb{Z}$)
Under standard cyclic rules:
$$R \succ S \succ P \succ R$$
The tournament contains a closed directed 3-cycle:
$$\oint_{C_3} d\mathbf{w} \neq 0$$
Because the work done over a closed loop is non-zero, **no scalar potential function $\Phi: V \to \mathbb{R}$ exists**. This non-conservativeness gives rise to:
1. **Orbital Attractors:** Cyclic pursuit loops where pieces chase each other along board perimeters indefinitely.
2. **Non-trivial SCCs:** Strongly Connected Components in the game state graph.
3. **Necessity of 3-Fold Repetition:** An extrinsic rule is mathematically required to terminate games that enter non-trivial SCCs.

---

## 2. Monotonic Lyapunov Potentials for Non-Cyclic Presets

When the capture tournament is acyclic or non-cyclic, we can construct a **Lyapunov Potential Function** $\Phi: S \to \mathbb{R}^+$ that strictly decreases along transitions, proving finite termination without needing repetition rules.

### 2.1 The Transitive Tournament
Consider the transitive hierarchy:
$$R \succ P \succ S \quad \text{and} \quad R \succ S$$

Assign weights:
$$w(R) = 3, \quad w(P) = 2, \quad w(S) = 1$$

Define the game potential $\Phi(s)$ for position $s$:
$$\Phi(s) = \sum_{p \in \operatorname{alive}(s)} w(\operatorname{type}(p))$$

#### Capture Transition:
When piece $A$ captures piece $B$:
$$\Phi(s') = \Phi(s) - w(B)$$
Since $w(B) \ge 1$:
$$\Phi(s') \le \Phi(s) - 1$$
Every capture strictly decreases $\Phi(s)$.

#### Non-Capture Advancement:
For moves that advance pieces across the board, we define the spatial displacement potential:
$$\Psi(s) = \sum_{p \in \text{Blue}} (N - 1 - c_p) + \sum_{p \in \text{Red}} c_p$$
This ensures $\Delta \Psi < 0$ on forward advancement.

**Termination Bound:**
Since $\Phi(s) \le 3 \times (\text{total pieces})$ and is bounded below by 0, the maximum number of capture moves in any game is strictly bounded:
$$\text{Max Captures} \le 2 \times (\text{army size})$$
The entire state space graph is a **strict Directed Acyclic Graph (DAG)** with zero cycles.

---

## 3. Territory & Paint Monotonicity (`territory=true`)

When territory claiming is enabled and paint is non-retreadable, the remaining unpainted cells $U(s)$ serves as an exact step-down Lyapunov counter:
$$U(s) = N^2 - |\operatorname{Painted}(s)|$$

On every action:
$$U(s') = U(s) - 1$$
This bounds the total possible duration of any game to:
$$\text{Max Plies} \le N^2$$
Terminating cleanly by majority enclosure or exhaustion without ever risking an infinite loop.
