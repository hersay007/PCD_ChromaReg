# Makefile for ChromaReg-Studio Assignment Project

.PHONY: help web cli test benchmark clean

help:
	@echo "========================================================================"
	@echo " ChromaReg-Studio: Graph Coloring Register Allocation Project"
	@echo "========================================================================"
	@echo " Available Commands:"
	@echo "   make web        - Launch interactive visualizer web app on Mac"
	@echo "   make cli        - Run Python CLI allocator on sample program"
	@echo "   make test       - Run Python test suite (unit tests)"
	@echo "   make benchmark  - Run allocator across all 5 benchmark testcases"
	@echo "   make dot        - Generate Graphviz DOT file of interference graph"
	@echo "========================================================================"

web:
	@echo "Starting web server on http://localhost:8000 ..."
	@open http://localhost:8000 || xdg-open http://localhost:8000 || echo "Open http://localhost:8000 in your browser"
	@python3 -m http.server 8000

cli:
	@python3 compiler_core/cli.py test_programs/02_high_pressure_loop.ir -k 3 --algo briggs --target riscv

test:
	@python3 -m unittest discover -s compiler_core

benchmark:
	@for f in test_programs/*.ir; do \
		echo "\n=============================================="; \
		echo "Running: $$f"; \
		echo "=============================================="; \
		python3 compiler_core/cli.py "$$f" -k 3 --algo briggs --target riscv; \
	done

dot:
	@python3 compiler_core/cli.py test_programs/03_chaitin_spill_test.ir -k 3 --dot rig_graph.dot
	@echo "Generated rig_graph.dot"
