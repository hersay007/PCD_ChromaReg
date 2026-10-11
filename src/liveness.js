// Dataflow Liveness Analysis for Frontend

export function buildCFG(instructions) {
  const succ = instructions.map(() => []);
  const labelMap = {};

  instructions.forEach((inst, i) => {
    if (inst.op === 'LABEL' && inst.targetLabel) {
      labelMap[inst.targetLabel] = i;
    }
  });

  instructions.forEach((inst, i) => {
    if (inst.op === 'RETURN') {
      // Exit
    } else if (inst.op === 'GOTO') {
      if (labelMap[inst.targetLabel] !== undefined) {
        succ[i].push(labelMap[inst.targetLabel]);
      }
    } else if (inst.op === 'IF_GOTO') {
      if (labelMap[inst.targetLabel] !== undefined) {
        succ[i].push(labelMap[inst.targetLabel]);
      }
      if (i + 1 < instructions.length) {
        succ[i].push(i + 1);
      }
    } else {
      if (i + 1 < instructions.length) {
        succ[i].push(i + 1);
      }
    }
  });

  return succ;
}

export function computeLiveness(instructions) {
  const succ = buildCFG(instructions);
  const n = instructions.length;

  instructions.forEach(inst => {
    inst.liveIn = new Set();
    inst.liveOut = new Set();
  });

  const history = [];
  let changed = true;
  let iteration = 0;

  while (changed && iteration < 50) {
    iteration++;
    changed = false;
    const snap = [];

    for (let i = n - 1; i >= 0; i--) {
      const inst = instructions[i];

      // Out[i] = Union_{s in succ[i]} In[s]
      const newOut = new Set();
      for (const s of succ[i]) {
        for (const v of instructions[s].liveIn) {
          newOut.add(v);
        }
      }

      // In[i] = Uses[i] U (Out[i] - Defs[i])
      const newIn = new Set(inst.uses);
      for (const v of newOut) {
        if (!inst.defs.has(v)) {
          newIn.add(v);
        }
      }

      // Compare sets
      if (!setsEqual(newIn, inst.liveIn) || !setsEqual(newOut, inst.liveOut)) {
        changed = true;
        inst.liveIn = newIn;
        inst.liveOut = newOut;
      }

      snap.push({
        index: i,
        in: Array.from(inst.liveIn).sort(),
        out: Array.from(inst.liveOut).sort()
      });
    }

    history.push({ iteration, snapshots: snap });
  }

  return { instructions, history };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function getVariableLiveRanges(instructions) {
  const ranges = {};
  instructions.forEach(inst => {
    const varsInvolved = new Set([...inst.defs, ...inst.uses, ...inst.liveOut]);
    varsInvolved.forEach(v => {
      if (!ranges[v]) {
        ranges[v] = { start: inst.index, end: inst.index };
      } else {
        ranges[v].start = Math.min(ranges[v].start, inst.index);
        ranges[v].end = Math.max(ranges[v].end, inst.index);
      }
    });
  });
  return ranges;
}
