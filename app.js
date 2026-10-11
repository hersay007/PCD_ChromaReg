// ChromaReg-Studio Application Controller

import { PRESETS } from './src/presets.js';
import { parseIR } from './src/parser.js';
import { computeLiveness } from './src/liveness.js';
import { buildInterferenceGraph } from './src/interference.js';
import { runRegisterAllocation } from './src/chaitin_briggs.js';
import { generateAssembly } from './src/codegen.js';
import { GraphRenderer, COLOR_PALETTE, SPILL_COLOR } from './src/graph_renderer.js';

class ChromaApp {
  constructor() {
    this.currentPreset = PRESETS[0];
    this.K = 3;
    this.algorithm = 'briggs';
    this.targetArch = 'riscv';
    this.enableCoalescing = true;

    // Compiled Pipeline State
    this.instructions = [];
    this.ig = null;
    this.allocResult = null;
    this.currentStepIdx = 0;
    this.isPlaying = false;
    this.playTimer = null;

    this.initDOM();
    this.initGraph();
    this.bindEvents();
    this.loadPreset(0);
  }

  initDOM() {
    this.dom = {
      presetSelect: document.getElementById('preset-select'),
      kSlider: document.getElementById('k-slider'),
      kDisplay: document.getElementById('k-display'),
      algoSelect: document.getElementById('algo-select'),
      targetSelect: document.getElementById('target-select'),
      coalesceToggle: document.getElementById('coalesce-toggle'),
      irEditor: document.getElementById('ir-editor'),
      btnCompile: document.getElementById('btn-compile'),
      instrCountBadge: document.getElementById('instruction-count-badge'),

      // Playback
      stepIndicator: document.getElementById('step-indicator'),
      stepTitle: document.getElementById('step-title'),
      stepDetail: document.getElementById('step-detail'),
      btnStepBack: document.getElementById('btn-step-back'),
      btnStepForward: document.getElementById('btn-step-forward'),
      btnPlay: document.getElementById('btn-play'),
      btnReset: document.getElementById('btn-reset'),
      btnSolveAll: document.getElementById('btn-solve-all'),

      // Canvas
      canvas: document.getElementById('rig-canvas'),
      tooltip: document.getElementById('graph-tooltip'),
      legendContainer: document.getElementById('legend-container'),
      btnZoomIn: document.getElementById('btn-zoom-in'),
      btnZoomOut: document.getElementById('btn-zoom-out'),
      btnCenterGraph: document.getElementById('btn-center-graph'),

      // Tabs
      tabBtns: document.querySelectorAll('.tab-btn'),
      tabPanes: document.querySelectorAll('.tab-pane'),

      // Right panels
      asmDisplay: document.getElementById('asm-code-display'),
      asmTargetBadge: document.getElementById('asm-target-badge'),
      asmStatsBadge: document.getElementById('asm-stats-badge'),
      livenessTableBody: document.getElementById('liveness-table-body'),
      metricRegs: document.getElementById('metric-regs'),
      metricSpills: document.getElementById('metric-spills'),
      metricTraffic: document.getElementById('metric-traffic'),
      metricClique: document.getElementById('metric-clique'),
      stackContainer: document.getElementById('stack-items-container'),
      coalesceInfoBox: document.getElementById('coalesce-info-box')
    };

    // Populate Presets dropdown
    PRESETS.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = p.name;
      this.dom.presetSelect.appendChild(opt);
    });
  }

  initGraph() {
    this.renderer = new GraphRenderer(this.dom.canvas, this.dom.tooltip);
  }

  bindEvents() {
    // Preset change
    this.dom.presetSelect.addEventListener('change', (e) => {
      this.loadPreset(parseInt(e.target.value, 10));
    });

    // K slider
    this.dom.kSlider.addEventListener('input', (e) => {
      this.K = parseInt(e.target.value, 10);
      this.dom.kDisplay.textContent = this.K;
      this.recompile();
    });

    // Algorithm change
    this.dom.algoSelect.addEventListener('change', (e) => {
      this.algorithm = e.target.value;
      this.recompile();
    });

    // Target Architecture change
    this.dom.targetSelect.addEventListener('change', (e) => {
      this.targetArch = e.target.value;
      this.updateAssemblyView();
    });

    // Coalescing toggle
    this.dom.coalesceToggle.addEventListener('change', (e) => {
      this.enableCoalescing = e.target.checked;
      this.recompile();
    });

    // Recompile button
    this.dom.btnCompile.addEventListener('click', () => {
      this.recompile();
    });

    // Playback Controls
    this.dom.btnStepForward.addEventListener('click', () => this.stepForward());
    this.dom.btnStepBack.addEventListener('click', () => this.stepBack());
    this.dom.btnReset.addEventListener('click', () => this.resetPlayback());
    this.dom.btnSolveAll.addEventListener('click', () => this.solveAll());
    this.dom.btnPlay.addEventListener('click', () => this.togglePlay());

    // Zoom controls
    this.dom.btnZoomIn.addEventListener('click', () => {
      this.renderer.zoom = Math.min(3.0, this.renderer.zoom * 1.2);
    });
    this.dom.btnZoomOut.addEventListener('click', () => {
      this.renderer.zoom = Math.max(0.4, this.renderer.zoom * 0.8);
    });
    this.dom.btnCenterGraph.addEventListener('click', () => {
      this.renderer.resetView();
    });

    // Tabs
    this.dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.tabBtns.forEach(b => b.classList.remove('active'));
        this.dom.tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = document.getElementById(btn.dataset.tab);
        if (targetTab) targetTab.classList.add('active');
      });
    });
  }

  loadPreset(index) {
    const preset = PRESETS[index];
    this.currentPreset = preset;
    this.dom.irEditor.value = preset.code;
    if (preset.recommendedK) {
      this.K = preset.recommendedK;
      this.dom.kSlider.value = this.K;
      this.dom.kDisplay.textContent = this.K;
    }
    this.recompile();
  }

  recompile() {
    this.pausePlay();
    const code = this.dom.irEditor.value;

    // 1. Parse TAC
    this.instructions = parseIR(code);
    this.dom.instrCountBadge.textContent = `${this.instructions.length} instrs`;

    // 2. Dataflow Liveness
    const { instructions } = computeLiveness(this.instructions);
    this.instructions = instructions;

    // 3. Register Interference Graph
    this.ig = buildInterferenceGraph(this.instructions);

    // 4. Graph Coloring Execution
    this.allocResult = runRegisterAllocation(
      this.ig,
      this.K,
      this.algorithm,
      this.enableCoalescing
    );

    // Update UI components
    this.currentStepIdx = 0;
    this.renderer.setGraph(this.ig, {}, null, null);
    this.updateLegend();
    this.renderLivenessTable();
    this.updateMetrics();
    this.updateAssemblyView();
    this.renderStep(this.currentStepIdx);
  }

  updateLegend() {
    const container = this.dom.legendContainer;
    container.innerHTML = '';

    for (let i = 0; i < this.K; i++) {
      const regKey = `R${i}`;
      const item = COLOR_PALETTE[regKey];
      if (!item) continue;

      const div = document.createElement('div');
      div.className = 'legend-item';
      div.innerHTML = `
        <span class="legend-dot" style="background:${item.fill}; box-shadow: 0 0 8px ${item.glow}"></span>
        <span>${regKey}</span>
      `;
      container.appendChild(div);
    }

    // Spill indicator
    const spillDiv = document.createElement('div');
    spillDiv.className = 'legend-item';
    spillDiv.innerHTML = `
      <span class="legend-dot" style="background:${SPILL_COLOR.fill}; box-shadow: 0 0 8px ${SPILL_COLOR.glow}"></span>
      <span>Spill (RAM)</span>
    `;
    container.appendChild(spillDiv);
  }

  renderStep(idx) {
    if (!this.allocResult || !this.allocResult.steps.length) return;
    const steps = this.allocResult.steps;
    this.currentStepIdx = Math.max(0, Math.min(steps.length - 1, idx));
    const step = steps[this.currentStepIdx];

    // Update playback info
    this.dom.stepIndicator.textContent = `Step ${this.currentStepIdx + 1} / ${steps.length}`;
    this.dom.stepTitle.textContent = step.title;
    this.dom.stepDetail.textContent = step.detail;

    // Update Graph Renderer state
    this.renderer.updateState(step.colors, step.highlightNode, step.graphNodes);

    // Update Stack View
    this.renderStack(step.stack);

    // Update assembly if completed or advancing
    if (step.type === 'COMPLETE') {
      this.updateAssemblyView();
    }
  }

  renderStack(stackItems) {
    const container = this.dom.stackContainer;
    container.innerHTML = '';

    if (!stackItems || stackItems.length === 0) {
      container.innerHTML = '<div style="font-size: 0.75rem; color: var(--text-dim); text-align: center; padding: 12px;">Stack Empty</div>';
      return;
    }

    stackItems.forEach(item => {
      const div = document.createElement('div');
      div.className = `stack-item ${item.reason === 'OPTIMISTIC_SPILL' ? 'spill-candidate' : ''}`;
      div.innerHTML = `
        <span><b>${item.node}</b> (deg: ${item.deg})</span>
        <span style="font-size: 0.65rem; color: var(--text-dim);">${item.reason}</span>
      `;
      container.appendChild(div);
    });
  }

  renderLivenessTable() {
    const tbody = this.dom.livenessTableBody;
    tbody.innerHTML = '';

    this.instructions.forEach(inst => {
      const tr = document.createElement('tr');

      const defsTags = Array.from(inst.defs).map(d => `<span class="tag def">${d}</span>`).join(' ') || '—';
      const usesTags = Array.from(inst.uses).map(u => `<span class="tag use">${u}</span>`).join(' ') || '—';
      const liveTags = Array.from(inst.liveOut).map(l => `<span class="tag live">${l}</span>`).join(' ') || '—';

      tr.innerHTML = `
        <td style="color: var(--text-dim);">${inst.index}</td>
        <td><code>${inst.raw}</code></td>
        <td>${defsTags}</td>
        <td>${usesTags}</td>
        <td>${liveTags}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  updateMetrics() {
    if (!this.allocResult) return;
    const res = this.allocResult;
    this.dom.metricRegs.textContent = `${res.numRegistersUsed} / ${this.K}`;
    this.dom.metricSpills.textContent = `${res.numSpills}`;
    this.dom.metricSpills.className = `value ${res.numSpills > 0 ? 'rose' : 'emerald'}`;
    this.dom.metricClique.textContent = `${res.maxClique}`;

    // Coalescing info
    const coalescedKeys = Object.keys(res.coalescedNodes);
    if (coalescedKeys.length > 0) {
      this.dom.coalesceInfoBox.innerHTML = `
        <b>Coalesced Variables:</b><br/>
        ${coalescedKeys.map(k => `<code>${k}</code> merged into <code>${res.coalescedNodes[k]}</code>`).join('<br/>')}
      `;
    } else {
      this.dom.coalesceInfoBox.innerHTML = '';
    }
  }

  updateAssemblyView() {
    if (!this.allocResult) return;
    const { lines, metrics, target } = generateAssembly(this.instructions, this.allocResult, this.targetArch);

    this.dom.asmTargetBadge.textContent = target;
    this.dom.asmStatsBadge.textContent = `Loads: ${metrics.loads} | Stores: ${metrics.stores} | Penalty: +${metrics.penaltyCycles} cyc`;
    this.dom.metricTraffic.textContent = `${metrics.loads + metrics.stores} ops`;

    const codeHtml = lines.map(line => {
      return `<span class="asm-line ${line.type}">${escapeHtml(line.text)}</span>`;
    }).join('\n');

    this.dom.asmDisplay.innerHTML = codeHtml;
  }

  stepForward() {
    if (this.currentStepIdx < this.allocResult.steps.length - 1) {
      this.renderStep(this.currentStepIdx + 1);
    }
  }

  stepBack() {
    if (this.currentStepIdx > 0) {
      this.renderStep(this.currentStepIdx - 1);
    }
  }

  resetPlayback() {
    this.pausePlay();
    this.renderStep(0);
  }

  solveAll() {
    this.pausePlay();
    this.renderStep(this.allocResult.steps.length - 1);
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pausePlay();
    } else {
      this.startPlay();
    }
  }

  startPlay() {
    this.isPlaying = true;
    this.dom.btnPlay.textContent = 'Pause ⏸';
    this.playTimer = setInterval(() => {
      if (this.currentStepIdx < this.allocResult.steps.length - 1) {
        this.stepForward();
      } else {
        this.pausePlay();
      }
    }, 700);
  }

  pausePlay() {
    this.isPlaying = false;
    this.dom.btnPlay.textContent = 'Play ⏯';
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.chromaApp = new ChromaApp();
});
