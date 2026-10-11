"""
Register Allocator implementing:
1. Chaitin's Graph Coloring Heuristic (Pessimistic)
2. Briggs Optimistic Graph Coloring Heuristic
3. Conservative Coalescing (Briggs & George criteria)
4. Spill Code Manager with Stack Offsets
"""

from typing import Dict, List, Set, Tuple, Optional
from dataclasses import dataclass, field
from compiler_core.interference import InterferenceGraph

@dataclass
class AllocationResult:
    success: bool
    k: int
    algorithm: str
    allocation: Dict[str, str]           # var -> 'R0', 'R1', ... or 'S0', 'S1' (Spill)
    spilled_nodes: List[str]
    coalesced_nodes: Dict[str, str]      # var -> merged_target
    simplification_stack: List[Tuple[str, int, str]] # (node, degree_at_push, reason)
    steps_log: List[str]
    spill_costs: Dict[str, float]
    num_spills: int
    num_registers_used: int

class RegisterAllocator:
    def __init__(self, k: int = 4, algorithm: str = 'briggs', enable_coalescing: bool = True):
        self.k = k
        self.algorithm = algorithm.lower() # 'briggs', 'chaitin', 'greedy'
        self.enable_coalescing = enable_coalescing

    def allocate(self, original_ig: InterferenceGraph) -> AllocationResult:
        if self.algorithm == 'greedy':
            return self._allocate_greedy(original_ig)

        ig = original_ig.clone()
        steps_log: List[str] = []
        coalesced: Dict[str, str] = {}
        simplification_stack: List[Tuple[str, int, str]] = []
        spilled_nodes: List[str] = []

        steps_log.append(f"Starting Register Allocation with K={self.k} registers using {self.algorithm.upper()} algorithm.")
        steps_log.append(f"Initial interference graph: {len(ig.nodes)} nodes, max degree={max([ig.degree(n) for n in ig.nodes], default=0)}")

        # Step 1: Coalescing (if enabled)
        if self.enable_coalescing and ig.copy_pairs:
            steps_log.append("--- Stage: Conservative Coalescing (Briggs Criterion) ---")
            ig, coalesced = self._coalesce(ig, steps_log)

        # Step 2: Simplification & Spill Selection Loop
        working_graph = ig.clone()
        optimistic_spill_candidates = set()

        while working_graph.nodes:
            # Look for degree < K (Trivially colorable nodes)
            low_degree_nodes = [n for n in working_graph.nodes if working_graph.degree(n) < self.k]

            if low_degree_nodes:
                # Pick node with lowest degree or arbitrary
                chosen = min(low_degree_nodes, key=lambda n: working_graph.degree(n))
                deg = working_graph.degree(chosen)
                simplification_stack.append((chosen, deg, "SIMPLIFY"))
                steps_log.append(f"SIMPLIFY: Node '{chosen}' (degree={deg} < K={self.k}) pushed to stack and removed.")
                # Remove node from working graph
                self._remove_node_from_graph(working_graph, chosen)
            else:
                # Degree >= K for all remaining nodes!
                # Choose spill candidate with MINIMUM spill cost
                candidate = min(working_graph.nodes, key=lambda n: ig.spill_costs.get(n, 1.0))
                deg = working_graph.degree(candidate)
                cost = ig.spill_costs.get(candidate, 1.0)

                if self.algorithm == 'chaitin':
                    # Pessimistic: Declare spill immediately
                    spilled_nodes.append(candidate)
                    steps_log.append(f"CHAITIN SPILL: Node '{candidate}' (degree={deg} >= K={self.k}, cost={cost}) marked as SPILL to memory.")
                    self._remove_node_from_graph(working_graph, candidate)
                else:
                    # Briggs Optimistic: Push to stack anyway, hoping neighbors share colors!
                    optimistic_spill_candidates.add(candidate)
                    simplification_stack.append((candidate, deg, "OPTIMISTIC_SPILL"))
                    steps_log.append(f"BRIGGS OPTIMISTIC: Node '{candidate}' (degree={deg} >= K={self.k}, cost={cost}) pushed to stack optimistically.")
                    self._remove_node_from_graph(working_graph, candidate)

        # Step 3: Selection / Color Assignment (Popping from stack)
        steps_log.append("--- Stage: Color Selection (Reconstruction) ---")
        colors: Dict[str, str] = {}
        spill_slot_counter = 0

        # Pre-assign stack slots to Chaitin spills
        for spilled in spilled_nodes:
            colors[spilled] = f"S{spill_slot_counter}"
            spill_slot_counter += 1

        while simplification_stack:
            node, old_deg, reason = simplification_stack.pop()
            # Find colors used by already-colored neighbors in the ORIGINAL graph (ig)
            used_colors = set()
            for nbr in ig.adj.get(node, set()):
                if nbr in colors and colors[nbr].startswith('R'):
                    used_colors.add(colors[nbr])

            # Find lowest available physical register color R0, R1, ... R_{k-1}
            assigned_color = None
            for r_idx in range(self.k):
                reg_name = f"R{r_idx}"
                if reg_name not in used_colors:
                    assigned_color = reg_name
                    break

            if assigned_color is not None:
                colors[node] = assigned_color
                if reason == "OPTIMISTIC_SPILL":
                    steps_log.append(f"OPTIMISTIC SUCCESS: Candidate '{node}' successfully received color {assigned_color}!")
                else:
                    steps_log.append(f"ASSIGN: Node '{node}' assigned physical register {assigned_color}.")
            else:
                # Could not color: must spill
                colors[node] = f"S{spill_slot_counter}"
                spilled_nodes.append(node)
                steps_log.append(f"ACTUAL SPILL: Candidate '{node}' could not find free register among {self.k} registers. Allocated stack slot S{spill_slot_counter}.")
                spill_slot_counter += 1

        # Propagate colors to coalesced alias nodes
        for alias, primary in coalesced.items():
            colors[alias] = colors.get(primary, "S0")
            steps_log.append(f"COALESCED ALIAS: '{alias}' adopts color {colors[alias]} from primary '{primary}'.")

        # Count registers
        unique_regs = set(c for c in colors.values() if c.startswith('R'))

        return AllocationResult(
            success=(len(spilled_nodes) == 0),
            k=self.k,
            algorithm=self.algorithm,
            allocation=colors,
            spilled_nodes=spilled_nodes,
            coalesced_nodes=coalesced,
            simplification_stack=simplification_stack,
            steps_log=steps_log,
            spill_costs=original_ig.spill_costs,
            num_spills=len(spilled_nodes),
            num_registers_used=len(unique_regs)
        )

    def _remove_node_from_graph(self, g: InterferenceGraph, node: str):
        if node in g.nodes:
            g.nodes.remove(node)
            for nbr in list(g.adj.get(node, set())):
                g.adj[nbr].discard(node)
            g.adj.pop(node, None)

    def _coalesce(self, ig: InterferenceGraph, steps_log: List[str]) -> Tuple[InterferenceGraph, Dict[str, str]]:
        """
        Applies Briggs conservative coalescing:
        Nodes u and v can be coalesced if the merged node uv has fewer than K neighbors of degree >= K.
        """
        coalesced: Dict[str, str] = {}
        pairs = list(ig.copy_pairs)

        for u, v in pairs:
            # Ensure both exist and don't already interfere
            if u not in ig.nodes or v not in ig.nodes:
                continue
            if v in ig.adj.get(u, set()):
                # Interfere, cannot coalesce
                continue

            # Check Briggs Criterion:
            combined_neighbors = (ig.adj[u] | ig.adj[v]) - {u, v}
            high_degree_neighbors = sum(1 for nbr in combined_neighbors if ig.degree(nbr) >= self.k)

            if high_degree_neighbors < self.k:
                # Safe to coalesce v into u
                steps_log.append(f"COALESCE: Merged '{v}' into '{u}' (Briggs condition satisfied: {high_degree_neighbors} high-degree neighbors < K={self.k}).")
                coalesced[v] = u

                # Merge edges into u
                for nbr in ig.adj[v]:
                    if nbr != u:
                        ig.adj[u].add(nbr)
                        ig.adj[nbr].add(u)
                        ig.adj[nbr].discard(v)

                # Remove v from graph
                ig.nodes.discard(v)
                ig.adj.pop(v, None)

        return ig, coalesced

    def _allocate_greedy(self, ig: InterferenceGraph) -> AllocationResult:
        """Simple greedy first-fit coloring for baseline comparison."""
        colors: Dict[str, str] = {}
        spilled: List[str] = []
        steps_log: List[str] = ["Running Greedy First-Fit register allocation..."]
        spill_slot = 0

        # Sort nodes by degree descending (Welsh-Powell)
        sorted_nodes = sorted(ig.nodes, key=lambda n: ig.degree(n), reverse=True)

        for node in sorted_nodes:
            nbr_colors = set(colors[nbr] for nbr in ig.adj.get(node, set()) if nbr in colors and colors[nbr].startswith('R'))
            assigned = None
            for r_idx in range(self.k):
                r_name = f"R{r_idx}"
                if r_name not in nbr_colors:
                    assigned = r_name
                    break

            if assigned:
                colors[node] = assigned
                steps_log.append(f"GREEDY ASSIGN: Node '{node}' assigned {assigned}.")
            else:
                colors[node] = f"S{spill_slot}"
                spilled.append(node)
                steps_log.append(f"GREEDY SPILL: Node '{node}' spilled to S{spill_slot}.")
                spill_slot += 1

        unique_regs = set(c for c in colors.values() if c.startswith('R'))
        return AllocationResult(
            success=(len(spilled) == 0),
            k=self.k,
            algorithm='greedy',
            allocation=colors,
            spilled_nodes=spilled,
            coalesced_nodes={},
            simplification_stack=[],
            steps_log=steps_log,
            spill_costs=ig.spill_costs,
            num_spills=len(spilled),
            num_registers_used=len(unique_regs)
        )
