// Interactive Physics-based Canvas Graph Renderer for RIG

export const COLOR_PALETTE = {
  R0: { fill: '#06b6d4', glow: 'rgba(6, 182, 212, 0.6)', text: '#000000', label: 'R0 (t0/rax)' },
  R1: { fill: '#10b981', glow: 'rgba(16, 185, 129, 0.6)', text: '#000000', label: 'R1 (t1/rcx)' },
  R2: { fill: '#f59e0b', glow: 'rgba(245, 158, 11, 0.6)', text: '#000000', label: 'R2 (t2/rdx)' },
  R3: { fill: '#a855f7', glow: 'rgba(168, 85, 247, 0.6)', text: '#ffffff', label: 'R3 (t3/rsi)' },
  R4: { fill: '#ec4899', glow: 'rgba(236, 72, 153, 0.6)', text: '#ffffff', label: 'R4 (t4/rdi)' },
  R5: { fill: '#3b82f6', glow: 'rgba(59, 130, 246, 0.6)', text: '#ffffff', label: 'R5 (t5/r8)' },
  R6: { fill: '#14b8a6', glow: 'rgba(20, 184, 166, 0.6)', text: '#000000', label: 'R6 (a0/r9)' },
  R7: { fill: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.6)', text: '#ffffff', label: 'R7 (a1/r10)' }
};

export const SPILL_COLOR = {
  fill: '#ef4444',
  glow: 'rgba(239, 68, 68, 0.7)',
  text: '#ffffff',
  label: 'Spilled to RAM'
};

export const DEFAULT_NODE = {
  fill: '#334155',
  glow: 'rgba(51, 65, 85, 0.3)',
  text: '#f8fafc',
  label: 'Unallocated'
};

export class GraphRenderer {
  constructor(canvasElement, tooltipElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.tooltip = tooltipElement;

    this.nodes = new Map(); // id -> { id, x, y, vx, vy, radius, pinned, color, degree, cost }
    this.edges = [];        // [{ u, v, isCopy }]
    this.colors = {};
    this.highlightNode = null;
    this.hoverNode = null;
    this.activeNodesSet = null;

    // Pan & Zoom
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.draggedNode = null;

    this.animId = null;
    this.dpr = window.devicePixelRatio || 1;

    this.initEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
  }

  setGraph(ig, colors = {}, highlightNode = null, activeNodes = null) {
    this.colors = colors;
    this.highlightNode = highlightNode;
    this.activeNodesSet = activeNodes ? new Set(activeNodes) : null;

    // Retain existing node positions if present, else spawn around center
    const cx = this.width / 2;
    const cy = this.height / 2;
    const newNodes = new Map();

    const nodeArray = Array.from(ig.nodes);
    const count = nodeArray.length;

    nodeArray.forEach((id, idx) => {
      let existing = this.nodes.get(id);
      let angle = (idx / count) * 2 * Math.PI;
      let radiusOffset = 140 + (idx % 2) * 50;

      const nodeX = existing ? existing.x : cx + Math.cos(angle) * radiusOffset;
      const nodeY = existing ? existing.y : cy + Math.sin(angle) * radiusOffset;

      newNodes.set(id, {
        id,
        x: nodeX,
        y: nodeY,
        vx: 0,
        vy: 0,
        radius: 24,
        pinned: existing ? existing.pinned : false,
        degree: ig.degree(id),
        cost: ig.spillCosts.get(id) || 1.0
      });
    });

    this.nodes = newNodes;

    // Build edges
    this.edges = [];
    const seen = new Set();
    ig.adj.forEach((nbrs, u) => {
      nbrs.forEach(v => {
        const pairKey = [u, v].sort().join('--');
        if (!seen.has(pairKey)) {
          seen.add(pairKey);
          this.edges.push({ u, v, isCopy: false });
        }
      });
    });

    // Add copy pairs
    if (ig.copyPairs) {
      ig.copyPairs.forEach(pairStr => {
        const [u, v] = pairStr.split('<->');
        if (this.nodes.has(u) && this.nodes.has(v)) {
          this.edges.push({ u, v, isCopy: true });
        }
      });
    }

    if (!this.animId) {
      this.animate();
    }
  }

  updateState(colors, highlightNode, activeNodes) {
    this.colors = colors || {};
    this.highlightNode = highlightNode || null;
    this.activeNodesSet = activeNodes ? new Set(activeNodes) : null;
  }

  animate() {
    this.updatePhysics();
    this.draw();
    this.animId = requestAnimationFrame(() => this.animate());
  }

  updatePhysics() {
    const kRepel = 2400;
    const kSpring = 0.04;
    const restingLen = 130;
    const damping = 0.82;
    const centerAttract = 0.003;
    const cx = this.width / 2;
    const cy = this.height / 2;

    const nodeList = Array.from(this.nodes.values());

    // 1. Repulsion between all node pairs
    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const a = nodeList[i];
        const b = nodeList[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy + 0.1;
        const dist = Math.sqrt(distSq);

        if (dist < 400) {
          const force = kRepel / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (!a.pinned && a !== this.draggedNode) {
            a.vx -= fx;
            a.vy -= fy;
          }
          if (!b.pinned && b !== this.draggedNode) {
            b.vx += fx;
            b.vy += fy;
          }
        }
      }
    }

    // 2. Spring attraction along edges
    for (const edge of this.edges) {
      const a = this.nodes.get(edge.u);
      const b = this.nodes.get(edge.v);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - restingLen;
      const force = displacement * kSpring;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!a.pinned && a !== this.draggedNode) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.pinned && b !== this.draggedNode) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // 3. Center gravity & velocity integration
    for (const n of nodeList) {
      if (n === this.draggedNode || n.pinned) continue;

      // Attract to center
      n.vx += (cx - n.x) * centerAttract;
      n.vy += (cy - n.y) * centerAttract;

      n.vx *= damping;
      n.vy *= damping;

      n.x += n.vx;
      n.y += n.vy;

      // Constrain within visible boundary
      n.x = Math.max(50, Math.min(this.width - 50, n.x));
      n.y = Math.max(50, Math.min(this.height - 50, n.y));
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);

    // Apply Pan & Zoom
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // Draw background subtle grid dots
    this.drawGrid(ctx);

    // 1. Draw Edges
    for (const edge of this.edges) {
      const u = this.nodes.get(edge.u);
      const v = this.nodes.get(edge.v);
      if (!u || !v) continue;

      const isHovered = this.hoverNode && (this.hoverNode.id === u.id || this.hoverNode.id === v.id);
      const isDimmed = this.hoverNode && !isHovered;

      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(v.x, v.y);

      if (edge.isCopy) {
        // Coalescing copy candidate edge
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = isHovered ? '#c084fc' : (isDimmed ? 'rgba(192, 132, 252, 0.15)' : 'rgba(192, 132, 252, 0.6)');
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
      } else {
        ctx.setLineDash([]);
        if (isHovered) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.shadowColor = '#0284c7';
          ctx.shadowBlur = 8;
        } else if (isDimmed) {
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.15)';
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
        } else {
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
          ctx.lineWidth = 1.2;
          ctx.shadowBlur = 0;
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }

    // 2. Draw Nodes
    const pulseTime = Date.now() / 300;
    this.nodes.forEach(node => {
      const isVisible = !this.activeNodesSet || this.activeNodesSet.has(node.id);
      const isHighlight = this.highlightNode === node.id;
      const isHover = this.hoverNode && this.hoverNode.id === node.id;
      const colorKey = this.colors[node.id];

      let nodeColor = DEFAULT_NODE;
      if (colorKey) {
        if (colorKey.startsWith('R') && COLOR_PALETTE[colorKey]) {
          nodeColor = COLOR_PALETTE[colorKey];
        } else if (colorKey.startsWith('S')) {
          nodeColor = SPILL_COLOR;
        }
      }

      ctx.save();
      ctx.globalAlpha = isVisible ? 1.0 : 0.25;

      // Glow halo
      if (isHighlight) {
        const pulseRadius = node.radius + 12 + Math.sin(pulseTime) * 4;
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(238, 242, 255, 0.25)';
        ctx.fill();
      }

      // Outer Glow
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + (isHover ? 6 : 3), 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor.glow;
      ctx.fill();

      // Node Body Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor.fill;
      ctx.fill();

      // Border ring
      ctx.lineWidth = isHighlight || isHover ? 3 : 1.5;
      ctx.strokeStyle = isHighlight ? '#ffffff' : (colorKey && colorKey.startsWith('S') ? '#fca5a5' : '#0f172a');
      ctx.stroke();

      // Text Identifier (Variable name)
      ctx.fillStyle = nodeColor.text;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.id, node.x, node.y - (colorKey ? 4 : 0));

      // Sub-label for allocated register or spill slot
      if (colorKey) {
        ctx.fillStyle = nodeColor.text;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillText(colorKey, node.x, node.y + 8);
      }

      // Degree Badge in top-right of node
      const badgeX = node.x + node.radius * 0.75;
      const badgeY = node.y - node.radius * 0.75;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#38bdf8';
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = '8px monospace';
      ctx.fillText(`${node.degree}`, badgeX, badgeY);

      ctx.restore();
    });

    ctx.restore();
  }

  drawGrid(ctx) {
    const spacing = 40;
    const startX = Math.floor(-this.panX / (spacing * this.zoom)) * spacing;
    const startY = Math.floor(-this.panY / (spacing * this.zoom)) * spacing;
    const endX = startX + (this.width / this.zoom) + spacing * 2;
    const endY = startY + (this.height / this.zoom) + spacing * 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let x = startX; x < endX; x += spacing) {
      for (let y = startY; y < endY; y += spacing) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
  }

  initEvents() {
    window.addEventListener('resize', () => this.resize());

    // Mouse coordinates mapped to virtual canvas coords
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      return {
        x: (mouseX - this.panX) / this.zoom,
        y: (mouseY - this.panY) / this.zoom,
        rawX: e.clientX,
        rawY: e.clientY
      };
    };

    const findNodeAt = (pos) => {
      for (const node of this.nodes.values()) {
        const dx = node.x - pos.x;
        const dy = node.y - pos.y;
        if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 6) {
          return node;
        }
      }
      return null;
    };

    this.canvas.addEventListener('mousedown', (e) => {
      const pos = getPos(e);
      const hit = findNodeAt(pos);

      if (hit) {
        this.draggedNode = hit;
        hit.pinned = true;
      } else {
        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      const pos = getPos(e);

      if (this.draggedNode) {
        this.draggedNode.x = pos.x;
        this.draggedNode.y = pos.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
        return;
      }

      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        return;
      }

      // Hover check
      const hit = findNodeAt(pos);
      if (hit !== this.hoverNode) {
        this.hoverNode = hit;
        this.canvas.style.cursor = hit ? 'grab' : 'default';
        if (hit && this.tooltip) {
          const alloc = this.colors[hit.id] || 'Pending';
          this.tooltip.innerHTML = `
            <strong>Variable: ${hit.id}</strong><br/>
            Degree: <b>${hit.degree}</b><br/>
            Spill Cost: <b>${hit.cost}</b><br/>
            Target Reg: <span style="color:#38bdf8">${alloc}</span>
          `;
          this.tooltip.style.left = `${pos.rawX + 12}px`;
          this.tooltip.style.top = `${pos.rawY - 24}px`;
          this.tooltip.style.display = 'block';
        } else if (this.tooltip) {
          this.tooltip.style.display = 'none';
        }
      } else if (hit && this.tooltip) {
        this.tooltip.style.left = `${pos.rawX + 12}px`;
        this.tooltip.style.top = `${pos.rawY - 24}px`;
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.draggedNode) {
        this.draggedNode.pinned = false;
        this.draggedNode = null;
      }
      this.isPanning = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.4, Math.min(3.0, this.zoom * zoomFactor));

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;
    }, { passive: false });
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }
}
