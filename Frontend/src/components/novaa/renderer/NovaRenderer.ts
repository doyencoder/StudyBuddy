/**
 * NovaRenderer.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * WebGL2-based renderer for Nova. Replaces the previous SVG approach.
 *
 * Architecture overview:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  NovaRenderer                                        │
 *   │                                                      │
 *   │  WebGLProgram (shared by all geometry)               │
 *   │  ├── u_resolution  — canvas size (DPR-adjusted)      │
 *   │  ├── u_origin      — pixel position of (0,0)         │
 *   │  ├── u_scale       — pixels per math unit            │
 *   │  └── u_color       — current draw colour             │
 *   │                                                      │
 *   │  Grid VBOs                                           │
 *   │  ├── minorGridBuffer  (DYNAMIC_DRAW — updates often) │
 *   │  ├── majorGridBuffer  (DYNAMIC_DRAW)                 │
 *   │  └── axisBuffer       (DYNAMIC_DRAW)                 │
 *   │                                                      │
 *   │  Curve VBOs (one entry per equation id)              │
 *   │  └── Map<id, CurveEntry[]>                           │
 *   │       each entry = one continuous segment            │
 *   │       STATIC_DRAW — only updated on eq. change       │
 *   └─────────────────────────────────────────────────────┘
 *
 * Pan performance:
 *   Changing u_origin is ONE uniform write.
 *   No buffer changes, no CPU math. Renders at GPU speed.
 *
 * Zoom performance:
 *   Changing u_scale + u_origin is TWO uniform writes.
 *   Curve buffers remain unchanged until zoom exceeds 50% delta
 *   from the last sample, at which point curves are resampled at
 *   the new resolution and re-uploaded. Grid is always recomputed
 *   on viewport change (cheap: ~100 floats).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders';
import { MathEvaluator, type CurveEvaluator } from './MathEvaluator';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Viewport state in MATH coordinates. */
export interface Viewport {
  /** Pixel position of the math origin (0,0) — CSS pixels, pre-DPR. */
  originX: number;
  originY: number;
  /** CSS pixels per one math unit. */
  scale:   number;
  /** Canvas CSS dimensions. */
  width:   number;
  height:  number;
}

/** Everything NovaRenderer needs to know about one equation. */
export interface EquationDescriptor {
  id:        string;
  raw:       string;       // raw user string, e.g. "x^2 + y^2 = 9"
  color:     string;       // CSS variable key, e.g. "novaa-curve-1"
  visible:   boolean;
  fromChat:  boolean;      // dashed line treatment
}

/** One continuous plotted segment (no discontinuities). */
interface CurveSegment {
  buffer: WebGLBuffer;
  vao:    WebGLVertexArrayObject;
  count:  number;          // number of vertices in this segment
}

/** Internal per-equation data. */
interface CurveEntry {
  segments:    CurveSegment[];
  color:       [number, number, number, number];  // RGBA [0,1]
  opacity:     number;    // 1.0 normal, 0.65 from-chat
  evaluators:  CurveEvaluator[];
  // The viewport at which this curve was last sampled
  lastSampledScale:  number;
  lastSampledXMin:   number;
  lastSampledXMax:   number;
}

/** Simple VAO+buffer pair for grid geometry. */
interface GridBuffer {
  buffer: WebGLBuffer;
  vao:    WebGLVertexArrayObject;
  count:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Parse an HSL CSS variable value ("210 100% 60%") into RGBA [0,1]. */
function cssVarToRGBA(varName: string, alpha: number = 1): [number, number, number, number] {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(`--${varName}`)
      .trim();
    if (!raw) return [0.5, 0.5, 1, alpha];

    // Format: "210 100% 60%" — degrees, percent, percent
    const parts = raw.split(/\s+/);
    const h = parseFloat(parts[0]) / 360;
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;

    return [...hslToRgb(h, s, l), alpha] as [number, number, number, number];
  } catch {
    return [0.5, 0.5, 1, alpha];
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1/3), hue2rgb(h), hue2rgb(h - 1/3)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Curve sampling
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_COUNT = 2000;  // points per curve per visible range
const SAMPLE_MARGIN = 2.0;  // sample 200% beyond visible so panning never hits curve ends

/**
 * sampleCurve
 * Evaluates fn(x) across [xMin, xMax] with SAMPLE_COUNT uniform steps.
 * Splits the result at discontinuities (large y jumps or undefined values).
 * Returns an array of Float32Arrays, each being a continuous segment:
 *   [x0, y0, x1, y1, ...]
 */
function sampleCurve(
  fn:    (x: number) => number | null,
  xMin:  number,
  xMax:  number,
  yMin:  number,
  yMax:  number,
): Float32Array[] {
  const segments: Float32Array[] = [];
  let current: number[] = [];
  let prevY: number | null = null;
  const step    = (xMax - xMin) / SAMPLE_COUNT;
  const yRange  = Math.abs(yMax - yMin);
  const yBuffer = yRange * 4;  // how far outside visible range we still record

  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const x = xMin + i * step;
    const y = fn(x);

    // ── Invalid point: break the current segment ────────────────────────────
    if (y === null || !isFinite(y) || isNaN(y)
        || y < yMin - yBuffer || y > yMax + yBuffer) {
      if (current.length >= 4) {  // need at least 2 points for a line
        segments.push(new Float32Array(current));
      }
      current = [];
      prevY   = null;
      continue;
    }

    // ── Discontinuity detection: large jump → break segment ─────────────────
    // Threshold: 60% of visible y range. Catches tan(x) asymptotes, 1/x, etc.
    if (prevY !== null && Math.abs(y - prevY) > yRange * 0.6) {
      if (current.length >= 4) {
        segments.push(new Float32Array(current));
      }
      current = [];
    }

    current.push(x, y);
    prevY = y;
  }

  // Flush the last segment
  if (current.length >= 4) {
    segments.push(new Float32Array(current));
  }

  return segments;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid geometry builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a "nice" grid step for the given pixels-per-unit scale.
 * densityDivisor: higher = more grid lines. 1 = normal, 2 = double density, 0.5 = half.
 * Default minPixels is 30 (denser than before — was 50).
 */
function niceGridStep(scale: number, densityDivisor: number = 1): number {
  const minPixels = 30 / densityDivisor;  // smaller → more lines
  const raw = minPixels / scale;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n   = raw / mag;
  if (n <= 1) return mag;
  if (n <= 2) return 2 * mag;
  if (n <= 5) return 5 * mag;
  return 10 * mag;
}

interface GridGeometry {
  minor: Float32Array;
  major: Float32Array;
  axis:  Float32Array;
}

/** Build grid line geometry in math coordinates. */
function buildGridGeometry(vp: Viewport, densityDivisor: number = 1): GridGeometry {
  const { originX, originY, scale, width, height } = vp;

  const xMin = (0       - originX) / scale;
  const xMax = (width   - originX) / scale;
  const yMin = (originY - height)  / scale;
  const yMax = (originY - 0)       / scale;

  const step      = niceGridStep(scale, densityDivisor);
  const majorStep = step * 5;
  const margin    = step;  // extend slightly beyond visible area

  const minor: number[] = [];
  const major: number[] = [];
  const axis:  number[] = [];

  // Vertical lines
  const xStart = Math.floor((xMin - margin) / step) * step;
  for (let v = xStart; v <= xMax + margin; v += step) {
    const r = Math.round(v * 1e8) / 1e8;
    const isAxis  = Math.abs(r) < step * 0.001;
    const isMajor = !isAxis && Math.abs(r % majorStep) < step * 0.01;

    const bucket = isAxis ? axis : isMajor ? major : minor;
    bucket.push(r, yMin - margin, r, yMax + margin);
  }

  // Horizontal lines
  const yStart = Math.floor((yMin - margin) / step) * step;
  for (let v = yStart; v <= yMax + margin; v += step) {
    const r = Math.round(v * 1e8) / 1e8;
    const isAxis  = Math.abs(r) < step * 0.001;
    const isMajor = !isAxis && Math.abs(r % majorStep) < step * 0.01;

    const bucket = isAxis ? axis : isMajor ? major : minor;
    bucket.push(xMin - margin, r, xMax + margin, r);
  }

  return {
    minor: new Float32Array(minor),
    major: new Float32Array(major),
    axis:  new Float32Array(axis),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tick label builder (used by React component for HTML overlay)
// ─────────────────────────────────────────────────────────────────────────────

export interface TickLabel {
  x:      number;  // CSS pixel position
  y:      number;
  text:   string;
  anchor: 'middle' | 'end';
}

function fmtNum(v: number): string {
  const r = Math.round(v * 10000) / 10000;
  if (Number.isInteger(r)) return String(r);
  if (Math.abs(r) >= 100) return r.toFixed(0);
  if (Math.abs(r) >= 10)  return r.toFixed(1);
  return r.toPrecision(3).replace(/\.?0+$/, '');
}

export function buildTickLabels(vp: Viewport, densityDivisor: number = 1): TickLabel[] {
  const { originX, originY, scale, width, height } = vp;

  const xMin = (0       - originX) / scale;
  const xMax = (width   - originX) / scale;
  const yMin = (originY - height)  / scale;
  const yMax = (originY - 0)       / scale;

  const step      = niceGridStep(scale, densityDivisor);
  const majorStep = step * 5;
  const labels: TickLabel[] = [];

  // X-axis tick labels
  const xStart = Math.floor(xMin / majorStep) * majorStep;
  for (let v = xStart; v <= xMax + majorStep; v += majorStep) {
    const r  = Math.round(v * 10000) / 10000;
    if (Math.abs(r) < step * 0.001) continue;  // skip zero

    const sx = originX + r * scale;
    if (sx < 16 || sx > width - 16) continue;

    const sy = Math.max(16, Math.min(height - 6, originY + 14));
    labels.push({ x: sx, y: sy, text: fmtNum(r), anchor: 'middle' });
  }

  // Y-axis tick labels
  const yStart = Math.floor(yMin / majorStep) * majorStep;
  for (let v = yStart; v <= yMax + majorStep; v += majorStep) {
    const r  = Math.round(v * 10000) / 10000;
    if (Math.abs(r) < step * 0.001) continue;

    const sy = originY - r * scale;
    if (sy < 10 || sy > height - 10) continue;

    const sx = Math.max(4, Math.min(width - 28, originX - 6));
    labels.push({ x: sx, y: sy + 4, text: fmtNum(r), anchor: 'end' });
  }

  return labels;
}

// ─────────────────────────────────────────────────────────────────────────────
// WebGL helpers
// ─────────────────────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${err}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER,   VERTEX_SHADER);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const prog  = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${err}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return prog;
}

/**
 * createVAO
 * Create a VAO+VBO for a Float32Array of interleaved [x, y, x, y, ...] data.
 * Returns the VAO (which encodes the binding) and the underlying VBO.
 */
function createVAO(
  gl:       WebGL2RenderingContext,
  prog:     WebGLProgram,
  data:     Float32Array,
  usage:    number,  // gl.STATIC_DRAW or gl.DYNAMIC_DRAW
): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } {
  const vao    = gl.createVertexArray()!;
  const buffer = gl.createBuffer()!;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);

  const loc = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return { vao, buffer };
}

// ─────────────────────────────────────────────────────────────────────────────
// NovaRenderer
// ─────────────────────────────────────────────────────────────────────────────

export class NovaRenderer {
  private gl!:       WebGL2RenderingContext;
  private program!:  WebGLProgram;
  private dpr:       number = 1;

  // Uniform locations (cached for performance — lookup is slow)
  private uResolution!: WebGLUniformLocation;
  private uOrigin!:     WebGLUniformLocation;
  private uScale!:      WebGLUniformLocation;
  private uColor!:      WebGLUniformLocation;

  // Grid geometry — three separate buffers for different opacity levels
  private minorGrid: GridBuffer | null = null;
  private majorGrid: GridBuffer | null = null;
  private axisLines: GridBuffer | null = null;

  // Equation curve data
  private curves    = new Map<string, CurveEntry>();
  // Preserve insertion order for deterministic draw order
  private curveOrder: string[] = [];

  // Math evaluator (caches compiled functions)
  private evaluator = new MathEvaluator();

  // Current viewport (CSS pixel values, DPR-independent)
  private viewport!: Viewport;

  // Grid density divisor: 1 = default, 2 = double lines, 0.5 = half
  private gridDensity: number = 1.5;  // default denser than before

  // ── Initialisation ──────────────────────────────────────────────────────────

  /**
   * init
   * Set up the WebGL2 context, compile shaders, enable blending.
   * Must be called once before any other method.
   * Returns false if WebGL2 is not supported (caller should show fallback).
   */
  init(canvas: HTMLCanvasElement): boolean {
    const gl = canvas.getContext('webgl2', {
      antialias:              true,
      premultipliedAlpha:     false,
      preserveDrawingBuffer:  false,
    });
    if (!gl) return false;

    this.gl = gl;
    this.program = createProgram(gl);

    // Cache uniform locations
    this.uResolution = gl.getUniformLocation(this.program, 'u_resolution')!;
    this.uOrigin     = gl.getUniformLocation(this.program, 'u_origin')!;
    this.uScale      = gl.getUniformLocation(this.program, 'u_scale')!;
    this.uColor      = gl.getUniformLocation(this.program, 'u_color')!;

    // Enable alpha blending for smooth antialiased lines and transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return true;
  }

  /**
   * resize
   * Update the WebGL viewport when the canvas container size changes.
   * Must pass physical pixels (CSS pixels × DPR) as width/height.
   */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    const gl = this.gl;
    gl.viewport(0, 0, cssWidth * dpr, cssHeight * dpr);
  }

  // ── Viewport management ─────────────────────────────────────────────────────

  /**
   * setViewport
   * Update the current viewport. All subsequent render() calls use this.
   *
   * When to call:
   *   - On pan:  always
   *   - On zoom: always; also call checkResample() to rebuild curves if needed
   */
  setViewport(vp: Viewport): void {
    this.viewport = vp;
    this.rebuildGrid(vp);
  }

  /**
   * setGridDensity
   * Change grid line density. Rebuilds grid geometry immediately.
   * @param density  1 = normal, 2 = double density, 0.5 = sparse
   */
  setGridDensity(density: number): void {
    this.gridDensity = density;
    if (this.viewport) this.rebuildGrid(this.viewport);
  }

  /**
   * checkResample
   * Call after a zoom change. If scale has changed by more than 40% since
   * the last sample, re-evaluates all curve functions at the new scale.
   * (We don't resample on every zoom step — that would be too slow during
   * a pinch gesture. We wait for a significant change.)
   */
  checkResample(): void {
    const vp = this.viewport;
    const xMin = (0          - vp.originX) / vp.scale;
    const xMax = (vp.width   - vp.originX) / vp.scale;
    const yMin = (vp.originY - vp.height)  / vp.scale;
    const yMax = (vp.originY - 0)          / vp.scale;

    for (const [id, entry] of this.curves) {
      const scaleDelta = Math.abs(vp.scale - entry.lastSampledScale)
                       / Math.max(entry.lastSampledScale, 1);
      // Trigger resample when visible range is within 10% of sampled edges
      const xRange = xMax - xMin;
      const rangeExtended = xMin < entry.lastSampledXMin + xRange * 0.1
                         || xMax > entry.lastSampledXMax - xRange * 0.1;

      if (scaleDelta > 0.3 || rangeExtended) {
        this.resampleCurve(id, entry, vp, xMin, xMax, yMin, yMax);
      }
    }
  }

  // ── Equation management ─────────────────────────────────────────────────────

  /**
   * upsertEquation
   * Add or update an equation in the renderer.
   * Compiles the math function and samples it to GPU buffers.
   */
  upsertEquation(desc: EquationDescriptor): void {
    const evaluators = this.evaluator.getEvaluators(desc.raw);
    const color      = cssVarToRGBA(desc.color, desc.fromChat ? 0.65 : 1.0);

    // Compute current visible math range for initial sampling
    const vp   = this.viewport ?? { originX: 0, originY: 0, scale: 60, width: 800, height: 600 };
    const xMin = (0        - vp.originX) / vp.scale;
    const xMax = (vp.width - vp.originX) / vp.scale;
    const yMin = (vp.originY - vp.height) / vp.scale;
    const yMax = (vp.originY - 0)         / vp.scale;

    const margin = (xMax - xMin) * SAMPLE_MARGIN;

    const segments = this.buildCurveSegments(
      evaluators,
      xMin - margin, xMax + margin,
      yMin, yMax,
    );

    // Free old buffers for this id if they exist
    this.freeCurveBuffers(desc.id);

    const entry: CurveEntry = {
      segments,
      color,
      opacity:              desc.fromChat ? 0.65 : 1.0,
      evaluators,
      lastSampledScale:     vp.scale,
      lastSampledXMin:      xMin - margin,
      lastSampledXMax:      xMax + margin,
    };

    if (!this.curves.has(desc.id)) {
      this.curveOrder.push(desc.id);
    }
    this.curves.set(desc.id, entry);
  }

  /**
   * removeEquation
   * Delete an equation and free its GPU buffers.
   */
  removeEquation(id: string): void {
    this.freeCurveBuffers(id);
    this.curves.delete(id);
    this.curveOrder = this.curveOrder.filter(k => k !== id);
  }

  /**
   * setEquationVisible
   * Toggle visibility without resampling (cheap — just a flag).
   */
  setEquationVisible(id: string, visible: boolean): void {
    // Visibility is checked in render() — nothing to do in the buffer
    const entry = this.curves.get(id);
    if (entry) {
      entry.color[3] = visible ? entry.opacity : 0;
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /**
   * render
   * Draw everything. Very fast — just uniform updates + draw calls.
   * This is the hot path: called on every pan/zoom frame.
   */
  /**
   * render
   * @param visible    Set of equation ids that are currently visible.
   * @param hoveredId  Optional id of the equation the cursor is hovering over.
   *
   * Line thickness strategy:
   *   WebGL2 spec caps gl.lineWidth at 1.0 on virtually all implementations.
   *   To simulate thicker lines we draw each primitive multiple times with
   *   sub-pixel origin offsets. 3 passes → visually ~2px. 5 passes → ~3px.
   *   Axes: 4 passes. Hovered curve: 5 passes. Normal curve: 3 passes.
   */
  render(visible: Set<string>, hoveredId?: string): void {
    const { gl, program, viewport: vp, dpr } = this;
    if (!vp) return;

    const physW = vp.width  * dpr;
    const physH = vp.height * dpr;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    const baseOriginX = vp.originX * dpr;
    const baseOriginY = vp.originY * dpr;

    // Helper: set origin with an optional sub-pixel offset (in physical px)
    const setOrigin = (ox = 0, oy = 0) => {
      gl.uniform2f(this.uOrigin, baseOriginX + ox, baseOriginY + oy);
    };

    // Restore base origin after multi-pass rendering
    const restoreOrigin = () => setOrigin(0, 0);

    // Update shared viewport uniforms
    gl.uniform2f(this.uResolution, physW, physH);
    setOrigin();
    gl.uniform1f(this.uScale, vp.scale * dpr);

    // ── Grid: minor then major ───────────────────────────────────────────────
    if (this.minorGrid) {
      this.drawGeometry(this.minorGrid, [0.3, 0.35, 0.45, 0.3], gl.LINES);
    }
    if (this.majorGrid) {
      this.drawGeometry(this.majorGrid, [0.3, 0.35, 0.45, 0.55], gl.LINES);
    }

    // ── Axes: 4-pass for visual ~2.5px thickness ─────────────────────────────
    if (this.axisLines) {
      const axisColor: [number,number,number,number] = [0.6, 0.65, 0.75, 0.7];
      const axisOffsets = [[0,0],[0.5,0],[-0.5,0],[0,0.5]] as const;
      for (const [ox, oy] of axisOffsets) {
        setOrigin(ox, oy);
        this.drawGeometry(this.axisLines, axisColor, gl.LINES);
      }
      restoreOrigin();
    }

    // ── Curves ───────────────────────────────────────────────────────────────
    // Normal curves: 3 passes (simulates ~2px).
    // Hovered curve: 5 passes (simulates ~3px) + soft glow first pass.
    // Normal: 6 passes → visually ~3px thick
    const normalOffsets = [[0,0],[1.2,0],[-1.2,0],[0,1.2],[0,-1.2],[0.8,0.8]] as const;
    // Hovered: 8 passes → visually ~4px thick
    const hoverOffsets  = [[0,0],[1.5,0],[-1.5,0],[0,1.5],[0,-1.5],[1.0,1.0],[-1.0,1.0],[1.0,-1.0]] as const;

    for (const id of this.curveOrder) {
      if (!visible.has(id)) continue;
      const entry = this.curves.get(id);
      if (!entry || entry.color[3] === 0) continue;

      const isHovered = id === hoveredId;
      const offsets   = isHovered ? hoverOffsets : normalOffsets;
      const [r, g, b, a] = entry.color;

      // Optional soft glow pass for hovered curve (drawn before main passes)
      if (isHovered) {
        setOrigin(0, 0);
        gl.uniform4fv(this.uColor, [r, g, b, a * 0.25]);
        for (const seg of entry.segments) {
          if (seg.count < 2) continue;
          gl.bindVertexArray(seg.vao);
          // Draw glow with slightly offset origins for a halo effect
          for (const [ox, oy] of [[3.0,0],[-3.0,0],[0,3.0],[0,-3.0]] as const) {
            setOrigin(ox, oy);
            gl.drawArrays(gl.LINE_STRIP, 0, seg.count);
          }
          gl.bindVertexArray(null);
        }
      }

      // Main passes (multi-offset for thickness)
      gl.uniform4fv(this.uColor, [r, g, b, a]);
      for (const [ox, oy] of offsets) {
        setOrigin(ox, oy);
        for (const seg of entry.segments) {
          if (seg.count < 2) continue;
          gl.bindVertexArray(seg.vao);
          gl.drawArrays(gl.LINE_STRIP, 0, seg.count);
          gl.bindVertexArray(null);
        }
      }
      restoreOrigin();
    }
  }

  // ── Hover detection (CPU — for tooltip) ────────────────────────────────────

  /**
   * getCurveYAtX
   * Returns the y value of the first matching equation at a given x.
   * Used by the React component to position the hover tooltip.
   */
  getCurveYAtX(
    id:     string,
    mathX:  number,
    mathY:  number,
    pixThreshold: number,
    scale:  number,
  ): number | null {
    const entry = this.curves.get(id);
    if (!entry) return null;

    for (const ev of entry.evaluators) {
      const y = ev.fn(mathX);
      if (y === null) continue;
      const pixelDist = Math.abs(mathY - y) * scale;
      if (pixelDist < pixThreshold) return y;
    }
    return null;
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  destroy(): void {
    const { gl } = this;
    // Free all curve buffers
    for (const id of [...this.curves.keys()]) {
      this.freeCurveBuffers(id);
    }
    // Free grid buffers
    for (const g of [this.minorGrid, this.majorGrid, this.axisLines]) {
      if (g) { gl.deleteBuffer(g.buffer); gl.deleteVertexArray(g.vao); }
    }
    gl.deleteProgram(this.program);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private drawGeometry(
    gb:    GridBuffer,
    color: [number, number, number, number],
    mode:  number,
  ): void {
    const { gl } = this;
    gl.uniform4fv(this.uColor, color);
    gl.bindVertexArray(gb.vao);
    gl.drawArrays(mode, 0, gb.count);
    gl.bindVertexArray(null);
  }

  /** Build segment buffers from evaluators over [xMin,xMax]. */
  private buildCurveSegments(
    evaluators: CurveEvaluator[],
    xMin: number, xMax: number,
    yMin: number, yMax: number,
  ): CurveSegment[] {
    const { gl, program } = this;
    const segments: CurveSegment[] = [];

    for (const ev of evaluators) {
      const arrays = sampleCurve(ev.fn, xMin, xMax, yMin, yMax);
      for (const data of arrays) {
        const { vao, buffer } = createVAO(gl, program, data, gl.STATIC_DRAW);
        segments.push({ vao, buffer, count: data.length / 2 });
      }
    }

    return segments;
  }

  /** Resample a curve at the current viewport and upload new buffers. */
  private resampleCurve(
    id:    string,
    entry: CurveEntry,
    vp:    Viewport,
    xMin:  number, xMax:  number,
    yMin:  number, yMax:  number,
  ): void {
    const margin = (xMax - xMin) * SAMPLE_MARGIN;
    const sxMin  = xMin - margin;
    const sxMax  = xMax + margin;

    // Free old segment buffers
    this.freeSegments(entry.segments);

    entry.segments          = this.buildCurveSegments(entry.evaluators, sxMin, sxMax, yMin, yMax);
    entry.lastSampledScale  = vp.scale;
    entry.lastSampledXMin   = sxMin;
    entry.lastSampledXMax   = sxMax;
  }

  /** Rebuild the three grid VBOs from current viewport. */
  private rebuildGrid(vp: Viewport): void {
    const { gl, program } = this;
    const geo = buildGridGeometry(vp, this.gridDensity);

    const upload = (data: Float32Array, existing: GridBuffer | null): GridBuffer => {
      if (existing) {
        // Reuse existing buffer — just update data (DYNAMIC_DRAW)
        gl.bindVertexArray(existing.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, existing.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.bindVertexArray(null);
        return { ...existing, count: data.length / 2 };
      }
      const { vao, buffer } = createVAO(gl, program, data, gl.DYNAMIC_DRAW);
      return { vao, buffer, count: data.length / 2 };
    };

    this.minorGrid = upload(geo.minor, this.minorGrid);
    this.majorGrid = upload(geo.major, this.majorGrid);
    this.axisLines = upload(geo.axis,  this.axisLines);
  }

  private freeSegments(segments: CurveSegment[]): void {
    for (const seg of segments) {
      this.gl.deleteBuffer(seg.buffer);
      this.gl.deleteVertexArray(seg.vao);
    }
  }

  private freeCurveBuffers(id: string): void {
    const entry = this.curves.get(id);
    if (entry) this.freeSegments(entry.segments);
  }
}