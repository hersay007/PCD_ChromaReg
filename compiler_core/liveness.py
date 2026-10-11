"""
Liveness Analysis Module for 3-Address Code (TAC).
Computes Control Flow Graph (CFG) edges and executes iterative backward dataflow analysis:
In[n]  = Use[n] U (Out[n] - Def[n])
Out[n] = U_{s in Succ[n]} In[s]
"""

from typing import List, Dict, Set, Tuple
from compiler_core.ir_parser import Instruction

def build_cfg(instructions: List[Instruction]) -> Dict[int, List[int]]:
    """
    Builds successor adjacency list: instr_index -> [succ_indices]
    """
    succ: Dict[int, List[int]] = {i: [] for i in range(len(instructions))}
    label_to_index: Dict[str, int] = {}

    for i, inst in enumerate(instructions):
        if inst.op == 'LABEL' and inst.target_label:
            label_to_index[inst.target_label] = i

    for i, inst in enumerate(instructions):
        if inst.op == 'RETURN':
            # End of flow
            pass
        elif inst.op == 'GOTO':
            if inst.target_label in label_to_index:
                succ[i].append(label_to_index[inst.target_label])
        elif inst.op == 'IF_GOTO':
            # Branch taken
            if inst.target_label in label_to_index:
                succ[i].append(label_to_index[inst.target_label])
            # Fallthrough
            if i + 1 < len(instructions):
                succ[i].append(i + 1)
        else:
            # Fallthrough
            if i + 1 < len(instructions):
                succ[i].append(i + 1)

    return succ

def compute_liveness(instructions: List[Instruction]) -> Tuple[List[Instruction], List[Dict[str, any]]]:
    """
    Runs iterative backward fixed-point dataflow analysis.
    Returns the mutated instructions with live_in/live_out sets,
    and a history of iterations for visualization/educational demonstration.
    """
    succ = build_cfg(instructions)
    n = len(instructions)

    # Initialize sets
    for inst in instructions:
        inst.live_in = set()
        inst.live_out = set()

    iteration_history = []
    changed = True
    iteration = 0

    while changed:
        iteration += 1
        changed = False
        iteration_snapshot = []

        # Backward traversal (from n-1 down to 0)
        for i in reversed(range(n)):
            inst = instructions[i]

            # Out[n] = Union_{s in Succ[n]} In[s]
            new_out: Set[str] = set()
            for s in succ[i]:
                new_out.update(instructions[s].live_in)

            # In[n] = Use[n] U (Out[n] - Def[n])
            new_in: Set[str] = set(inst.uses).union(new_out.difference(inst.defs))

            if new_in != inst.live_in or new_out != inst.live_out:
                changed = True
                inst.live_in = new_in
                inst.live_out = new_out

            iteration_snapshot.append({
                'index': i,
                'in': sorted(list(inst.live_in)),
                'out': sorted(list(inst.live_out))
            })

        iteration_history.append({
            'iteration': iteration,
            'snapshots': iteration_snapshot
        })

    return instructions, iteration_history

def get_live_ranges(instructions: List[Instruction]) -> Dict[str, Tuple[int, int]]:
    """
    Returns {var_name: (start_index, end_index)}
    """
    ranges: Dict[str, Tuple[int, int]] = {}
    for inst in instructions:
        # Check defs
        for d in inst.defs:
            if d not in ranges:
                ranges[d] = (inst.index, inst.index)
            else:
                ranges[d] = (min(ranges[d][0], inst.index), max(ranges[d][1], inst.index))

        # Check uses
        for u in inst.uses:
            if u not in ranges:
                ranges[u] = (inst.index, inst.index)
            else:
                ranges[u] = (min(ranges[u][0], inst.index), max(ranges[u][1], inst.index))

        # Check live_out
        for v in inst.live_out:
            if v not in ranges:
                ranges[v] = (inst.index, inst.index)
            else:
                ranges[v] = (min(ranges[v][0], inst.index), max(ranges[v][1], inst.index))

    return ranges
