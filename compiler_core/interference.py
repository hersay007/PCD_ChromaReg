"""
Register Interference Graph (RIG) Module.
Builds the interference graph from liveness sets and instruction definitions.
Includes spill cost heuristic estimation and copy-edge tracking for coalescing.
"""

from typing import List, Dict, Set, Tuple
from compiler_core.ir_parser import Instruction

class InterferenceGraph:
    def __init__(self):
        self.nodes: Set[str] = set()
        self.adj: Dict[str, Set[str]] = {}
        self.copy_pairs: Set[Tuple[str, str]] = set()
        self.spill_costs: Dict[str, float] = {}
        self.var_stats: Dict[str, Dict[str, int]] = {}

    def add_node(self, v: str):
        if v not in self.nodes:
            self.nodes.add(v)
            self.adj[v] = set()
            self.spill_costs[v] = 1.0
            self.var_stats[v] = {'defs': 0, 'uses': 0, 'max_loop_depth': 0}

    def add_edge(self, u: str, v: str):
        if u != v:
            self.add_node(u)
            self.add_node(v)
            self.adj[u].add(v)
            self.adj[v].add(u)

    def degree(self, v: str) -> int:
        return len(self.adj.get(v, set()))

    def clone(self) -> 'InterferenceGraph':
        ig = InterferenceGraph()
        ig.nodes = set(self.nodes)
        ig.adj = {n: set(nbrs) for n, nbrs in self.adj.items()}
        ig.copy_pairs = set(self.copy_pairs)
        ig.spill_costs = dict(self.spill_costs)
        ig.var_stats = {n: dict(stats) for n, stats in self.var_stats.items()}
        return ig

    def get_max_clique_size(self) -> int:
        """
        Greedy clique approximation for lower bound on chromatic number chi(G) >= omega(G).
        """
        if not self.nodes:
            return 0
        nodes_sorted = sorted(self.nodes, key=lambda n: self.degree(n), reverse=True)
        max_clique: List[str] = []
        for node in nodes_sorted:
            # Check if adjacent to all nodes in current candidate clique
            if all(node in self.adj[c] for c in max_clique):
                max_clique.append(node)
        return len(max_clique)

    def to_dot(self, colors: Dict[str, str] = None) -> str:
        """Generates Graphviz DOT representation for compiler visualization."""
        lines = ["graph RIG {", "  node [shape=circle, fontname=\"Helvetica\", style=filled, penwidth=2];"]
        palette = [
            "#38bdf8", "#4ade80", "#f87171", "#fbbf24",
            "#c084fc", "#fb923c", "#f43f5e", "#2dd4bf"
        ]

        for node in sorted(self.nodes):
            color_str = "#334155" # default slate
            text_color = "white"
            label = f"{node}"
            if colors and node in colors:
                c = colors[node]
                if c.startswith('R'):
                    idx = int(c[1:]) if c[1:].isdigit() else 0
                    color_str = palette[idx % len(palette)]
                    label = f"{node}\\n({c})"
                elif c.startswith('S'):
                    color_str = "#ef4444" # spilled red
                    label = f"{node}\\n(SPILL:{c})"

            lines.append(f"  \"{node}\" [fillcolor=\"{color_str}\", fontcolor=\"{text_color}\", label=\"{label}\"];")

        seen_edges = set()
        for u in self.adj:
            for v in self.adj[u]:
                edge_pair = tuple(sorted([u, v]))
                if edge_pair not in seen_edges:
                    seen_edges.add(edge_pair)
                    lines.append(f"  \"{edge_pair[0]}\" -- \"{edge_pair[1]}\";")

        lines.append("}")
        return "\n".join(lines)


def build_interference_graph(instructions: List[Instruction]) -> InterferenceGraph:
    """
    Builds the interference graph based on Chaitin's rule:
    For every instruction i:
      For every variable d in defs[i]:
        For every variable v in live_out[i]:
          If v != d and not (i is copy and v == src):
            Add edge (d, v)
    Also tracks def-use counts and loop depth for spill cost heuristics.
    """
    ig = InterferenceGraph()

    # Discover all variables
    for inst in instructions:
        for d in inst.defs:
            ig.add_node(d)
            ig.var_stats[d]['defs'] += 1
            ig.var_stats[d]['max_loop_depth'] = max(ig.var_stats[d]['max_loop_depth'], inst.loop_depth)
        for u in inst.uses:
            ig.add_node(u)
            ig.var_stats[u]['uses'] += 1
            ig.var_stats[u]['max_loop_depth'] = max(ig.var_stats[u]['max_loop_depth'], inst.loop_depth)

    # Build edges according to live ranges
    for inst in instructions:
        # Check copy instruction
        is_copy = inst.is_copy()
        copy_src = inst.src1 if is_copy else None

        if is_copy and inst.dest and copy_src and copy_src in ig.nodes:
            ig.copy_pairs.add(tuple(sorted([inst.dest, copy_src])))

        for d in inst.defs:
            for v in inst.live_out:
                if v != d:
                    # In copy d = s, do not interfere with s!
                    if is_copy and v == copy_src:
                        continue
                    ig.add_edge(d, v)

    # Compute spill cost using loop-depth weighted heuristic
    # Cost = (defs + uses * 10^depth) / degree
    for node in ig.nodes:
        stats = ig.var_stats[node]
        depth = stats['max_loop_depth']
        deg = max(1, ig.degree(node))
        weighted_accesses = (stats['defs'] + stats['uses']) * (10 ** depth)
        cost = weighted_accesses / float(deg)
        ig.spill_costs[node] = round(cost, 2)

    return ig
