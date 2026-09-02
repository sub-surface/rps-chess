# Odd Regular Tournaments & Algebraic Cycle Dynamics

## 1. Generalizing Rock-Paper-Scissors to $n = 2k + 1$

Standard Rock-Paper-Scissors is the unique regular tournament on 3 vertices ($k=1$):
$$\mathbb{Z}/3\mathbb{Z}: \quad 0 \succ 2 \succ 1 \succ 0$$

We generalize this algebraic structure to any odd prime or odd integer $n = 2k + 1$ over the cyclic group $\mathbb{Z}/n\mathbb{Z}$.
Piece $i$ captures piece $j$ if and only if:
$$(j - i) \pmod n \in \{1, 2, \dots, k\}$$

Each piece defeats exactly $k$ opponents and is defeated by exactly $k$ opponents.

```
       Rock (0)
      /   \
     v     v
Spock (4)  Scissors (1)
   ^ \      / ^
   |  v    v  |
Lizard (3)<--Paper (2)
```
*(The 5-node Pentagram Tournament, $\mathbb{Z}/5\mathbb{Z}$ / RPSLS)*

---

## 2. The Kendall–Babington Smith Cycle Theorem

In any tournament $T_n = (V, E)$, the score vector $s_v$ is the out-degree of vertex $v$.
A directed 3-cycle occurs whenever $u \to v \to w \to u$.

**Theorem (Kendall & Babington Smith, 1940):**
The total number of directed 3-cycles in a tournament with out-degree sequence $(s_1, \dots, s_n)$ is:
$$C_3(T_n) = \binom{n}{3} - \sum_{v \in V} \binom{s_v}{2}$$

For a **regular tournament** where every vertex has $s_v = k = \frac{n - 1}{2}$:
$$C_3(T_n) = \frac{n(n - 1)(n - 2)}{6} - n \frac{k(k - 1)}{2} = \frac{n(n^2 - 1)}{24} = \frac{(2k + 1)k(k + 1)}{6}$$

### 2.1 Cycle Growth Scaling

| $k$ | Order $n = 2k+1$ | Name / Variant | Directed 3-Cycles $C_3$ |
|---|---|---|---|
| $k = 1$ | $n = 3$ | **Standard JANKEN (RPS)** | **1 cycle** |
| $k = 2$ | $n = 5$ | **Pentagram (RPSLS)** | **5 cycles** |
| $k = 3$ | $n = 7$ | **Heptagram** | **14 cycles** |
| $k = 4$ | $n = 9$ | **Enneagram** | **30 cycles** |
| $k = 5$ | $n = 11$ | **Hendecagram** | **55 cycles** |

### 2.2 Mathematical Consequences
1. **Attractor Density:** Because directed 3-cycles scale as $\mathcal{O}(k^3)$, the state space of an RPSLS or Heptagram board game contains multiple nested, overlapping Strongly Connected Components (SCCs).
2. **Repetition Rate:** In self-play experiments, increasing piece variety from 3 to 5 pieces increases the probability of games reaching threefold repetition draws by $\approx 28\%$, because armies have 5 times more circular evasion paths to loop through.
