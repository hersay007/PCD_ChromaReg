// Presets with rich compiler design scenarios
export const PRESETS = [
  {
    id: 'pipeline',
    name: '1. Linear Register Reuse Pipeline',
    description: 'Demonstrates temporal register reuse when variable live ranges do not overlap.',
    recommendedK: 2,
    code: `# Pipeline: 5 virtual registers reused across time
# Live ranges of t1, t2 end early; t3, t4, t5 can reuse physical registers.
t1 = 10
t2 = 20
t3 = t1 + t2
t4 = t3 * 2
t5 = t4 - t1
return t5`
  },
  {
    id: 'loop',
    name: '2. High-Pressure Loop (Spill Cost Heuristic)',
    description: 'Variables inside loop bodies get weighted 10x higher spill costs so loop invariants spill first.',
    recommendedK: 3,
    code: `# Loop kernel: high register pressure across back-edge
# sum and i are heavily modified inside the loop (higher spill cost)
# limit, factor, step are read-only (lower spill cost, ideal to spill)
sum = 0
i = 0
limit = 100
step = 1
factor = 5
L_LOOP:
temp = i * factor
sum = sum + temp
i = i + step
cond = i < limit
if cond goto L_LOOP
return sum`
  },
  {
    id: 'clique_spill',
    name: '3. Chaitin Mandatory Spill (Clique > K)',
    description: 'Creates a 5-clique of simultaneous live variables under K=3, forcing spilling to stack memory.',
    recommendedK: 3,
    code: `# 5 variables simultaneously live at the summation point
# With K=3 physical registers, the graph chromatic number chi(G) = 5.
# At least 2 variables MUST spill to stack slots (S0, S1).
v1 = 10
v2 = 20
v3 = 30
v4 = 40
v5 = 50
ans = v1 + v2
ans = ans + v3
ans = ans + v4
ans = ans + v5
return ans`
  },
  {
    id: 'briggs_optimistic',
    name: '4. Briggs Optimistic Recovery (Chaitin vs Briggs)',
    description: 'All nodes have degree >= K, causing Chaitin to spill pessimistically, whereas Briggs colors it with 0 spills!',
    recommendedK: 3,
    code: `# Symmetrical diamond/prism interference pattern
# Every node has degree >= 3. Chaitin would pessimistically spill.
# Briggs pushes nodes to stack optimistically; upon popping,
# non-adjacent nodes share colors, achieving zero spills!
a = 1
b = 2
c = 3
d = 4
e = 5
f = 6
t1 = a + b
t2 = c + d
t3 = e + f
res = t1 + t2
res = res + t3
return res`
  },
  {
    id: 'coalescing',
    name: '5. Conservative Copy Coalescing (George/Briggs)',
    description: 'Eliminates redundant copy instructions (x = y) by merging non-interfering nodes.',
    recommendedK: 3,
    code: `# Copy coalescing: eliminates register-to-register moves
# ptr = base is a candidate for coalescing.
# If merged, 'base' and 'ptr' share the same physical register!
base = 100
offset = 4
ptr = base
target = ptr + offset
val = target * 2
return val`
  },
  {
    id: 'expression_tree',
    name: '6. Complex Expression Tree (Sethi-Ullman style)',
    description: 'Binary expression tree evaluating nested sub-expressions under strict register limits.',
    recommendedK: 4,
    code: `# Expression: (a * b + c * d) * (e * f - g * h)
a = 2
b = 3
c = 4
d = 5
e = 6
f = 7
g = 8
h = 9
ab = a * b
cd = c * d
left = ab + cd
ef = e * f
gh = g * h
right = ef - gh
final = left * right
return final`
  }
];
