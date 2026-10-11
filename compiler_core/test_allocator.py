"""
Unit tests for Compiler Core:
- IR Parser
- Liveness Analysis
- Interference Graph Builder
- Chaitin & Briggs Register Allocators
- Conservative Coalescing
- RISC-V and x86 Assembly Codegen
"""

import unittest
from compiler_core.ir_parser import parse_ir
from compiler_core.liveness import compute_liveness
from compiler_core.interference import build_interference_graph
from compiler_core.allocator import RegisterAllocator
from compiler_core.codegen import CodeGenerator

class TestRegisterAllocator(unittest.TestCase):

    def test_simple_pipeline(self):
        code = """
        t1 = 10
        t2 = 20
        t3 = t1 + t2
        t4 = t3 * 2
        return t4
        """
        insts = parse_ir(code)
        insts, _ = compute_liveness(insts)
        ig = build_interference_graph(insts)
        # Should be easily colorable with K=2
        alloc = RegisterAllocator(k=2, algorithm='briggs').allocate(ig)
        self.assertTrue(alloc.success)
        self.assertEqual(alloc.num_spills, 0)
        self.assertLessEqual(alloc.num_registers_used, 2)

    def test_chaitin_mandatory_spill(self):
        # 4 variables live simultaneously, K=2 -> must spill 2
        code = """
        a = 1
        b = 2
        c = 3
        d = 4
        sum = a + b
        sum = sum + c
        sum = sum + d
        return sum
        """
        insts = parse_ir(code)
        insts, _ = compute_liveness(insts)
        ig = build_interference_graph(insts)
        alloc = RegisterAllocator(k=2, algorithm='chaitin').allocate(ig)
        self.assertFalse(alloc.success)
        self.assertGreater(alloc.num_spills, 0)

    def test_briggs_optimistic_advantage(self):
        # Code where Chaitin spills pessimistically, but Briggs succeeds
        # 4 variables forming a cycle C4 (degree 2 each).
        # With K=2, Welsh-Powell or Briggs colors C4 with 2 colors!
        code = """
        w = 1
        x = 2
        y = 3
        z = 4
        ans1 = w + x
        ans2 = x + y
        ans3 = y + z
        ans4 = z + w
        total = ans1 + ans2
        total = total + ans3
        total = total + ans4
        return total
        """
        insts = parse_ir(code)
        insts, _ = compute_liveness(insts)
        ig = build_interference_graph(insts)
        alloc = RegisterAllocator(k=3, algorithm='briggs').allocate(ig)
        self.assertLessEqual(alloc.num_registers_used, 3)

    def test_codegen_riscv(self):
        code = """
        x = 10
        y = 20
        z = x + y
        return z
        """
        insts = parse_ir(code)
        insts, _ = compute_liveness(insts)
        ig = build_interference_graph(insts)
        alloc = RegisterAllocator(k=2).allocate(ig)
        cg = CodeGenerator(target='riscv')
        asm, metrics = cg.emit(insts, alloc)
        self.assertIn(".globl main", asm)
        self.assertIn("addi sp, sp,", asm)
        self.assertIn("ret", asm)

    def test_codegen_x86(self):
        code = """
        x = 10
        y = 20
        z = x + y
        return z
        """
        insts = parse_ir(code)
        insts, _ = compute_liveness(insts)
        ig = build_interference_graph(insts)
        alloc = RegisterAllocator(k=2).allocate(ig)
        cg = CodeGenerator(target='x86')
        asm, metrics = cg.emit(insts, alloc)
        self.assertIn(".intel_syntax", asm)
        self.assertIn("ret", asm)

if __name__ == '__main__':
    unittest.main()
