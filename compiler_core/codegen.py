"""
Machine Code Emitter supporting RISC-V RV32I and x86-64 architectures.
Replaces virtual temporaries with physical register aliases.
Injects spill loads (lw / mov) and stores (sw / mov) when variables reside on the stack.
Computes memory traffic and instruction overhead metrics.
"""

from typing import List, Dict, Tuple
from compiler_core.ir_parser import Instruction
from compiler_core.allocator import AllocationResult

RISCV_REG_MAP = {
    'R0': 't0', 'R1': 't1', 'R2': 't2', 'R3': 't3',
    'R4': 't4', 'R5': 't5', 'R6': 'a0', 'R7': 'a1'
}

X86_REG_MAP = {
    'R0': 'rax', 'R1': 'rcx', 'R2': 'rdx', 'R3': 'rsi',
    'R4': 'rdi', 'R5': 'r8',  'R6': 'r9',  'R7': 'r10'
}

class CodeGenerator:
    def __init__(self, target: str = 'riscv'):
        self.target = target.lower() # 'riscv' or 'x86'

    def emit(self, instructions: List[Instruction], alloc: AllocationResult) -> Tuple[str, Dict[str, int]]:
        if self.target == 'riscv':
            return self._emit_riscv(instructions, alloc)
        else:
            return self._emit_x86(instructions, alloc)

    def _emit_riscv(self, instructions: List[Instruction], alloc: AllocationResult) -> Tuple[str, Dict[str, int]]:
        lines: List[str] = []
        metrics = {'loads': 0, 'stores': 0, 'instructions': 0, 'cycle_penalty': 0}

        # Calculate stack frame size
        num_spills = alloc.num_spills
        stack_size = max(16, ((num_spills * 4) + 15) & ~15) # 16-byte aligned

        lines.append("# --- ChromaReg Generated RISC-V RV32I Assembly ---")
        lines.append(f"# Target: RV32I | Registers Allocated: {alloc.num_registers_used} | Spills: {num_spills}")
        lines.append(".globl main")
        lines.append(".text")
        lines.append("main:")
        lines.append(f"    addi sp, sp, -{stack_size}       # Prologue: allocate stack frame")
        metrics['instructions'] += 1

        # Map stack slots to byte offsets: S0 -> 0(sp), S1 -> 4(sp)
        spill_offsets = {f"S{i}": i * 4 for i in range(num_spills + 4)}

        for inst in instructions:
            lines.append(f"    # IR: {inst.raw}")

            if inst.op == 'LABEL':
                lines.append(f"{inst.target_label}:")
                continue

            if inst.op == 'RETURN':
                src = inst.src1
                if src:
                    loc = alloc.allocation.get(src, 'R0')
                    if loc.startswith('R'):
                        reg = RISCV_REG_MAP.get(loc, 't0')
                        lines.append(f"    mv a0, {reg}              # Move return value to a0")
                        metrics['instructions'] += 1
                    elif loc.startswith('S'):
                        offset = spill_offsets.get(loc, 0)
                        lines.append(f"    lw a0, {offset}(sp)        # Load spilled return value to a0")
                        metrics['loads'] += 1
                        metrics['instructions'] += 1
                    else:
                        lines.append(f"    li a0, {src}              # Immediate return")
                        metrics['instructions'] += 1
                lines.append(f"    addi sp, sp, {stack_size}        # Epilogue: deallocate frame")
                lines.append("    ret")
                metrics['instructions'] += 2
                continue

            if inst.op == 'GOTO':
                lines.append(f"    j {inst.target_label}")
                metrics['instructions'] += 1
                continue

            if inst.op == 'IF_GOTO':
                cond_var = inst.src1
                loc = alloc.allocation.get(cond_var, 'R0')
                cond_reg = 't6' # scratch
                if loc.startswith('R'):
                    cond_reg = RISCV_REG_MAP.get(loc, 't0')
                elif loc.startswith('S'):
                    offset = spill_offsets.get(loc, 0)
                    lines.append(f"    lw t6, {offset}(sp)        # SPILL RELOAD for branch condition")
                    metrics['loads'] += 1
                    metrics['instructions'] += 1
                lines.append(f"    bnez {cond_reg}, {inst.target_label}")
                metrics['instructions'] += 1
                continue

            # Standard binary or copy operation
            dest = inst.dest
            dest_loc = alloc.allocation.get(dest, 'R0')
            dest_reg = RISCV_REG_MAP.get(dest_loc, 't0') if dest_loc.startswith('R') else 't6'

            # Load src1 if spilled
            src1_reg = 't1'
            if inst.src1:
                if inst.src1.lstrip('-').isdigit():
                    src1_reg = 't1'
                    lines.append(f"    li t1, {inst.src1}")
                    metrics['instructions'] += 1
                else:
                    s1_loc = alloc.allocation.get(inst.src1, 'R0')
                    if s1_loc.startswith('R'):
                        src1_reg = RISCV_REG_MAP.get(s1_loc, 't1')
                    elif s1_loc.startswith('S'):
                        offset = spill_offsets.get(s1_loc, 0)
                        lines.append(f"    lw t1, {offset}(sp)        # SPILL LOAD: reload {inst.src1}")
                        src1_reg = 't1'
                        metrics['loads'] += 1
                        metrics['instructions'] += 1

            # Load src2 if present
            src2_reg = 't2'
            if inst.src2:
                if inst.src2.lstrip('-').isdigit():
                    src2_reg = 't2'
                    lines.append(f"    li t2, {inst.src2}")
                    metrics['instructions'] += 1
                else:
                    s2_loc = alloc.allocation.get(inst.src2, 'R0')
                    if s2_loc.startswith('R'):
                        src2_reg = RISCV_REG_MAP.get(s2_loc, 't2')
                    elif s2_loc.startswith('S'):
                        offset = spill_offsets.get(s2_loc, 0)
                        lines.append(f"    lw t2, {offset}(sp)        # SPILL LOAD: reload {inst.src2}")
                        src2_reg = 't2'
                        metrics['loads'] += 1
                        metrics['instructions'] += 1

            # Emit core ALU instruction
            if inst.op == 'COPY':
                if dest_reg != src1_reg:
                    lines.append(f"    mv {dest_reg}, {src1_reg}")
                    metrics['instructions'] += 1
            elif inst.op == '+':
                lines.append(f"    add {dest_reg}, {src1_reg}, {src2_reg}")
                metrics['instructions'] += 1
            elif inst.op == '-':
                lines.append(f"    sub {dest_reg}, {src1_reg}, {src2_reg}")
                metrics['instructions'] += 1
            elif inst.op == '*':
                lines.append(f"    mul {dest_reg}, {src1_reg}, {src2_reg}")
                metrics['instructions'] += 1
            elif inst.op == '/':
                lines.append(f"    div {dest_reg}, {src1_reg}, {src2_reg}")
                metrics['instructions'] += 1
            elif inst.op == '<':
                lines.append(f"    slt {dest_reg}, {src1_reg}, {src2_reg}")
                metrics['instructions'] += 1

            # Store to stack if dest is spilled
            if dest_loc.startswith('S'):
                offset = spill_offsets.get(dest_loc, 0)
                lines.append(f"    sw {dest_reg}, {offset}(sp)        # SPILL STORE: save {dest} to stack slot {dest_loc}")
                metrics['stores'] += 1
                metrics['instructions'] += 1

        # Memory penalty: Each memory access is ~10-100 cycles in real CPUs, model as 5 cycles
        metrics['cycle_penalty'] = (metrics['loads'] + metrics['stores']) * 5
        return "\n".join(lines), metrics

    def _emit_x86(self, instructions: List[Instruction], alloc: AllocationResult) -> Tuple[str, Dict[str, int]]:
        lines: List[str] = []
        metrics = {'loads': 0, 'stores': 0, 'instructions': 0, 'cycle_penalty': 0}
        num_spills = alloc.num_spills
        stack_size = max(16, ((num_spills * 8) + 15) & ~15)

        lines.append("; --- ChromaReg Generated x86-64 Intel Assembly ---")
        lines.append(f"; Registers Allocated: {alloc.num_registers_used} | Spills: {num_spills}")
        lines.append(".intel_syntax noprefix")
        lines.append(".globl main")
        lines.append("main:")
        lines.append(f"    sub rsp, {stack_size}             ; Allocate stack frame")
        metrics['instructions'] += 1

        spill_offsets = {f"S{i}": i * 8 for i in range(num_spills + 4)}

        for inst in instructions:
            lines.append(f"    ; IR: {inst.raw}")
            if inst.op == 'LABEL':
                lines.append(f"{inst.target_label}:")
                continue
            if inst.op == 'RETURN':
                src = inst.src1
                if src:
                    loc = alloc.allocation.get(src, 'R0')
                    if loc.startswith('R'):
                        reg = X86_REG_MAP.get(loc, 'rax')
                        if reg != 'rax':
                            lines.append(f"    mov rax, {reg}")
                            metrics['instructions'] += 1
                    elif loc.startswith('S'):
                        offset = spill_offsets.get(loc, 0)
                        lines.append(f"    mov rax, [rsp+{offset}]     ; Load spilled return")
                        metrics['loads'] += 1
                        metrics['instructions'] += 1
                    else:
                        lines.append(f"    mov rax, {src}")
                        metrics['instructions'] += 1
                lines.append(f"    add rsp, {stack_size}             ; Epilogue")
                lines.append("    ret")
                metrics['instructions'] += 2
                continue

            if inst.op == 'GOTO':
                lines.append(f"    jmp {inst.target_label}")
                metrics['instructions'] += 1
                continue

            dest = inst.dest
            dest_loc = alloc.allocation.get(dest, 'R0')
            dest_reg = X86_REG_MAP.get(dest_loc, 'rax') if dest_loc.startswith('R') else 'r11'

            # Simple x86 emission
            if inst.op == 'COPY':
                src = inst.src1
                if src.lstrip('-').isdigit():
                    lines.append(f"    mov {dest_reg}, {src}")
                    metrics['instructions'] += 1
                else:
                    s_loc = alloc.allocation.get(src, 'R0')
                    s_reg = X86_REG_MAP.get(s_loc, 'rcx') if s_loc.startswith('R') else 'r10'
                    if s_loc.startswith('S'):
                        lines.append(f"    mov r10, [rsp+{spill_offsets.get(s_loc, 0)}]")
                        metrics['loads'] += 1
                        metrics['instructions'] += 1
                    if dest_reg != s_reg:
                        lines.append(f"    mov {dest_reg}, {s_reg}")
                        metrics['instructions'] += 1
            elif inst.op in ['+', '-', '*']:
                op_name = 'add' if inst.op == '+' else ('sub' if inst.op == '-' else 'imul')
                lines.append(f"    {op_name} {dest_reg}, {inst.src2 if inst.src2.isdigit() else 'rcx'}")
                metrics['instructions'] += 1

            if dest_loc.startswith('S'):
                lines.append(f"    mov [rsp+{spill_offsets.get(dest_loc, 0)}], {dest_reg}  ; Spill store")
                metrics['stores'] += 1
                metrics['instructions'] += 1

        metrics['cycle_penalty'] = (metrics['loads'] + metrics['stores']) * 5
        return "\n".join(lines), metrics
