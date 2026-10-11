// Chaitin-Briggs Graph Coloring Engine for Frontend with Step Recording

export function runRegisterAllocation(originalIG, K = 3, algorithm = 'briggs', enableCoalescing = true) {
  const steps = [];
  const coalescedMap = {};
  const ig = originalIG.clone();

  steps.push({
    type: 'START',
    title: `Initialize Allocation (K = ${K})`,
    detail: `Starting graph coloring with K=${K} physical registers using ${algorithm.toUpperCase()} algorithm.`,
    graphNodes: Array.from(ig.nodes),
    stack: [],
    colors: {},
    highlightNode: null
  });

  // Stage 1: Coalescing (Briggs conservative criterion)
  if (enableCoalescing && ig.copyPairs.size > 0) {
    const pairs = Array.from(ig.copyPairs);
    for (const pairStr of pairs) {
      const [u, v] = pairStr.split('<->');
      if (!ig.nodes.has(u) || !ig.nodes.has(v)) continue;
      if (ig.adj.get(u).has(v)) continue; // Interfere

      // Briggs condition: merged uv has fewer than K neighbors with degree >= K
      const combined = new Set([...ig.adj.get(u), ...ig.adj.get(v)]);
      combined.delete(u);
      combined.delete(v);

      let highDegCount = 0;
      combined.forEach(nbr => {
        if (ig.degree(nbr) >= K) highDegCount++;
      });

      if (highDegCount < K) {
        coalescedMap[v] = u;
        steps.push({
          type: 'COALESCE',
          title: `Coalesced '${v}' -> '${u}'`,
          detail: `Conservative Briggs criterion satisfied (${highDegCount} high-degree neighbors < K=${K}). Merged copies.`,
          graphNodes: Array.from(ig.nodes).filter(n => n !== v),
          stack: [],
          colors: {},
          highlightNode: u
        });

        // Merge edges into u
        ig.adj.get(v).forEach(nbr => {
          if (nbr !== u) {
            ig.adj.get(u).add(nbr);
            ig.adj.get(nbr).add(u);
            ig.adj.get(nbr).delete(v);
          }
        });
        ig.nodes.delete(v);
        ig.adj.delete(v);
      }
    }
  }

  // Stage 2: Simplification and Spill Selection
  const workingGraph = ig.clone();
  const stack = []; // array of { node, deg, reason }
  const spilledNodes = [];
  const optimisticCandidates = new Set();

  while (workingGraph.nodes.size > 0) {
    // Find node with degree < K
    let lowDegNode = null;
    let minDeg = Infinity;
    workingGraph.nodes.forEach(node => {
      const d = workingGraph.degree(node);
      if (d < K && d < minDeg) {
        minDeg = d;
        lowDegNode = node;
      }
    });

    if (lowDegNode) {
      const deg = workingGraph.degree(lowDegNode);
      stack.push({ node: lowDegNode, deg, reason: 'SIMPLIFY' });

      // Remove from working graph
      removeNode(workingGraph, lowDegNode);

      steps.push({
        type: 'SIMPLIFY',
        title: `Simplify '${lowDegNode}'`,
        detail: `Node '${lowDegNode}' has degree ${deg} < K (${K}). Kempe's theorem guarantees it can be colored later. Pushed to stack.`,
        graphNodes: Array.from(workingGraph.nodes),
        stack: [...stack],
        colors: {},
        highlightNode: lowDegNode
      });
    } else {
      // All nodes have degree >= K!
      // Pick spill candidate with lowest spill cost
      let spillCand = null;
      let minCost = Infinity;

      workingGraph.nodes.forEach(node => {
        const cost = originalIG.spillCosts.get(node) || 1.0;
        if (cost < minCost) {
          minCost = cost;
          spillCand = node;
        }
      });

      const deg = workingGraph.degree(spillCand);

      if (algorithm === 'chaitin') {
        // Pessimistic spill
        spilledNodes.push(spillCand);
        removeNode(workingGraph, spillCand);

        steps.push({
          type: 'CHAITIN_SPILL',
          title: `Chaitin Spill '${spillCand}'`,
          detail: `All remaining nodes have degree >= K. Pessimistically marked '${spillCand}' (Spill cost = ${minCost}) for RAM spill.`,
          graphNodes: Array.from(workingGraph.nodes),
          stack: [...stack],
          colors: { [spillCand]: `S${spilledNodes.length - 1}` },
          highlightNode: spillCand
        });
      } else {
        // Briggs Optimistic: push to stack anyway
        optimisticCandidates.add(spillCand);
        stack.push({ node: spillCand, deg, reason: 'OPTIMISTIC_SPILL' });
        removeNode(workingGraph, spillCand);

        steps.push({
          type: 'OPTIMISTIC_SPILL',
          title: `Optimistic Push '${spillCand}'`,
          detail: `Degree ${deg} >= K=${K}. Briggs Optimistic strategy pushes '${spillCand}' (Cost: ${minCost}) to stack in hope neighbors share colors.`,
          graphNodes: Array.from(workingGraph.nodes),
          stack: [...stack],
          colors: {},
          highlightNode: spillCand
        });
      }
    }
  }

  // Stage 3: Select (Rebuilding and Coloring by popping from stack)
  const colors = {};
  let spillSlotIdx = 0;

  // Pre-assign Chaitin spills
  spilledNodes.forEach(s => {
    colors[s] = `S${spillSlotIdx++}`;
  });

  while (stack.length > 0) {
    const item = stack.pop();
    const node = item.node;

    // Check colors of neighbors in the post-coalesced graph (ig)
    const usedColors = new Set();
    if (ig.adj.has(node)) {
      ig.adj.get(node).forEach(nbr => {
        if (colors[nbr] && colors[nbr].startsWith('R')) {
          usedColors.add(colors[nbr]);
        }
      });
    }

    // Find lowest available physical register R0, R1, ... R_{K-1}
    let chosenColor = null;
    for (let r = 0; r < K; r++) {
      const rName = `R${r}`;
      if (!usedColors.has(rName)) {
        chosenColor = rName;
        break;
      }
    }

    if (chosenColor) {
      colors[node] = chosenColor;
      const wasOptimistic = item.reason === 'OPTIMISTIC_SPILL';
      steps.push({
        type: wasOptimistic ? 'OPTIMISTIC_SUCCESS' : 'COLOR_ASSIGN',
        title: wasOptimistic ? `Optimistic Success: '${node}'` : `Colored '${node}' -> ${chosenColor}`,
        detail: wasOptimistic
          ? `SUCCESS! Neighbors share colors (${Array.from(usedColors).join(', ') || 'none'}). Assigned ${chosenColor} with 0 spills!`
          : `Popped from stack. Free register ${chosenColor} available among neighbors. Assigned!`,
        graphNodes: Object.keys(colors),
        stack: [...stack],
        colors: { ...colors },
        highlightNode: node
      });
    } else {
      // Must spill
      const slot = `S${spillSlotIdx++}`;
      colors[node] = slot;
      spilledNodes.push(node);
      steps.push({
        type: 'ACTUAL_SPILL',
        title: `Actual Spill '${node}' -> ${slot}`,
        detail: `All ${K} physical registers are exhausted by neighbors (${Array.from(usedColors).join(', ')}). Variable spilled to stack slot ${slot}.`,
        graphNodes: Object.keys(colors),
        stack: [...stack],
        colors: { ...colors },
        highlightNode: node
      });
    }
  }

  // Propagate coalesced aliases
  Object.entries(coalescedMap).forEach(([alias, target]) => {
    colors[alias] = colors[target] || 'R0';
  });

  const uniqueRegs = new Set(Object.values(colors).filter(c => c.startsWith('R')));

  const finalResult = {
    k: K,
    algorithm,
    allocation: colors,
    spilledNodes,
    coalescedNodes: coalescedMap,
    steps,
    spillCosts: Object.fromEntries(originalIG.spillCosts),
    numSpills: spilledNodes.length,
    numRegistersUsed: uniqueRegs.size,
    success: spilledNodes.length === 0,
    maxClique: originalIG.getMaxCliqueSize()
  };

  steps.push({
    type: 'COMPLETE',
    title: `Allocation Complete: ${finalResult.success ? 'Optimal 0 Spills' : `${finalResult.numSpills} Spilled to RAM`}`,
    detail: `Final mapping computed. Used ${finalResult.numRegistersUsed}/${K} physical registers. Chromatic lower bound omega(G) = ${finalResult.maxClique}.`,
    graphNodes: Object.keys(colors),
    stack: [],
    colors: { ...colors },
    highlightNode: null
  });

  return finalResult;
}

function removeNode(graph, node) {
  graph.nodes.delete(node);
  if (graph.adj.has(node)) {
    graph.adj.get(node).forEach(nbr => {
      if (graph.adj.has(nbr)) {
        graph.adj.get(nbr).delete(node);
      }
    });
    graph.adj.delete(node);
  }
}
