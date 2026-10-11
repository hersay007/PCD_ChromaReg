// Register Interference Graph (RIG) for Frontend

export class InterferenceGraph {
  constructor() {
    this.nodes = new Set();
    this.adj = new Map();
    this.copyPairs = new Set();
    this.spillCosts = new Map();
    this.varStats = new Map();
  }

  addNode(v) {
    if (!this.nodes.has(v)) {
      this.nodes.add(v);
      this.adj.set(v, new Set());
      this.spillCosts.set(v, 1.0);
      this.varStats.set(v, { defs: 0, uses: 0, maxLoopDepth: 0 });
    }
  }

  addEdge(u, v) {
    if (u !== v) {
      this.addNode(u);
      this.addNode(v);
      this.adj.get(u).add(v);
      this.adj.get(v).add(u);
    }
  }

  degree(v) {
    return this.adj.has(v) ? this.adj.get(v).size : 0;
  }

  clone() {
    const copy = new InterferenceGraph();
    copy.nodes = new Set(this.nodes);
    this.adj.forEach((nbrs, n) => {
      copy.adj.set(n, new Set(nbrs));
    });
    copy.copyPairs = new Set(this.copyPairs);
    this.spillCosts.forEach((val, key) => copy.spillCosts.set(key, val));
    this.varStats.forEach((val, key) => copy.varStats.set(key, { ...val }));
    return copy;
  }

  getMaxCliqueSize() {
    if (this.nodes.size === 0) return 0;
    const sortedNodes = Array.from(this.nodes).sort((a, b) => this.degree(b) - this.degree(a));
    const clique = [];
    for (const node of sortedNodes) {
      const nbrs = this.adj.get(node);
      if (clique.every(c => nbrs.has(c))) {
        clique.push(node);
      }
    }
    return clique.length;
  }
}

export function buildInterferenceGraph(instructions) {
  const ig = new InterferenceGraph();

  // Populate nodes & stats
  instructions.forEach(inst => {
    inst.defs.forEach(d => {
      ig.addNode(d);
      const st = ig.varStats.get(d);
      st.defs++;
      st.maxLoopDepth = Math.max(st.maxLoopDepth, inst.loopDepth);
    });

    inst.uses.forEach(u => {
      ig.addNode(u);
      const st = ig.varStats.get(u);
      st.uses++;
      st.maxLoopDepth = Math.max(st.maxLoopDepth, inst.loopDepth);
    });
  });

  // Add interference edges
  instructions.forEach(inst => {
    const isCopy = inst.op === 'COPY' && inst.src1 && !/^-?\d+$/.test(inst.src1);
    const copySrc = isCopy ? inst.src1 : null;

    if (isCopy && inst.dest && copySrc && ig.nodes.has(copySrc)) {
      const pair = [inst.dest, copySrc].sort().join('<->');
      ig.copyPairs.add(pair);
    }

    inst.defs.forEach(d => {
      inst.liveOut.forEach(v => {
        if (v !== d) {
          if (isCopy && v === copySrc) {
            // Chaitin-Briggs rule: do not interfere with copy source!
            return;
          }
          ig.addEdge(d, v);
        }
      });
    });
  });

  // Calculate Spill Costs using Loop-Depth heuristic
  ig.nodes.forEach(node => {
    const st = ig.varStats.get(node);
    const deg = Math.max(1, ig.degree(node));
    const depth = st.maxLoopDepth;
    const accesses = (st.defs + st.uses) * Math.pow(10, depth);
    const cost = Math.round((accesses / deg) * 100) / 100;
    ig.spillCosts.set(node, cost);
  });

  return ig;
}
