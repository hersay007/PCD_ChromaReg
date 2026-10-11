# 🚀 ChromaReg-Studio: Walkthrough & Mac Execution Guide

> **Principles of Compiler Design (PCD) — 20-Mark Innovative Assignment**  
> **Topic:** Optimize Register Allocation Using Graph Coloring (Chaitin-Briggs Engine with Live-Range Analysis, Spill Cost Heuristics, Conservative Coalescing, and Target Machine Code Generation)

---

## 🌟 Why This Project is Unique & Innovative (For 20 Marks)

Standard practicals simply implement a naive graph coloring script that maps variables to numbers without compiler context.  
**ChromaReg-Studio** extends this into a **complete, industrial-grade compiler backend subsystem** that solves real engineering problems:

1. **Full Compiler Pipeline Integration**:
   - Takes raw **3-Address Code (TAC / Quadruples)** intermediate representation.
   - Constructs a **Control Flow Graph (CFG)** with conditional branches, loops, and labels.
   - Solves iterative backward dataflow equations to compute **Live-In** and **Live-Out** sets at each program point until fixed-point convergence.
2. **True Register Interference Graph (RIG) with Copy Optimization**:
   - Variables interfere only when their live ranges overlap simultaneously.
   - Implements Chaitin's special copy rule: in $d = s$, $d$ does **not** interfere with $s$, creating coalescing opportunities.
3. **Chaitin vs. Briggs Optimistic Coloring Engine**:
   - Demonstrates why Chaitin's classic pessimistic algorithm spills too early when all node degrees $\ge K$.
   - Implements **Briggs' Optimistic Heuristic** which pushes high-degree nodes onto the stack anyway; when popped, non-adjacent neighbors often share colors, achieving **0 spills** where Chaitin would fail!
4. **Loop-Depth Weighted Spill Cost Heuristics**:
   - Calculates memory spill penalties:  
     $$\text{SpillCost}(v) = \frac{(\text{defs}(v) + \text{uses}(v)) \times 10^{\text{loop\_depth}}}{\text{deg}(v)}$$
   - Prevents memory bus thrashing by ensuring variables inside hot loops stay in fast hardware registers while loop invariants spill to RAM.
5. **Briggs Conservative Coalescing**:
   - Automatically merges move instructions ($x = y$) without increasing the chromatic number of the graph.
6. **Real Dual-Target Machine Code Emission**:
   - Replaces virtual temporaries with actual hardware registers:
     - **RISC-V (RV32I)**: `t0, t1, t2, t3, a0`
     - **x86-64 Intel**: `rax, rcx, rdx, rsi, rdi`
   - Automatically generates stack frames, prologues, epilogues, and injects **Spill Reloads (`lw`/`mov`)** and **Spill Stores (`sw`/`mov`)** with 16-byte stack alignment.
7. **Interactive Visual Studio UI & Standalone Python CLI**:
   - Visual physics-based force-directed canvas with glowing neon register assignments.
   - Step-by-step playback slider with stack push/pop animations.
   - Liveness dataflow matrix and memory bus penalty metrics.

---

## 💻 How to Run on macOS

You can run the project in **two ways**:
- **Method A:** The Interactive Web Studio App (Visual, stunning UI).
- **Method B:** The Python Terminal CLI & Test Suite (Academic grading & batch benchmarks).

### Prerequisites
Both Python 3 and Node are pre-installed on your Mac. No external third-party pip libraries or npm packages are needed (zero dependencies).

---

### Method A: Launch the Interactive Web Studio App

Open your Terminal and run:

```bash
cd /Users/shreyabhatia/Desktop/PCD/assignment

# Option 1: Using Makefile
make web

# Option 2: Using Python directly
python3 -m http.server 8000
```

Now open your web browser (Safari, Chrome, or Arc) and go to:
👉 **`http://localhost:8000`**

#### How to Use the Web App:
1. **Choose a Benchmark:** In the top toolbar, pick from 6 curated scenarios (e.g. *1. Linear Pipeline*, *2. High-Pressure Loop*, *4. Briggs Optimistic Recovery*).
2. **Adjust Register Limit ($K$):** Slide $K$ from 2 to 8. Watch the graph colors and memory spills adapt in real time!
3. **Step-by-Step Playback:**
   - Click **`Step ▶`** to watch Kempe's simplification push nodes with degree $< K$ to the stack.
   - Click **`Play ⏯`** for automatic step-by-step animation.
   - Click **`Solve All ⚡`** to calculate the entire allocation instantly.
4. **Inspect Tabs (Right Panel):**
   - **Target Assembly:** View real emitted RISC-V or x86 assembly with color-coded spill instructions (`lw`/`sw`).
   - **Liveness Matrix:** See the Defs, Uses, and Live-Out dataflow sets instruction-by-instruction.
   - **Metrics & Proof:** Review the $\omega(G) \le \chi(G)$ Max-Clique lower bound and memory traffic impact.
   - **Coloring Stack:** Inspect the live simplification stack.
5. **Interactive Canvas:**
   - Click and drag any variable node to reposition it.
   - Hover over nodes to see their exact Degree, Spill Cost, and highlight interfering neighbors.
   - Use the mouse wheel to zoom in and out.

---

### Method B: Run the Python CLI & Automated Test Suite

If your professor prefers terminal output or wants to run unit tests:

#### 1. Run Unit Tests:
```bash
make test
# OR: python3 -m unittest discover -s compiler_core
```
*Expected output:* `Ran 5 tests in 0.001s ... OK`

#### 2. Run the Allocator on Any Intermediate Code File:
```bash
python3 compiler_core/cli.py test_programs/02_high_pressure_loop.ir -k 3 --algo briggs --target riscv
```

#### 3. CLI Command-Line Options:
| Flag | Description | Default |
|---|---|---|
| `-k <int>` | Number of physical hardware registers | `3` |
| `--algo <briggs\|chaitin\|greedy>` | Graph coloring heuristic | `briggs` |
| `--target <riscv\|x86>` | Target machine assembly architecture | `riscv` |
| `--no-coalesce` | Disables Briggs conservative copy coalescing | Enabled |
| `--dot <filename.dot>` | Exports the graph to Graphviz DOT format | None |

#### 4. Run Batch Benchmark Suite:
```bash
make benchmark
```

---

## 📁 Project Architecture & File Tour

```
assignment/
├── index.html                   # Interactive Web Studio frontend UI
├── styles.css                   # Dark-mode glassmorphic CSS design system
├── app.js                       # UI controller, events, and playback coordinator
├── Makefile                     # Quick commands: make web, make test, make benchmark
├── package.json                 # Project configuration
├── WALKTHROUGH.md               # This execution guide & viva preparation
├── PROJECT_REPORT.md            # Formal 20-mark academic submission report
│
├── src/                         # Frontend Browser Engine (ES Modules)
│   ├── parser.js                # 3-Address Code parser (TAC)
│   ├── liveness.js              # Backward dataflow liveness fixed-point engine
│   ├── interference.js          # RIG graph builder & clique calculator
│   ├── chaitin_briggs.js        # Graph coloring step-by-step trace generator
│   ├── codegen.js               # RISC-V RV32I & x86-64 machine code generator
│   ├── graph_renderer.js        # Canvas physics force-directed graph visualizer
│   └── presets.js               # 6 pre-loaded compiler stress tests
│
├── compiler_core/               # Pure Python Core (Command-line & Test Suite)
│   ├── ir_parser.py             # Python TAC parser & CFG builder
│   ├── liveness.py              # Backward fixed-point dataflow equations
│   ├── interference.py          # RIG builder with loop-depth spill cost
│   ├── allocator.py             # Chaitin & Briggs graph coloring algorithms
│   ├── codegen.py               # Target assembly emitter with spill slots
│   ├── cli.py                   # Pretty terminal CLI runner with ANSI colors
│   └── test_allocator.py        # Automated test suite
│
└── test_programs/               # Benchmark .ir programs
    ├── 01_simple_pipeline.ir    # Temporal register reuse
    ├── 02_high_pressure_loop.ir # Loop depth spill cost weighting
    ├── 03_chaitin_spill_test.ir # K+1 clique mandatory spill
    ├── 04_briggs_optimistic.ir  # Briggs optimistic coloring advantage
    └── 05_copy_coalescing.ir    # Redundant move elimination
```

---

## 🎯 Benchmark Cases & Educational Highlights

| Benchmark | Key Compiler Concept Demonstrated |
|---|---|
| **01 Simple Pipeline** | **Register Reuse:** 5 virtual temporaries are mapped into only 2 physical registers because their live ranges do not overlap in time. |
| **02 High-Pressure Loop** | **Loop-Depth Cost:** Variables inside the loop body (`sum`, `i`) receive $10\times$ higher spill cost weight, forcing read-only constants (`step`, `limit`, `factor`) to spill first. |
| **03 Chaitin Mandatory Spill** | **Clique Lower Bound:** Creates a 5-clique ($\omega(G)=5$). Under $K=3$, $\chi(G) > K$, proving mathematically that at least 2 variables must spill to stack memory. |
| **04 Briggs Optimistic** | **Optimistic Coloring:** Graph with degree $\ge K$ for all nodes where Chaitin spills unnecessarily, but Briggs' optimistic coloring succeeds with **0 spills**! |
| **05 Copy Coalescing** | **Copy Elimination:** Merges `base` and `ptr` without increasing graph chromaticity, removing redundant register move instructions. |

---

## 🎤 Viva & Oral Defense Q&A (20-Mark Preparation)

**Q1: Why is Register Allocation modeled as Graph Coloring?**  
*Answer:* Two variables cannot share the same hardware register if they are live at the same time (they interfere). If we represent variables as nodes and interferences as undirected edges, assigning $K$ physical registers is equivalent to finding a valid $K$-coloring of the graph where adjacent nodes have different colors.

**Q2: What is the computational complexity of Graph Coloring Register Allocation?**  
*Answer:* Finding the minimum chromatic number $\chi(G)$ or determining if an arbitrary graph is $K$-colorable for $K \ge 3$ is **NP-complete** (Karp, 1972). Therefore, compilers use heuristics such as **Chaitin-Briggs** or Linear Scan.

**Q3: What is the key difference between Chaitin's heuristic and Briggs' heuristic?**  
*Answer:*
- **Chaitin (1981):** Pessimistic. When all nodes have degree $\ge K$, it immediately selects a candidate and marks it as spilled to RAM.
- **Briggs (1989/1994):** Optimistic. Even if a node has degree $\ge K$, Briggs pushes it onto the coloring stack anyway. During color selection (popping), if the node's neighbors happen to share colors, there might still be an available physical register! Briggs only spills if all $K$ colors are genuinely taken at pop time.

**Q4: How is Spill Cost calculated? Why does loop depth matter?**  
*Answer:* In real hardware, accessing memory (RAM/cache) takes substantially more clock cycles than accessing a register. A memory access inside an inner loop executed 1,000 times will degrade performance $1,000\times$ more than an access outside the loop. Hence, we weight each variable access by $10^{\text{depth}}$:  
$$\text{Cost} = \frac{(\text{defs} + \text{uses}) \times 10^{\text{depth}}}{\text{degree}}$$

**Q5: What is Conservative Coalescing?**  
*Answer:* Aggressive coalescing of copy instructions ($x = y$) can increase the degree of the merged node and make an otherwise colorable graph uncolorable. **Briggs' Criterion** ensures safety: two nodes $u$ and $v$ can be coalesced if and only if the resulting merged node has fewer than $K$ neighbors of degree $\ge K$.
