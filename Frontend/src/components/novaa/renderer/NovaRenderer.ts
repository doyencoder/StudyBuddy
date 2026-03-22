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

// Vite worker import — bundled as a separate chunk, loaded lazily
// ?worker tells Vite to treat this as a Web Worker module
import MarchingSquaresWorker from './marchingSquares.worker?worker';

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
  count:  number;
}

/** Internal per-equation data. */
interface CurveEntry {
  segments:    CurveSegment[];
  color:       [number, number, number, number];
  opacity:     number;
  fromChat:    boolean;
  evaluators:  CurveEvaluator[];
  isImplicit:  boolean;   // true = rendered via marching squares worker
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
 *
 * Endpoint bisection (both entry and exit):
 *   At a null→valid transition (domain entry, e.g. left tip of ellipse) and a
 *   valid→null transition (domain exit, e.g. right tip), we bisect 10 times to
 *   find the exact boundary. Both halves of the ellipse converge to the same
 *   (±a, 0) point, closing the gap completely.
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
  let prevY:    number | null = null;
  let prevX:    number = xMin;
  let prevNullX: number = xMin - (xMax - xMin) / SAMPLE_COUNT; // tracks last null x
  const step    = (xMax - xMin) / SAMPLE_COUNT;
  const yRange  = Math.abs(yMax - yMin);
  const yBuffer = yRange * 4;

  const ITERS = 10; // bisection iterations → precision of step/1024

  // valid→null: find the last valid point approaching the boundary from inside
  const bisectExit = (lo: number, hi: number): [number, number] | null => {
    let bestX = lo;
    let bestY = fn(lo);
    if (bestY === null || !isFinite(bestY)) return null;
    for (let k = 0; k < ITERS; k++) {
      const mid = (lo + hi) / 2;
      const y   = fn(mid);
      if (y !== null && isFinite(y) && !isNaN(y)) { lo = mid; bestX = mid; bestY = y; }
      else { hi = mid; }
    }
    return [bestX, bestY as number];
  };

  // null→valid: find the first valid point approaching the boundary from outside
  const bisectEntry = (lo: number, hi: number): [number, number] | null => {
    let bestX = hi;
    let bestY = fn(hi);
    if (bestY === null || !isFinite(bestY as number)) return null;
    for (let k = 0; k < ITERS; k++) {
      const mid = (lo + hi) / 2;
      const y   = fn(mid);
      if (y !== null && isFinite(y) && !isNaN(y)) { hi = mid; bestX = mid; bestY = y; }
      else { lo = mid; }
    }
    return [bestX, bestY as number];
  };

  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const x = xMin + i * step;
    const y = fn(x);

    // ── Invalid point ────────────────────────────────────────────────────────
    if (y === null || !isFinite(y) || isNaN(y)
        || y < yMin - yBuffer || y > yMax + yBuffer) {

      // valid→null: bisect to find exact exit point before breaking segment
      if (current.length >= 2 && prevY !== null) {
        const pt = bisectExit(prevX, x);
        if (pt) {
          const lastX = current[current.length - 2];
          const lastY = current[current.length - 1];
          if (Math.abs(pt[0] - lastX) > step * 0.01 || Math.abs(pt[1] - lastY) > 1e-9) {
            current.push(pt[0], pt[1]);
          }
        }
      }

      if (current.length >= 4) segments.push(new Float32Array(current));
      current   = [];
      prevNullX = x;
      prevY     = null;
      continue;
    }

    // ── Discontinuity: large jump — hard break, no bisection ────────────────
    if (prevY !== null && Math.abs(y - prevY) > yRange * 0.6) {
      if (current.length >= 4) segments.push(new Float32Array(current));
      current = [];
      // prevY stays non-null so next point doesn't trigger entry bisection
    }

    // ── null→valid: bisect to find exact entry point ─────────────────────────
    if (prevY === null && i > 0) {
      const pt = bisectEntry(prevNullX, x);
      if (pt) current.push(pt[0], pt[1]);
    }

    current.push(x, y);
    prevX = x;
    prevY = y;
  }

  if (current.length >= 4) segments.push(new Float32Array(current));
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
// Axis arrowhead geometry builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildArrowGeometry
 * Builds two small filled triangles (one per axis) in math coordinates.
 * Drawn with gl.TRIANGLES — no lineWidth needed.
 *
 * X-axis arrowhead: points right, tip at the screen's right edge.
 * Y-axis arrowhead: points up (positive math-Y = top of screen).
 *
 * Both are only included when their respective axis is visible on screen.
 * If an axis is off-screen the triangle still gets computed but will be
 * clipped by WebGL — the visibility guard is just an optimisation.
 *
 * Arrow dimensions (CSS pixels):
 *   length = 10px from base to tip
 *   half-width = 5.5px at the base
 */
function buildArrowGeometry(vp: Viewport): Float32Array {
  const { originX, originY, scale, width, height } = vp;
  const pts: number[] = [];

  // ── X-axis arrowhead ──────────────────────────────────────────────────────
  // Axis is visible when the horizontal axis (y=0 in math, screen-y=originY)
  // crosses the canvas vertically.
  if (originY >= 0 && originY <= height) {
    // Tip: right edge of canvas minus a small margin
    const tipX  = (width  - 4  - originX) / scale;
    // Base: 10px left of tip, ±5.5px vertically
    const baseX = (width  - 14 - originX) / scale;
    const baseYT =  5.5 / scale;   // top base vertex (positive math-Y)
    const baseYB = -5.5 / scale;   // bottom base vertex
    pts.push(
      tipX, 0,          // tip (on x-axis, y=0)
      baseX, baseYT,    // upper-left
      baseX, baseYB,    // lower-left
    );
  }

  // ── Y-axis arrowhead ──────────────────────────────────────────────────────
  // Axis is visible when the vertical axis (x=0 in math, screen-x=originX)
  // crosses the canvas horizontally.
  if (originX >= 0 && originX <= width) {
    // Tip: 4px from top of canvas (small margin)
    const tipY  = (originY - 4)  / scale;   // positive math-Y (up)
    // Base: 10px below tip in screen space = smaller math-Y
    const baseY = (originY - 14) / scale;
    const baseXR =  5.5 / scale;   // right base vertex
    const baseXL = -5.5 / scale;   // left base vertex
    pts.push(
      0,      tipY,    // tip (on y-axis, x=0)
      baseXR, baseY,   // lower-right
      baseXL, baseY,   // lower-left
    );
  }

  return new Float32Array(pts);
}

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
  private uDashed!:     WebGLUniformLocation;  // 0=solid, 1=dashed (from-chat)

  // Grid geometry — three separate buffers for different opacity levels
  private minorGrid:   GridBuffer | null = null;
  private majorGrid:   GridBuffer | null = null;
  private axisLines:   GridBuffer | null = null;
  private axisArrows:  GridBuffer | null = null;  // filled triangles, gl.TRIANGLES

  // Equation curve data
  private curves    = new Map<string, CurveEntry>();
  // Preserve insertion order for deterministic draw order
  private curveOrder: string[] = [];

  // Math evaluator (caches compiled functions)
  private evaluator = new MathEvaluator();

  // Web Worker for marching squares (implicit curves that can't be solved analytically)
  private worker: Worker | null = null;
  // Pending worker callbacks: job id → callback when segments arrive
  private workerCallbacks = new Map<string, (segs: Float32Array) => void>();

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
    this.uDashed     = gl.getUniformLocation(this.program, 'u_dashed')!;

    // Enable alpha blending for smooth antialiased lines and transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Spawn marching squares worker
    try {
      this.worker = new MarchingSquaresWorker();
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, segments } = e.data as { id: string; segments: Float32Array };
        const cb = this.workerCallbacks.get(id);
        if (cb) {
          this.workerCallbacks.delete(id);
          cb(segments);
        }
      };
    } catch {
      // Worker unavailable (e.g. in test env) — implicit curves won't render
      this.worker = null;
    }

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
      if (entry.isImplicit) continue;  // implicit curves handled by worker, not resample
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
   *
   * Fast path (analytical):  explicit y=f(x), y² implicit, linear implicit
   *   → compile once, sample to GPU buffer synchronously
   *
   * Slow path (marching squares):  y^3=x^2, sin(xy)=0.5, anything else
   *   → post to Web Worker, receive Float32Array of line segments, upload to GPU
   *   → renders at GPU speed after the first ~10ms worker compute
   */
  upsertEquation(desc: EquationDescriptor, onReady?: () => void): void {
    const evaluators = this.evaluator.getEvaluators(desc.raw);
    const color      = cssVarToRGBA(desc.color, desc.fromChat ? 0.65 : 1.0);
    const vp         = this.viewport ?? { originX: 0, originY: 0, scale: 60, width: 800, height: 600 };

    const xMin = (0        - vp.originX) / vp.scale;
    const xMax = (vp.width - vp.originX) / vp.scale;
    const yMin = (vp.originY - vp.height) / vp.scale;
    const yMax = (vp.originY - 0)         / vp.scale;

    // Free old buffers for this id
    this.freeCurveBuffers(desc.id);

    if (evaluators.length > 0) {
      // ── Fast analytical path ──────────────────────────────────────────────
      const margin   = (xMax - xMin) * SAMPLE_MARGIN;
      const segments = this.buildCurveSegments(
        evaluators, xMin - margin, xMax + margin, yMin, yMax,
      );

      const entry: CurveEntry = {
        segments, color,
        opacity:          desc.fromChat ? 0.65 : 1.0,
        fromChat:         desc.fromChat,
        isImplicit:       false,
        evaluators,
        lastSampledScale: vp.scale,
        lastSampledXMin:  xMin - margin,
        lastSampledXMax:  xMax + margin,
      };

      if (!this.curves.has(desc.id)) this.curveOrder.push(desc.id);
      this.curves.set(desc.id, entry);

    } else {
      // ── Marching squares path ─────────────────────────────────────────────
      // Insert a placeholder entry immediately so the equation shows in the
      // panel with correct color. Segments will be filled when worker replies.
      const placeholder: CurveEntry = {
        segments:         [],
        color, opacity:   desc.fromChat ? 0.65 : 1.0,
        fromChat:         desc.fromChat,
        isImplicit:       true,
        evaluators:       [],
        lastSampledScale: vp.scale,
        lastSampledXMin:  xMin,
        lastSampledXMax:  xMax,
      };

      if (!this.curves.has(desc.id)) this.curveOrder.push(desc.id);
      this.curves.set(desc.id, placeholder);

      if (!this.worker) return;  // worker unavailable — can't render

      // Extend sampling range by SAMPLE_MARGIN so panning doesn't show gaps
      const margin = (xMax - xMin) * SAMPLE_MARGIN;
      const jobId  = `${desc.id}-${Date.now()}`;

      this.workerCallbacks.set(jobId, (segsFlat: Float32Array) => {
        const entry = this.curves.get(desc.id);
        if (!entry) return;  // equation was removed while worker was computing

        // Upload all segments to GPU as a single VBO
        // (marching squares returns [x0,y0, x1,y1, ...] pairs — each pair is a segment)
        this.freeSegments(entry.segments);
        const newSegs = this.uploadImplicitSegments(segsFlat);
        entry.segments          = newSegs;
        entry.lastSampledScale  = vp.scale;
        entry.lastSampledXMin   = xMin - margin;
        entry.lastSampledXMax   = xMax + margin;

        onReady?.();
      });

      // For implicit curves, extend x range for pan smoothness but keep y range tight.
      // A large y range causes asymptotic curves (x*y=1) to draw far-off-screen
      // branches that render as vertical artifacts near discontinuities.
      const xMargin = (xMax - xMin) * SAMPLE_MARGIN;
      const yMargin = (yMax - yMin) * 1.0;  // 100% y buffer — needed for y^(2/3)=x and hyperbolas

      this.worker.postMessage({
        id:   jobId,
        raw:  desc.raw,
        xMin: xMin - xMargin,
        xMax: xMax + xMargin,
        yMin: yMin - yMargin,
        yMax: yMax + yMargin,
      });
    }
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
   *
   * Dashed curves (from-chat):
   *   u_dashed=1.0 activates a gl_FragCoord-based diagonal stipple in the
   *   fragment shader. Because gl_FragCoord is in physical pixels (not the
   *   shifted per-pass origin), every pass discards the same set of fragments
   *   → clean dashes even with multi-pass thickness rendering.
   *   Glow passes always use u_dashed=0.0 (solid) — a dashed glow looks wrong.
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

    // Grid and axes are always solid
    gl.uniform1f(this.uDashed, 0.0);

    // ── Grid: minor then major ───────────────────────────────────────────────
    if (this.minorGrid) {
      this.drawGeometry(this.minorGrid, [0.3, 0.35, 0.45, 0.3], gl.LINES);
    }
    if (this.majorGrid) {
      this.drawGeometry(this.majorGrid, [0.3, 0.35, 0.45, 0.55], gl.LINES);
    }

    // ── Axes: 4-pass for visual ~2.5px thickness ─────────────────────────────
    const axisColor: [number,number,number,number] = [0.6, 0.65, 0.75, 0.7];
    if (this.axisLines) {
      const axisOffsets = [[0,0],[0.5,0],[-0.5,0],[0,0.5]] as const;
      for (const [ox, oy] of axisOffsets) {
        setOrigin(ox, oy);
        this.drawGeometry(this.axisLines, axisColor, gl.LINES);
      }
      restoreOrigin();
    }

    // ── Axis arrowheads: filled triangles, single pass ────────────────────────
    // Triangles are filled by the GPU — no multi-pass needed for thickness.
    if (this.axisArrows && this.axisArrows.count > 0) {
      setOrigin(0, 0);
      this.drawGeometry(this.axisArrows, axisColor, gl.TRIANGLES);
    }

    // ── Curves ───────────────────────────────────────────────────────────────
    // Normal curves: 6 passes → visually ~3px thick
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

      // Optional soft glow pass for hovered curve (drawn before main passes).
      // Always solid — a dashed glow looks fragmented and wrong.
      if (isHovered) {
        gl.uniform1f(this.uDashed, 0.0);
        setOrigin(0, 0);
        gl.uniform4fv(this.uColor, [r, g, b, a * 0.25]);
        for (const seg of entry.segments) {
          if (seg.count < 2) continue;
          gl.bindVertexArray(seg.vao);
          for (const [ox, oy] of [[3.0,0],[-3.0,0],[0,3.0],[0,-3.0]] as const) {
            setOrigin(ox, oy);
            gl.drawArrays(gl.LINE_STRIP, 0, seg.count);
          }
          gl.bindVertexArray(null);
        }
      }

      // Main passes: multi-pass offset for thickness (works for both analytical
      // LINE_STRIP curves and implicit polyline chains from marching squares)
      gl.uniform1f(this.uDashed, entry.fromChat ? 1.0 : 0.0);
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

    // Reset dashed state at end of frame
    gl.uniform1f(this.uDashed, 0.0);
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

  /**
   * getCurveRightmostPoint
   * Scans from xRight inward (3 CSS pixels per step) and returns the
   * first math-space point where the curve has a valid, visible y value.
   *
   * Used by GraphCanvas to position curve-end labels. The scan starts at the
   * screen's right edge so:
   *   - Infinite curves (sin, x²) → label at right screen edge on the curve
   *   - Bounded curves (circle, ellipse) → label at the actual right endpoint
   *
   * @param xRight  Rightmost math-x visible on screen
   * @param yMin    Minimum math-y visible (used for generous range filter)
   * @param yMax    Maximum math-y visible
   */
  getCurveRightmostPoint(
    id:     string,
    xRight: number,
    yMin:   number,
    yMax:   number,
  ): { x: number; y: number } | null {
    const entry = this.curves.get(id);
    if (!entry || !entry.evaluators.length || !this.viewport) return null;

    // 3 CSS pixels per step → up to 200 steps = 600px scan range from right edge
    const step    = 3 / this.viewport.scale;
    const yBuffer = (yMax - yMin) * 2;  // generous: allow points well outside visible range

    for (let i = 0; i <= 200; i++) {
      const x = xRight - i * step;
      for (const ev of entry.evaluators) {
        const y = ev.fn(x);
        if (
          y !== null &&
          isFinite(y) &&
          !isNaN(y) &&
          y >= yMin - yBuffer &&
          y <= yMax + yBuffer
        ) {
          return { x, y };
        }
      }
    }
    return null;
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  destroy(): void {
    const { gl } = this;
    // Terminate worker
    this.worker?.terminate();
    this.worker = null;
    this.workerCallbacks.clear();
    // Free all curve buffers
    for (const id of [...this.curves.keys()]) {
      this.freeCurveBuffers(id);
    }
    // Free grid buffers
    for (const g of [this.minorGrid, this.majorGrid, this.axisLines, this.axisArrows]) {
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

  /**
   * uploadImplicitSegments
   * Parses the NaN-separated polychain format from the marching squares worker
   * and uploads each chain as its own VBO with gl.LINE_STRIP semantics.
   *
   * Format: [x0,y0,..., NaN,NaN, x0,y0,..., NaN,NaN, ...]
   * Each run between NaN pairs is one connected polyline → solid curve.
   *
   * With chaining (done in the worker), what were N×1px dots are now
   * a handful of long polylines that render as solid smooth curves.
   */
  private uploadImplicitSegments(flat: Float32Array): CurveSegment[] {
    const { gl, program } = this;
    const segments: CurveSegment[] = [];

    const uploadChain = (data: Float32Array) => {
      if (data.length < 4) return;
      const { vao, buffer } = createVAO(gl, program, data, gl.STATIC_DRAW);
      // Positive count — rendered with gl.LINE_STRIP (same as analytical curves)
      segments.push({ vao, buffer, count: data.length / 2 });
    };

    // Split on NaN pairs
    let start = 0;
    for (let i = 0; i < flat.length; i++) {
      if (isNaN(flat[i])) {
        if (i > start) uploadChain(flat.slice(start, i));
        // Skip consecutive NaNs
        while (i < flat.length && isNaN(flat[i])) i++;
        start = i;
        i--; // loop will i++ again
      }
    }
    if (start < flat.length) uploadChain(flat.slice(start));

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
    const geo    = buildGridGeometry(vp, this.gridDensity);
    const arrows = buildArrowGeometry(vp);

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

    this.minorGrid  = upload(geo.minor,  this.minorGrid);
    this.majorGrid  = upload(geo.major,  this.majorGrid);
    this.axisLines  = upload(geo.axis,   this.axisLines);
    this.axisArrows = upload(arrows,     this.axisArrows);
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