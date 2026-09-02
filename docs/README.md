# JANKEN Technical & Mathematical Documentation

This directory contains in-depth theoretical specifications, mathematical analyses, and architectural references for JANKEN (RPS-Chess), extending the top-level [`SPEC.md`](../SPEC.md).

## Index of Topics

| Document | Topic | Key Concepts |
|---|---|---|
| [`HEX_LATTICE.md`](./HEX_LATTICE.md) | Hexagonal Lattice & Solved Hex Tablebase | Axial $(q, r, s)$ geometry, 6 edge rays, 6 diagonal rays, 12-neighbor kings, 7-cell Radius-2 solved tablebase. |
| [`PARITY_SUBSPACES.md`](./PARITY_SUBSPACES.md) | Parity Contraction & Closed Subgraphs | Diagonal movement parity preservation, $5 \times 5$ color complexes, Closed Subgraph Theorem for retrograde solvability. |
| [`LYAPUNOV_POTENTIALS.md`](./LYAPUNOV_POTENTIALS.md) | Monotonic Energy Potentials ($\Phi$) | Dissipative state dynamics, transitive tournaments, territory/paint exhaustion, finite termination proofs. |
| [`ODD_TOURNAMENTS.md`](./ODD_TOURNAMENTS.md) | Odd Regular Tournaments ($\mathbb{Z}/(2k+1)\mathbb{Z}$) | Kendall–Babington Smith formula, directed 3-cycle scaling ($C_3 \sim \mathcal{O}(k^3)$), RPSLS, and higher-order attractor basins. |
| [`REACHABILITY_FRONTIER.md`](./REACHABILITY_FRONTIER.md) | Forward Reachability & Contact Dynamics | Azel's Wall census, the contact capture step function, attractor loop explosion, and pruning of theoretical space. |
| [`JPGN.md`](./JPGN.md) | Janken Portable Game Notation | Standardized recording format for JANKEN matches, moves, and variant metadata. |
