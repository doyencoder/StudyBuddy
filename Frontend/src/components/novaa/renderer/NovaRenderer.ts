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
import { MathEvaluator, normalise, type CurveEvaluator, type ResidualFn } from './MathEvaluator';

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

export interface CurveIntersection {
  x: number;
  y: number;
  ids: string[];
}

export type ResampleQuality = 'draft' | 'full';

/** One continuous plotted segment (no discontinuities). */
interface CurveSegment {
  buffer: WebGLBuffer;
  vao:    WebGLVertexArrayObject;
  count:  number;
  data:   Float32Array;
  minX:   number;
  maxX:   number;
  minY:   number;
  maxY:   number;
}

/** Internal per-equation data. */
interface CurveEntry {
  segments:    CurveSegment[];
  color:       [number, number, number, number];
  opacity:     number;
  fromChat:    boolean;
  raw:         string;
  evaluators:  CurveEvaluator[];
  residual:    ResidualFn | null;
  sampleQuality: ResampleQuality;
  isImplicit:  boolean;   // true = rendered via marching squares worker
  pendingJobId?: string;
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

interface ExplicitSamplingProfile {
  marginMultiplier: number;
  minSamples: number;
  maxSamples: number;
  pixelStep: number;
}

interface ImplicitTraceProfile {
  xMarginMultiplier: number;
  yMarginMultiplier: number;
  coarseGrid: number;
  maxDepth: number;
}

const EXPLICIT_SAMPLING: Record<ResampleQuality, ExplicitSamplingProfile> = {
  draft: {
    marginMultiplier: 0.55,
    minSamples: 480,
    maxSamples: 1800,
    pixelStep: 3.2,
  },
  full: {
    marginMultiplier: 1.2,
    minSamples: 900,
    maxSamples: 3600,
    pixelStep: 1.35,
  },
};

const RESAMPLE_EDGE_FRACTION = 0.18;

function getImplicitTraceProfile(quality: ResampleQuality, vp: Viewport): ImplicitTraceProfile {
  const span = Math.max(vp.width, vp.height);
  if (quality === 'draft') {
    return {
      xMarginMultiplier: 0.35,
      yMarginMultiplier: 0.25,
      coarseGrid: Math.max(12, Math.min(16, Math.round(span / 120))),
      maxDepth: 4,
    };
  }

  return {
    xMarginMultiplier: 1.0,
    yMarginMultiplier: 0.75,
    coarseGrid: Math.max(16, Math.min(22, Math.round(span / 90))),
    maxDepth: 6,
  };
}

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
  pixelsPerUnit: number,
  profile: ExplicitSamplingProfile,
): Float32Array[] {
  const segments: Float32Array[] = [];
  let current: number[] = [];
  let prevY: number | null = null;
  let prevX = xMin;
  const xRange = Math.max(Math.abs(xMax - xMin), 1e-9);
  const sampleSpanPx = Math.max(xRange * pixelsPerUnit, profile.minSamples);
  const sampleCount = Math.max(
    profile.minSamples,
    Math.min(profile.maxSamples, Math.ceil(sampleSpanPx / profile.pixelStep)),
  );
  let prevNullX = xMin - xRange / sampleCount;
  const step = xRange / sampleCount;
  const yRange = Math.max(Math.abs(yMax - yMin), 1);
  const yBuffer = yRange * 10;
  const jumpThreshold = Math.max(yRange * 0.45, 6);
  const steepSlopeThreshold = Math.max(yRange * 1.2, 14);

  const isDrawable = (y: number | null): y is number => (
    y !== null
    && Number.isFinite(y)
    && !Number.isNaN(y)
    && y >= yMin - yBuffer
    && y <= yMax + yBuffer
  );

  const ITERS = 10; // bisection iterations → precision of step/1024

  // valid→null: find the last valid point approaching the boundary from inside
  const bisectExit = (lo: number, hi: number): [number, number] | null => {
    let bestX = lo;
    let bestY = fn(lo);
    if (!isDrawable(bestY)) return null;
    for (let k = 0; k < ITERS; k++) {
      const mid = (lo + hi) / 2;
      const y = fn(mid);
      if (isDrawable(y)) {
        lo = mid;
        bestX = mid;
        bestY = y;
      } else {
        hi = mid;
      }
    }
    return [bestX, bestY];
  };

  // null→valid: find the first valid point approaching the boundary from outside
  const bisectEntry = (lo: number, hi: number): [number, number] | null => {
    let bestX = hi;
    let bestY = fn(hi);
    if (!isDrawable(bestY)) return null;
    for (let k = 0; k < ITERS; k++) {
      const mid = (lo + hi) / 2;
      const y = fn(mid);
      if (isDrawable(y)) {
        hi = mid;
        bestX = mid;
        bestY = y;
      } else {
        lo = mid;
      }
    }
    return [bestX, bestY];
  };

  const bisectSteepEdge = (
    loX: number,
    hiX: number,
    preferLo: boolean,
  ): [number, number] | null => {
    let leftX = loX;
    let rightX = hiX;
    let leftY = fn(leftX);
    let rightY = fn(rightX);

    if (!isDrawable(leftY) || !isDrawable(rightY)) return null;

    for (let k = 0; k < ITERS; k++) {
      const midX = (leftX + rightX) / 2;
      const midY = fn(midX);
      if (!isDrawable(midY)) {
        if (preferLo) rightX = midX;
        else leftX = midX;
        continue;
      }

      const deltaLeft = Math.abs(midY - leftY);
      const deltaRight = Math.abs(rightY - midY);
      if (preferLo) {
        if (deltaLeft <= deltaRight) {
          leftX = midX;
          leftY = midY;
        } else {
          rightX = midX;
          rightY = midY;
        }
      } else if (deltaRight <= deltaLeft) {
        rightX = midX;
        rightY = midY;
      } else {
        leftX = midX;
        leftY = midY;
      }
    }

    return preferLo ? [leftX, leftY] : [rightX, rightY];
  };

  for (let i = 0; i <= sampleCount; i++) {
    const x = xMin + i * step;
    const y = fn(x);

    // ── Invalid point ────────────────────────────────────────────────────────
    if (!isDrawable(y)) {

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
      current = [];
      prevNullX = x;
      prevY = null;
      continue;
    }

    // ── Discontinuity: large jump — hard break, no bisection ────────────────
    if (prevY !== null) {
      const yJump = Math.abs(y - prevY);
      const slope = yJump / Math.max(Math.abs(x - prevX), 1e-9);
      const signChanged = Math.sign(y) !== Math.sign(prevY);
      const largeEdge = Math.max(Math.abs(y), Math.abs(prevY)) > Math.max(4, yRange * 0.2);
      const steepAsymptote = slope > steepSlopeThreshold && (signChanged || largeEdge);
      if (yJump > jumpThreshold || steepAsymptote) {
        const leftEdge = bisectSteepEdge(prevX, x, true);
        if (leftEdge && current.length >= 2) {
          const lastX = current[current.length - 2];
          const lastY = current[current.length - 1];
          if (Math.abs(leftEdge[0] - lastX) > step * 0.01 || Math.abs(leftEdge[1] - lastY) > 1e-9) {
            current.push(leftEdge[0], leftEdge[1]);
          }
        }
        if (current.length >= 4) segments.push(new Float32Array(current));
        current = [];

        const rightEdge = bisectSteepEdge(prevX, x, false);
        if (rightEdge) current.push(rightEdge[0], rightEdge[1]);
      }
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

function getFloatArrayBounds(data: Float32Array): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < data.length; i += 2) {
    const x = data[i];
    const y = data[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  return { minX, maxX, minY, maxY };
}

// ─────────────────────────────────────────────────────────────────────────────
// NovaRenderer
// ─────────────────────────────────────────────────────────────────────────────

export class NovaRenderer {
  private gl!:       WebGL2RenderingContext;
  private program!:  WebGLProgram;
  private dpr:       number = 1;
  private interactiveMode: boolean = false;

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

  // Web Worker pool for marching squares (implicit curves that can't be solved analytically)
  private workers: Worker[] = [];
  private workerLoads: number[] = [];
  // Pending worker callbacks: job id → callback when segments arrive
  private workerCallbacks = new Map<string, (segs: Float32Array) => void>();
  private jobWorkerIndex = new Map<string, number>();

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

    // Spawn a small marching-squares worker pool so implicit traces can
    // refine in parallel after zoom/pan settles.
    try {
      const concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
      const workerCount = Math.max(2, Math.min(4, Math.floor(concurrency / 2) || 2));
      for (let i = 0; i < workerCount; i++) {
        const worker = new MarchingSquaresWorker();
        worker.onmessage = (e: MessageEvent) => {
          const { id, segments } = e.data as { id: string; segments: Float32Array };
          const workerIndex = this.jobWorkerIndex.get(id);
          if (workerIndex !== undefined) {
            this.jobWorkerIndex.delete(id);
            this.workerLoads[workerIndex] = Math.max(0, (this.workerLoads[workerIndex] ?? 1) - 1);
          }

          const cb = this.workerCallbacks.get(id);
          if (cb) {
            this.workerCallbacks.delete(id);
            cb(segments);
          }
        };
        this.workers.push(worker);
        this.workerLoads.push(0);
      }
    } catch {
      // Worker unavailable (e.g. in test env) — implicit curves won't render
      this.workers = [];
      this.workerLoads = [];
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
   * Use a cheaper draw path while the user is actively panning or zooming.
   * This keeps interaction responsive, then GraphCanvas switches back to
   * the full multi-pass styling once the viewport settles.
   */
  setInteractiveMode(active: boolean): void {
    this.interactiveMode = active;
  }

  /**
   * checkResample
   * Call after a zoom change. If scale has changed by more than 40% since
   * the last sample, re-evaluates all curve functions at the new scale.
   * (We don't resample on every zoom step — that would be too slow during
   * a pinch gesture. We wait for a significant change.)
   */
  checkResample(options: { quality?: ResampleQuality; onReady?: () => void } = {}): void {
    const vp = this.viewport;
    const quality = options.quality ?? 'full';
    const onReady = options.onReady;
    const xMin = (0          - vp.originX) / vp.scale;
    const xMax = (vp.width   - vp.originX) / vp.scale;
    const yMin = (vp.originY - vp.height)  / vp.scale;
    const yMax = (vp.originY - 0)          / vp.scale;
    let didSyncResample = false;

    for (const [id, entry] of this.curves) {
      const scaleDelta = Math.abs(vp.scale - entry.lastSampledScale)
                       / Math.max(entry.lastSampledScale, 1);
      const needsQualityUpgrade = quality === 'full' && entry.sampleQuality !== 'full';
      // Trigger resample when visible range gets close to sampled edges.
      const xRange = xMax - xMin;
      const rangeExtended = xMin < entry.lastSampledXMin + xRange * RESAMPLE_EDGE_FRACTION
                         || xMax > entry.lastSampledXMax - xRange * RESAMPLE_EDGE_FRACTION;

      if (!(needsQualityUpgrade || scaleDelta > 0.3 || rangeExtended)) continue;

      if (entry.isImplicit) {
        this.requestImplicitTrace(id, entry, vp, xMin, xMax, yMin, yMax, quality, onReady);
      } else {
        this.resampleCurve(id, entry, vp, xMin, xMax, yMin, yMax, quality);
        didSyncResample = true;
      }
    }

    if (didSyncResample) onReady?.();
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
    const normalizedRaw = normalise(desc.raw);
    const evaluators    = this.evaluator.getEvaluators(normalizedRaw);
    const residual      = this.evaluator.getResidual(normalizedRaw);
    const color         = cssVarToRGBA(desc.color, desc.fromChat ? 0.65 : 1.0);
    const vp            = this.viewport ?? { originX: 0, originY: 0, scale: 60, width: 800, height: 600 };

    const xMin = (0        - vp.originX) / vp.scale;
    const xMax = (vp.width - vp.originX) / vp.scale;
    const yMin = (vp.originY - vp.height) / vp.scale;
    const yMax = (vp.originY - 0)         / vp.scale;

    // Free old buffers for this id
    this.freeCurveBuffers(desc.id);

    if (evaluators.length > 0) {
      // ── Fast analytical path ──────────────────────────────────────────────
      const profile  = EXPLICIT_SAMPLING.full;
      const margin   = (xMax - xMin) * profile.marginMultiplier;
      const segments = this.buildCurveSegments(
        evaluators, xMin - margin, xMax + margin, yMin, yMax, vp.scale, 'full',
      );

      const entry: CurveEntry = {
        segments, color,
        opacity:          desc.fromChat ? 0.65 : 1.0,
        fromChat:         desc.fromChat,
        raw:              normalizedRaw,
        isImplicit:       false,
        evaluators,
        residual,
        sampleQuality:    'full',
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
        raw:              normalizedRaw,
        isImplicit:       true,
        evaluators:       [],
        residual,
        sampleQuality:    'full',
        lastSampledScale: vp.scale,
        lastSampledXMin:  xMin,
        lastSampledXMax:  xMax,
      };

      if (!this.curves.has(desc.id)) this.curveOrder.push(desc.id);
      this.curves.set(desc.id, placeholder);

      this.requestImplicitTrace(desc.id, placeholder, vp, xMin, xMax, yMin, yMax, 'full', onReady);
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
    if (!this.interactiveMode && this.minorGrid) {
      this.drawGeometry(this.minorGrid, [0.3, 0.35, 0.45, 0.3], gl.LINES);
    }
    if (this.majorGrid) {
      this.drawGeometry(this.majorGrid, [0.3, 0.35, 0.45, 0.55], gl.LINES);
    }

    // ── Axes: 4-pass for visual ~2.5px thickness ─────────────────────────────
    const axisColor: [number,number,number,number] = [0.6, 0.65, 0.75, 0.7];
    if (this.axisLines) {
      const axisOffsets = this.interactiveMode
        ? ([[0, 0]] as const)
        : ([[0,0],[0.5,0],[-0.5,0],[0,0.5]] as const);
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
    const normalOffsets = this.interactiveMode
      ? ([[0,0],[0.8,0],[0,0.8]] as const)
      : ([[0,0],[1.2,0],[-1.2,0],[0,1.2],[0,-1.2],[0.8,0.8]] as const);
    // Hovered: 8 passes → visually ~4px thick
    const hoverOffsets  = this.interactiveMode
      ? ([[0,0],[1.0,0],[0,1.0]] as const)
      : ([[0,0],[1.5,0],[-1.5,0],[0,1.5],[0,-1.5],[1.0,1.0],[-1.0,1.0],[1.0,-1.0]] as const);

    for (const id of this.curveOrder) {
      if (!visible.has(id)) continue;
      const entry = this.curves.get(id);
      if (!entry || entry.color[3] === 0) continue;

      const isHovered = id === hoveredId;
      const offsets   = isHovered ? hoverOffsets : normalOffsets;
      const [r, g, b, a] = entry.color;

      // Optional soft glow pass for hovered curve (drawn before main passes).
      // Always solid — a dashed glow looks fragmented and wrong.
      if (isHovered && !this.interactiveMode) {
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

  getCurveIntersections(
    visible: Set<string>,
    maxPoints: number = 120,
  ): CurveIntersection[] {
    if (!this.viewport) return [];

    const { scale, originX, originY, width, height } = this.viewport;
    const xMin = (0 - originX) / scale;
    const xMax = (width - originX) / scale;
    const yMin = (originY - height) / scale;
    const yMax = (originY - 0) / scale;
    const xTol = 6 / Math.max(scale, 1);
    const yTol = 6 / Math.max(scale, 1);
    const proximityTol = 4 / Math.max(scale, 1);
    const tolSq = proximityTol * proximityTol;
    const mergeRadiusPx = 10;
    const mergeRadiusPxSq = mergeRadiusPx * mergeRadiusPx;
    const sharedMergeRadiusPx = 18;
    const sharedMergeRadiusPxSq = sharedMergeRadiusPx * sharedMergeRadiusPx;
    const pairMergeRadiusPx = 14;
    const pairMergeRadiusPxSq = pairMergeRadiusPx * pairMergeRadiusPx;
    const xBuffer = Math.max((xMax - xMin) * 0.08, 16 / Math.max(scale, 1));
    const yBuffer = Math.max((yMax - yMin) * 0.08, 16 / Math.max(scale, 1));
    const cellSize = Math.max(24 / Math.max(scale, 1), Math.min((xMax - xMin) / 18, (yMax - yMin) / 18, 2.5));
    const xBase = xMin - xBuffer;
    const yBase = yMin - yBuffer;

    type LineRecord = {
      id: number;
      curveId: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    };

    const candidates = this.curveOrder
      .filter((id) => visible.has(id))
      .map((id) => [id, this.curves.get(id)] as const)
      .filter(([, entry]) => !!entry && entry.segments.length > 0) as Array<[string, CurveEntry]>;
    const entryById = new Map(candidates);
    const pairCandidates = new Map<string, {
      ids: [string, string];
      points: Array<{ x: number; y: number }>;
    }>();
    const finalClusters: Array<CurveIntersection & { hitCount: number }> = [];
    const lineRecords: LineRecord[] = [];
    const buckets = new Map<string, number[]>();
    const comparedPairs = new Set<string>();

    const recordCandidate = (x: number, y: number, aId: string, bId: string) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < xMin - xBuffer || x > xMax + xBuffer) return;
      if (y < yMin - yBuffer || y > yMax + yBuffer) return;
      const ids = aId < bId ? [aId, bId] as [string, string] : [bId, aId] as [string, string];
      const key = `${ids[0]}|${ids[1]}`;
      const bucket = pairCandidates.get(key);
      if (bucket) bucket.points.push({ x, y });
      else pairCandidates.set(key, { ids, points: [{ x, y }] });
    };

    const addFinalPoint = (x: number, y: number, ids: string[]) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < xMin - xTol || x > xMax + xTol) return;
      if (y < yMin - yTol || y > yMax + yTol) return;

      let bestCluster: (CurveIntersection & { hitCount: number }) | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;

      for (const cluster of finalClusters) {
        const dxPx = (cluster.x - x) * scale;
        const dyPx = (cluster.y - y) * scale;
        const distSq = dxPx * dxPx + dyPx * dyPx;
        const sharesCurve = cluster.ids.some((id) => ids.includes(id));
        const allowedDistSq = sharesCurve ? sharedMergeRadiusPxSq : mergeRadiusPxSq;
        if (distSq > allowedDistSq || distSq >= bestDistSq) continue;
        bestCluster = cluster;
        bestDistSq = distSq;
      }

      if (!bestCluster) {
        finalClusters.push({ x, y, ids: [...ids].sort(), hitCount: 1 });
        return;
      }

      const combinedCount = bestCluster.hitCount + 1;
      bestCluster.x = (bestCluster.x * bestCluster.hitCount + x) / combinedCount;
      bestCluster.y = (bestCluster.y * bestCluster.hitCount + y) / combinedCount;
      bestCluster.hitCount = combinedCount;
      bestCluster.ids = [...new Set([...bestCluster.ids, ...ids])].sort();
    };

    const clusterPairPoints = (points: Array<{ x: number; y: number }>) => {
      const clusters: Array<{ x: number; y: number; count: number }> = [];
      for (const point of points) {
        let best: { x: number; y: number; count: number } | null = null;
        let bestDistSq = Number.POSITIVE_INFINITY;
        for (const cluster of clusters) {
          const dxPx = (cluster.x - point.x) * scale;
          const dyPx = (cluster.y - point.y) * scale;
          const distSq = dxPx * dxPx + dyPx * dyPx;
          if (distSq > pairMergeRadiusPxSq || distSq >= bestDistSq) continue;
          best = cluster;
          bestDistSq = distSq;
        }

        if (!best) {
          clusters.push({ x: point.x, y: point.y, count: 1 });
          continue;
        }

        const nextCount = best.count + 1;
        best.x = (best.x * best.count + point.x) / nextCount;
        best.y = (best.y * best.count + point.y) / nextCount;
        best.count = nextCount;
      }

      return clusters;
    };

    const scorePointForIds = (ids: string[], x: number, y: number) => {
      let score = 0;
      let matches = 0;
      for (const id of ids) {
        const residual = entryById.get(id)?.residual ?? null;
        if (!residual) continue;
        const value = residual(x, y);
        if (value === null || !Number.isFinite(value)) continue;
        score += value * value;
        matches++;
      }
      return { score, matches };
    };

    const derivative = (
      fn: ResidualFn,
      x: number,
      y: number,
      dx: number,
      dy: number,
    ): number | null => {
      const center = fn(x, y);
      const forward = fn(x + dx, y + dy);
      const backward = fn(x - dx, y - dy);
      const step = Math.abs(dx) + Math.abs(dy);
      if (step === 0) return null;

      if (forward !== null && backward !== null) return (forward - backward) / (2 * step);
      if (forward !== null && center !== null) return (forward - center) / step;
      if (backward !== null && center !== null) return (center - backward) / step;
      return null;
    };

    const snapCoordinate = (value: number, tolerance: number): number => {
      if (Math.abs(value) < tolerance) return 0;
      const rounded = Math.round(value);
      if (Math.abs(value - rounded) < tolerance) return rounded;
      const halfRounded = Math.round(value * 2) / 2;
      if (Math.abs(value - halfRounded) < tolerance * 0.8) return halfRounded;
      return value;
    };

    const snapIntersectionPoint = (ids: string[], x: number, y: number) => {
      const snapTol = Math.min(0.05, Math.max(8 / Math.max(scale, 1), 0.006));
      const xSnapped = snapCoordinate(x, snapTol);
      const ySnapped = snapCoordinate(y, snapTol);
      if (xSnapped === x && ySnapped === y) return { x, y };

      const current = scorePointForIds(ids, x, y);
      if (current.matches < 2) return { x, y };

      const candidates = [
        { x: xSnapped, y },
        { x, y: ySnapped },
        { x: xSnapped, y: ySnapped },
      ];
      let best = { x, y, score: current.score };

      for (const candidate of candidates) {
        const next = scorePointForIds(ids, candidate.x, candidate.y);
        if (next.matches < 2) continue;
        if (next.score <= best.score * 1.05 + 1e-12) {
          best = { x: candidate.x, y: candidate.y, score: next.score };
        }
      }

      return { x: best.x, y: best.y };
    };

    const refineIntersection = (aId: string, bId: string, seedX: number, seedY: number) => {
      const aResidual = entryById.get(aId)?.residual ?? null;
      const bResidual = entryById.get(bId)?.residual ?? null;
      if (!aResidual || !bResidual) {
        return { x: seedX, y: seedY };
      }

      let x = seedX;
      let y = seedY;
      let bestX = seedX;
      let bestY = seedY;
      let bestScore = Number.POSITIVE_INFINITY;
      const snapTol = Math.min(0.05, Math.max(8 / Math.max(scale, 1), 0.006));

      for (let iter = 0; iter < 18; iter++) {
        const f = aResidual(x, y);
        const g = bResidual(x, y);
        if (f === null || g === null || !Number.isFinite(f) || !Number.isFinite(g)) break;

        const score = f * f + g * g;
        if (score < bestScore) {
          bestScore = score;
          bestX = x;
          bestY = y;
        }
        if (score < 1e-20) break;

        const h = Math.max(1e-5, 0.6 / Math.max(scale, 1), 1e-4 * Math.max(1, Math.abs(x), Math.abs(y)));
        const fx = derivative(aResidual, x, y, h, 0) ?? 0;
        const fy = derivative(aResidual, x, y, 0, h) ?? 0;
        const gx = derivative(bResidual, x, y, h, 0) ?? 0;
        const gy = derivative(bResidual, x, y, 0, h) ?? 0;

        const jtrX = fx * f + gx * g;
        const jtrY = fy * f + gy * g;
        const damping = 1e-6 + Math.min(1, score) * 1e-2;
        const a11 = fx * fx + gx * gx + damping;
        const a12 = fx * fy + gx * gy;
        const a22 = fy * fy + gy * gy + damping;
        const det = a11 * a22 - a12 * a12;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-18) break;

        const stepX = (-a22 * jtrX + a12 * jtrY) / det;
        const stepY = (a12 * jtrX - a11 * jtrY) / det;
        if (!Number.isFinite(stepX) || !Number.isFinite(stepY)) break;

        let accepted = false;
        for (const factor of [1, 0.5, 0.25, 0.1]) {
          const nextX = x + stepX * factor;
          const nextY = y + stepY * factor;
          const nextF = aResidual(nextX, nextY);
          const nextG = bResidual(nextX, nextY);
          if (
            nextF === null || nextG === null
            || !Number.isFinite(nextF) || !Number.isFinite(nextG)
          ) {
            continue;
          }

          const nextScore = nextF * nextF + nextG * nextG;
          if (nextScore > score * 1.0005 && nextScore > bestScore * 1.0005) continue;

          x = nextX;
          y = nextY;
          accepted = true;
          break;
        }

        if (!accepted) break;
      }

      bestX = snapCoordinate(bestX, snapTol);
      bestY = snapCoordinate(bestY, snapTol);
      return { x: bestX, y: bestY };
    };

    const pointToSegment = (
      px: number,
      py: number,
      seg: LineRecord,
    ): { x: number; y: number; distSq: number } => {
      const dx = seg.x2 - seg.x1;
      const dy = seg.y2 - seg.y1;
      const lenSq = dx * dx + dy * dy;

      if (lenSq < 1e-12) {
        const distSq = (px - seg.x1) * (px - seg.x1) + (py - seg.y1) * (py - seg.y1);
        return { x: seg.x1, y: seg.y1, distSq };
      }

      const t = Math.max(0, Math.min(1, ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq));
      const x = seg.x1 + dx * t;
      const y = seg.y1 + dy * t;
      const distSq = (px - x) * (px - x) + (py - y) * (py - y);
      return { x, y, distSq };
    };

    const intersectSegments = (a: LineRecord, b: LineRecord): { x: number; y: number } | null => {
      if (
        a.maxX < b.minX - proximityTol || b.maxX < a.minX - proximityTol
        || a.maxY < b.minY - proximityTol || b.maxY < a.minY - proximityTol
      ) {
        return null;
      }

      const rX = a.x2 - a.x1;
      const rY = a.y2 - a.y1;
      const sX = b.x2 - b.x1;
      const sY = b.y2 - b.y1;
      const denom = rX * sY - rY * sX;
      const qpx = b.x1 - a.x1;
      const qpy = b.y1 - a.y1;

      if (Math.abs(denom) > 1e-12) {
        const t = (qpx * sY - qpy * sX) / denom;
        const u = (qpx * rY - qpy * rX) / denom;
        const paramTol = 0.015;
        if (
          t >= -paramTol && t <= 1 + paramTol
          && u >= -paramTol && u <= 1 + paramTol
        ) {
          return {
            x: a.x1 + t * rX,
            y: a.y1 + t * rY,
          };
        }
      }

      let best: { x: number; y: number; distSq: number } | null = null;
      const candidatesToCheck = [
        pointToSegment(a.x1, a.y1, b),
        pointToSegment(a.x2, a.y2, b),
        pointToSegment(b.x1, b.y1, a),
        pointToSegment(b.x2, b.y2, a),
      ];

      for (const candidate of candidatesToCheck) {
        if (candidate.distSq > tolSq) continue;
        if (!best || candidate.distSq < best.distSq) best = candidate;
      }

      return best ? { x: best.x, y: best.y } : null;
    };

    let recordId = 0;
    for (const [curveId, entry] of candidates) {
      for (const segment of entry.segments) {
        if (
          segment.maxX < xMin - xBuffer || segment.minX > xMax + xBuffer
          || segment.maxY < yMin - yBuffer || segment.minY > yMax + yBuffer
        ) {
          continue;
        }

        const data = segment.data;
        for (let i = 0; i <= data.length - 4; i += 2) {
          const x1 = data[i];
          const y1 = data[i + 1];
          const x2 = data[i + 2];
          const y2 = data[i + 3];
          if (
            !Number.isFinite(x1) || !Number.isFinite(y1)
            || !Number.isFinite(x2) || !Number.isFinite(y2)
          ) {
            continue;
          }

          const minSegX = Math.min(x1, x2);
          const maxSegX = Math.max(x1, x2);
          const minSegY = Math.min(y1, y2);
          const maxSegY = Math.max(y1, y2);
          if (
            maxSegX < xMin - xBuffer || minSegX > xMax + xBuffer
            || maxSegY < yMin - yBuffer || minSegY > yMax + yBuffer
          ) {
            continue;
          }

          const record: LineRecord = {
            id: recordId++,
            curveId,
            x1,
            y1,
            x2,
            y2,
            minX: minSegX,
            maxX: maxSegX,
            minY: minSegY,
            maxY: maxSegY,
          };
          lineRecords.push(record);

          const colStart = Math.floor((minSegX - xBase) / cellSize);
          const colEnd = Math.floor((maxSegX - xBase) / cellSize);
          const rowStart = Math.floor((minSegY - yBase) / cellSize);
          const rowEnd = Math.floor((maxSegY - yBase) / cellSize);
          for (let col = colStart; col <= colEnd; col++) {
            for (let row = rowStart; row <= rowEnd; row++) {
              const key = `${col}:${row}`;
              const bucket = buckets.get(key);
              if (bucket) bucket.push(record.id);
              else buckets.set(key, [record.id]);
            }
          }
        }
      }
    }

    outer:
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i++) {
        const a = lineRecords[bucket[i]];
        for (let j = i + 1; j < bucket.length; j++) {
          const b = lineRecords[bucket[j]];
          if (!a || !b || a.curveId === b.curveId) continue;

          const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
          if (comparedPairs.has(pairKey)) continue;
          comparedPairs.add(pairKey);

          const hit = intersectSegments(a, b);
          if (!hit) continue;

          recordCandidate(hit.x, hit.y, a.curveId, b.curveId);
          if (pairCandidates.size >= maxPoints * 8) break outer;
        }
      }
    }

    for (const { ids, points } of pairCandidates.values()) {
      const clusters = clusterPairPoints(points);
      for (const cluster of clusters) {
        const refined = refineIntersection(ids[0], ids[1], cluster.x, cluster.y);
        const snapped = snapIntersectionPoint(ids, refined.x, refined.y);
        addFinalPoint(snapped.x, snapped.y, ids);
      }
    }

    const mergedClusters: Array<CurveIntersection & { hitCount: number }> = [];
    for (const point of finalClusters) {
      const snapped = snapIntersectionPoint(point.ids, point.x, point.y);

      let bestCluster: (CurveIntersection & { hitCount: number }) | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (const cluster of mergedClusters) {
        const dxPx = (cluster.x - snapped.x) * scale;
        const dyPx = (cluster.y - snapped.y) * scale;
        const distSq = dxPx * dxPx + dyPx * dyPx;
        const sharesCurve = cluster.ids.some((id) => point.ids.includes(id));
        const allowedDistSq = sharesCurve ? sharedMergeRadiusPxSq : mergeRadiusPxSq;
        if (distSq > allowedDistSq || distSq >= bestDistSq) continue;
        bestCluster = cluster;
        bestDistSq = distSq;
      }

      if (!bestCluster) {
        mergedClusters.push({
          x: snapped.x,
          y: snapped.y,
          ids: [...point.ids].sort(),
          hitCount: point.hitCount,
        });
        continue;
      }

      const combinedCount = bestCluster.hitCount + point.hitCount;
      bestCluster.x = (bestCluster.x * bestCluster.hitCount + snapped.x * point.hitCount) / combinedCount;
      bestCluster.y = (bestCluster.y * bestCluster.hitCount + snapped.y * point.hitCount) / combinedCount;
      bestCluster.hitCount = combinedCount;
      bestCluster.ids = [...new Set([...bestCluster.ids, ...point.ids])].sort();
    }

    return mergedClusters
      .filter((point) => (
        point.x >= xMin - xTol
        && point.x <= xMax + xTol
        && point.y >= yMin - yTol
        && point.y <= yMax + yTol
      ))
      .slice(0, maxPoints)
      .map(({ hitCount: _hitCount, ...point }) => point);
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
    // Terminate workers
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.workerLoads = [];
    this.workerCallbacks.clear();
    this.jobWorkerIndex.clear();
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
    scale: number,
    quality: ResampleQuality,
  ): CurveSegment[] {
    const { gl, program } = this;
    const segments: CurveSegment[] = [];
    const profile = EXPLICIT_SAMPLING[quality];

    for (const ev of evaluators) {
      const arrays = sampleCurve(ev.fn, xMin, xMax, yMin, yMax, scale, profile);
      for (const data of arrays) {
        const { vao, buffer } = createVAO(gl, program, data, gl.STATIC_DRAW);
        segments.push({
          vao,
          buffer,
          count: data.length / 2,
          data,
          ...getFloatArrayBounds(data),
        });
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
      segments.push({
        vao,
        buffer,
        count: data.length / 2,
        data,
        ...getFloatArrayBounds(data),
      });
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
    quality: ResampleQuality,
  ): void {
    const profile = EXPLICIT_SAMPLING[quality];
    const margin = (xMax - xMin) * profile.marginMultiplier;
    const sxMin  = xMin - margin;
    const sxMax  = xMax + margin;

    // Free old segment buffers
    this.freeSegments(entry.segments);

    entry.segments          = this.buildCurveSegments(entry.evaluators, sxMin, sxMax, yMin, yMax, vp.scale, quality);
    entry.sampleQuality     = quality;
    entry.lastSampledScale  = vp.scale;
    entry.lastSampledXMin   = sxMin;
    entry.lastSampledXMax   = sxMax;
  }

  private pickWorkerIndex(): number {
    if (!this.workers.length) return -1;

    let bestIndex = 0;
    let bestLoad = this.workerLoads[0] ?? 0;
    for (let i = 1; i < this.workers.length; i++) {
      const load = this.workerLoads[i] ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private requestImplicitTrace(
    id: string,
    entry: CurveEntry,
    vp: Viewport,
    xMin: number, xMax: number,
    yMin: number, yMax: number,
    quality: ResampleQuality,
    onReady?: () => void,
  ): void {
    const workerIndex = this.pickWorkerIndex();
    if (workerIndex < 0) return;
    const worker = this.workers[workerIndex];

    const profile = getImplicitTraceProfile(quality, vp);
    const xMargin = (xMax - xMin) * profile.xMarginMultiplier;
    const yMargin = (yMax - yMin) * profile.yMarginMultiplier;
    const sxMin = xMin - xMargin;
    const sxMax = xMax + xMargin;
    const syMin = yMin - yMargin;
    const syMax = yMax + yMargin;
    const jobId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    entry.pendingJobId = jobId;
    this.jobWorkerIndex.set(jobId, workerIndex);
    this.workerLoads[workerIndex] = (this.workerLoads[workerIndex] ?? 0) + 1;
    this.workerCallbacks.set(jobId, (segsFlat: Float32Array) => {
      const liveEntry = this.curves.get(id);
      if (!liveEntry || liveEntry.pendingJobId !== jobId) return;

      this.freeSegments(liveEntry.segments);
      liveEntry.segments = this.uploadImplicitSegments(segsFlat);
      liveEntry.sampleQuality = quality;
      liveEntry.lastSampledScale = vp.scale;
      liveEntry.lastSampledXMin = sxMin;
      liveEntry.lastSampledXMax = sxMax;
      liveEntry.pendingJobId = undefined;

      onReady?.();
    });

    worker.postMessage({
      id: jobId,
      raw: entry.raw,
      xMin: sxMin,
      xMax: sxMax,
      yMin: syMin,
      yMax: syMax,
      coarseGrid: profile.coarseGrid,
      maxDepth: profile.maxDepth,
    });
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
