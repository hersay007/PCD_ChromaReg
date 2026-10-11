#!/usr/bin/env python3
"""
ChromaReg CLI: Command-Line Register Allocation & Compiler Optimization Engine.
Usage:
    python3 compiler_core/cli.py [file.ir] [options]
"""

import sys
import os
import argparse
from typing import List

# Ensure package import works
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from compiler_core.ir_parser import parse_ir
from compiler_core.liveness import compute_liveness
from compiler_core.interference import build_interference_graph
from compiler_core.allocator import RegisterAllocator
from compiler_core.codegen import CodeGenerator

# ANSI Terminal Styling
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

def print_banner():
    print(f"{CYAN}{BOLD}")
    print("=" * 72)
    print("  ChromaReg-Studio : Graph Coloring Register Allocator & Optimizer")
    print("  Course: Principles of Compiler Design (PCD) | Chaitin-Briggs Engine")
    print("=" * 72)
    print(f"{RESET}")

def main():
    parser = argparse.ArgumentParser(description="ChromaReg Graph Coloring Register Allocation CLI")
    parser.add_argument("file", nargs="?", default="test_programs/01_simple_pipeline.ir", help="Path to 3AC IR file")
    parser.add_argument("-k", "--registers", type=int, default=3, help="Number of physical registers (default: 3)")
    parser.add_argument("--algo", choices=["briggs", "chaitin", "greedy"], default="briggs", help="Coloring algorithm (default: briggs)")
    parser.add_argument("--target", choices=["riscv", "x86"], default="riscv", help="Target architecture (default: riscv)")
    parser.add_argument("--no-coalesce", action="store_true", help="Disable conservative copy coalescing")
    parser.add_argument("--dot", type=str, default=None, help="Save interference graph to DOT file")
    args = parser.parse_args()

    print_banner()

    if not os.path.exists(args.file):
        print(f"{RED}Error: File not found: {args.file}{RESET}")
        sys.exit(1)

    with open(args.file, "r") as f:
        ir_text = f.read()

    print(f"{BOLD}[1] Loading Intermediate Representation:{RESET} {args.file}")
    instructions = parse_ir(ir_text)
    print(f"Parsed {len(instructions)} TAC instructions.\n")

    # Step 2: Liveness Analysis
    print(f"{BOLD}[2] Running Iterative Backward Liveness Analysis...{RESET}")
    instructions, history = compute_liveness(instructions)
    print(f"Dataflow fixed-point reached in {len(history)} iterations.")
    print("-" * 72)
    print(f"{'Idx':<4} {'Instruction':<24} {'Defs':<10} {'Uses':<10} {'Live-Out':<20}")
    print("-" * 72)
    for inst in instructions:
        defs_str = ", ".join(sorted(inst.defs)) or "∅"
        uses_str = ", ".join(sorted(inst.uses)) or "∅"
        out_str = ", ".join(sorted(inst.live_out)) or "∅"
        print(f"{inst.index:<4} {inst.raw:<24} {defs_str:<10} {uses_str:<10} {out_str:<20}")
    print("-" * 72 + "\n")

    # Step 3: Interference Graph Construction
    print(f"{BOLD}[3] Constructing Register Interference Graph (RIG)...{RESET}")
    ig = build_interference_graph(instructions)
    max_clique = ig.get_max_clique_size()
    print(f"Nodes (Variables): {len(ig.nodes)} | Edges (Interferences): {sum(len(v) for v in ig.adj.values()) // 2}")
    print(f"Lower bound chromatic number (Max Clique omega(G)): {YELLOW}{max_clique}{RESET}")
    print(f"Physical register limit K: {CYAN}{args.registers}{RESET}")

    print("\nVariable Degree & Spill Cost Table:")
    print(f"{'Variable':<12} {'Degree':<8} {'Defs':<6} {'Uses':<6} {'Max Loop Depth':<16} {'Spill Cost':<10}")
    print("-" * 64)
    for v in sorted(ig.nodes):
        st = ig.var_stats[v]
        cost = ig.spill_costs[v]
        deg = ig.degree(v)
        color_indicator = f"{RED}>= K{RESET}" if deg >= args.registers else f"{GREEN}< K{RESET}"
        print(f"{v:<12} {deg} ({color_indicator}){'':<2} {st['defs']:<6} {st['uses']:<6} {st['max_loop_depth']:<16} {cost:<10}")
    print("-" * 64 + "\n")

    # Step 4: Register Allocation
    print(f"{BOLD}[4] Executing Register Allocation (Algorithm: {args.algo.upper()})...{RESET}")
    allocator = RegisterAllocator(k=args.registers, algorithm=args.algo, enable_coalescing=not args.no_coalesce)
    result = allocator.allocate(ig)

    print("\nSimplification / Color Decisions Trace:")
    for step in result.steps_log:
        if "SPILL" in step:
            print(f"  {RED}• {step}{RESET}")
        elif "SUCCESS" in step or "COALESCE" in step:
            print(f"  {GREEN}• {step}{RESET}")
        else:
            print(f"  {DIM}• {step}{RESET}")

    print("\n" + "=" * 48)
    print(f"{BOLD}Final Allocation Mapping:{RESET}")
    print("=" * 48)
    for var, reg in sorted(result.allocation.items()):
        if reg.startswith('R'):
            print(f"  Variable {var:<10}  -->  {GREEN}{BOLD}{reg}{RESET} (Physical Register)")
        else:
            print(f"  Variable {var:<10}  -->  {RED}{BOLD}{reg}{RESET} (Spilled to Stack Memory)")

    print(f"\nSummary:")
    print(f"  Status: {'SUCCESS (Zero Spills)' if result.success else 'SPILL DETECTED'}")
    print(f"  Physical Registers Used: {result.num_registers_used} / {args.registers}")
    print(f"  Variables Spilled to RAM: {result.num_spills}")

    # Step 5: Code Generation
    print(f"\n{BOLD}[5] Emitting Target Machine Code ({args.target.upper()})...{RESET}")
    codegen = CodeGenerator(target=args.target)
    assembly, metrics = codegen.emit(instructions, result)

    print("-" * 72)
    print(assembly)
    print("-" * 72)
    print(f"Memory Overhead Metrics: Loads={metrics['loads']}, Stores={metrics['stores']}, Est Penalty={metrics['cycle_penalty']} cycles.\n")

    # DOT export if requested
    if args.dot:
        dot_str = ig.to_dot(colors=result.allocation)
        with open(args.dot, "w") as f:
            f.write(dot_str)
        print(f"{GREEN}Exported RIG to DOT file: {args.dot}{RESET}")

if __name__ == "__main__":
    main()
