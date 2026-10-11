// 3-Address Code Parser for Frontend

export function isVariable(token) {
  if (!token) return false;
  token = token.trim();
  if (/^-?\d+(\.\d+)?$/.test(token)) return false;
  if (token.startsWith('"') || token.startsWith("'")) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token);
}

export function parseIR(codeText) {
  const instructions = [];
  const lines = codeText.split('\n');
  let idx = 0;

  for (let line of lines) {
    let raw = line.trim();
    if (raw.includes('#')) {
      raw = raw.split('#')[0].trim();
    }
    if (!raw) continue;

    const inst = {
      index: idx,
      raw: raw,
      op: 'NOP',
      dest: null,
      src1: null,
      src2: null,
      targetLabel: null,
      defs: new Set(),
      uses: new Set(),
      liveIn: new Set(),
      liveOut: new Set(),
      loopDepth: 0
    };

    if (raw.endsWith(':')) {
      inst.op = 'LABEL';
      inst.targetLabel = raw.slice(0, -1).trim();
    } else if (raw.startsWith('return')) {
      inst.op = 'RETURN';
      const parts = raw.split(/\s+/);
      if (parts.length > 1) {
        inst.src1 = parts[1];
        if (isVariable(parts[1])) inst.uses.add(parts[1]);
      }
    } else if (raw.startsWith('if ') && raw.includes(' goto ')) {
      const match = raw.match(/^if\s+([a-zA-Z0-9_]+)\s+goto\s+([a-zA-Z0-9_]+)/);
      if (match) {
        inst.op = 'IF_GOTO';
        inst.src1 = match[1];
        inst.targetLabel = match[2];
        if (isVariable(match[1])) inst.uses.add(match[1]);
      }
    } else if (raw.startsWith('goto ')) {
      inst.op = 'GOTO';
      inst.targetLabel = raw.split(/\s+/)[1];
    } else if (raw.includes('=')) {
      const [destPart, exprPart] = raw.split('=').map(s => s.trim());
      inst.dest = destPart;
      if (isVariable(destPart)) inst.defs.add(destPart);

      // Match binary operation: operand op operand
      const binMatch = exprPart.match(/^([a-zA-Z0-9_\-]+)\s*([\+\-\*\/\%\&\|\^\<\>\=\!]+)\s*([a-zA-Z0-9_\-]+)$/);
      if (binMatch) {
        inst.op = binMatch[2];
        inst.src1 = binMatch[1];
        inst.src2 = binMatch[3];
        if (isVariable(binMatch[1])) inst.uses.add(binMatch[1]);
        if (isVariable(binMatch[3])) inst.uses.add(binMatch[3]);
      } else {
        // Copy or immediate assignment
        inst.op = 'COPY';
        inst.src1 = exprPart;
        if (isVariable(exprPart)) inst.uses.add(exprPart);
      }
    }

    instructions.push(inst);
    idx++;
  }

  // Detect loop bounds for loop depth
  const labelMap = {};
  instructions.forEach((inst, i) => {
    if (inst.op === 'LABEL' && inst.targetLabel) {
      labelMap[inst.targetLabel] = i;
    }
  });

  instructions.forEach((inst, i) => {
    if (inst.targetLabel && labelMap[inst.targetLabel] !== undefined) {
      const targetIdx = labelMap[inst.targetLabel];
      if (targetIdx < i) {
        for (let j = targetIdx; j <= i; j++) {
          instructions[j].loopDepth += 1;
        }
      }
    }
  });

  return instructions;
}
