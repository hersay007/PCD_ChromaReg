"""
IR Parser for 3-Address Code (TAC) / Quadruples.
Supports assignments, arithmetic/bitwise/relational operations,
labels, unconditional/conditional branches, and return statements.
"""

import re
from dataclasses import dataclass, field
from typing import List, Set, Optional

@dataclass
class Instruction:
    index: int
    raw: str
    op: Optional[str] = None          # '+', '-', '*', '/', '<', '==', 'COPY', 'LABEL', 'GOTO', 'IF_GOTO', 'RETURN', etc.
    dest: Optional[str] = None        # Variable defined (def)
    src1: Optional[str] = None        # Variable or constant used
    src2: Optional[str] = None        # Variable or constant used
    target_label: Optional[str] = None
    defs: Set[str] = field(default_factory=set)
    uses: Set[str] = field(default_factory=set)
    live_in: Set[str] = field(default_factory=set)
    live_out: Set[str] = field(default_factory=set)
    loop_depth: int = 0

    def is_copy(self) -> bool:
        return self.op == 'COPY' and self.src1 is not None and not self.src1.lstrip('-').isdigit()

def is_variable(token: Optional[str]) -> bool:
    if not token:
        return False
    # If it is numeric literal or string literal, it's not a variable
    if token.lstrip('-').isdigit():
        return False
    if token.startswith('"') or token.startswith("'"):
        return False
    # Check valid identifier
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', token))

def parse_ir(code_text: str) -> List[Instruction]:
    instructions: List[Instruction] = []
    lines = code_text.strip().split('\n')
    idx = 0

    # Simple loop depth heuristic: track L_LOOP / GOTO backwards
    for line in lines:
        raw_line = line.strip()
        # Remove comments
        if '#' in raw_line:
            raw_line = raw_line.split('#', 1)[0].strip()
        if not raw_line:
            continue

        instr = Instruction(index=idx, raw=raw_line)

        # 1. Label: e.g. "L_LOOP:" or "label:"
        if raw_line.endswith(':'):
            label_name = raw_line[:-1].strip()
            instr.op = 'LABEL'
            instr.target_label = label_name

        # 2. Return statement: "return x" or "return 0"
        elif raw_line.startswith('return'):
            parts = raw_line.split()
            instr.op = 'RETURN'
            if len(parts) > 1:
                src = parts[1]
                instr.src1 = src
                if is_variable(src):
                    instr.uses.add(src)

        # 3. Conditional Jump: "if cond goto LABEL"
        elif raw_line.startswith('if ') and ' goto ' in raw_line:
            # "if <var> goto <label>"
            m = re.match(r'if\s+([a-zA-Z0-9_]+)\s+goto\s+([a-zA-Z0-9_]+)', raw_line)
            if m:
                cond_var, lbl = m.group(1), m.group(2)
                instr.op = 'IF_GOTO'
                instr.src1 = cond_var
                instr.target_label = lbl
                if is_variable(cond_var):
                    instr.uses.add(cond_var)

        # 4. Unconditional Jump: "goto LABEL"
        elif raw_line.startswith('goto '):
            lbl = raw_line.split()[1]
            instr.op = 'GOTO'
            instr.target_label = lbl

        # 5. Assignment or Binary Operation: "dest = src1 [op src2]"
        elif '=' in raw_line:
            dest_part, expr_part = [p.strip() for p in raw_line.split('=', 1)]
            instr.dest = dest_part
            if is_variable(dest_part):
                instr.defs.add(dest_part)

            # Match binary op: "a + b", "a * 2", "a < b"
            bin_match = re.match(r'^([a-zA-Z0-9_\-]+)\s*([\+\-\*\/\%\&\|\^\<\>\=\!]+)\s*([a-zA-Z0-9_\-]+)$', expr_part)
            if bin_match:
                s1, op_sym, s2 = bin_match.group(1), bin_match.group(2), bin_match.group(3)
                instr.op = op_sym
                instr.src1 = s1
                instr.src2 = s2
                if is_variable(s1):
                    instr.uses.add(s1)
                if is_variable(s2):
                    instr.uses.add(s2)
            else:
                # Copy or constant: "dest = src"
                instr.op = 'COPY'
                instr.src1 = expr_part
                if is_variable(expr_part):
                    instr.uses.add(expr_part)
        else:
            instr.op = 'NOP'

        instructions.append(instr)
        idx += 1

    # Compute approximate loop nesting depth for spill cost heuristics
    # Find loop bounds by looking for backward jumps (goto / if_goto to earlier label)
    label_map = {}
    for i, inst in enumerate(instructions):
        if inst.op == 'LABEL' and inst.target_label:
            label_map[inst.target_label] = i

    for i, inst in enumerate(instructions):
        if inst.target_label and inst.target_label in label_map:
            target_idx = label_map[inst.target_label]
            if target_idx < i:
                # Backward edge detected: mark instructions in [target_idx, i] with loop_depth >= 1
                for j in range(target_idx, i + 1):
                    instructions[j].loop_depth += 1

    return instructions
