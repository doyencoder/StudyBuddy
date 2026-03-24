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
import {
  MathEvaluator,
  detectRelationOperator,
  isInequalityOperator,
  normalise,
  type CurveEvaluator,
  type InequalityOperator,
  type ResidualFn,
} from './MathEvaluator';
import {
  computeCurveIntersections,
  DEFAULT_INTERSECTION_POINTS,
  type IntersectionCurveInput,
} from './intersectionCore';

// Vite worker import — bundled as a separate chunk, loaded lazily
// ?worker tells Vite to treat this as a Web Worker module
import MarchingSquaresWorker from './marchingSquares.worker?worker';
import IntersectionWorker from './intersection.worker?worker';

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
  color:     string;       // CSS variable key, e.g. "nova-curve-1"
  visible:   boolean;
  fromChat:  boolean;      // provenance only; rendering stays solid
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
  fillRegion:  GridBuffer | null;
  fillColor:   [number, number, number, number] | null;
  fillOpacity: number;
  inequalityOp: InequalityOperator | null;
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
  lastFillSampleScale: number;
  lastFillSampleXMin:  number;
  lastFillSampleXMax:  number;
  lastFillSampleYMin:  number;
  lastFillSampleYMax:  number;
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
  const yBuffer = Math.max(yRange * 5.5, 42);
  const jumpThreshold = Math.max(yRange * 0.45, 6);
  const steepSlopeThreshold = Math.max(yRange * 1.2, 14);

  const isDrawable = (y: number | null): y is number => (
    y !== null
    && Number.isFinite(y)
    && !Number.isNaN(y)
    && y >= yMin - yBuffer
    && y <= yMax + yBuffer
  );

  const ITERS = 30; // lets domain-edge curves like log(x) reach much closer to the asymptote

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

// Major-axis tick spacing visible on labels/grid for a given zoom+density.
export function getMajorTickStep(scale: number, densityDivisor: number = 1): number {
  return niceGridStep(scale, densityDivisor) * 5;
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
  const majorStep = getMajorTickStep(scale, densityDivisor);
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

interface ScalarVertex {
  x: number;
  y: number;
  v: number;
}

function interpolateZeroCrossing(a: ScalarVertex, b: ScalarVertex): ScalarVertex | null {
  if (!Number.isFinite(a.v) || !Number.isFinite(b.v)) return null;
  const denom = a.v - b.v;
  if (Math.abs(denom) < 1e-9) {
    return {
      x: (a.x + b.x) * 0.5,
      y: (a.y + b.y) * 0.5,
      v: 0,
    };
  }

  const t = Math.min(1, Math.max(0, a.v / denom));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    v: 0,
  };
}

function appendClippedTriangleFill(target: number[], triangle: [ScalarVertex, ScalarVertex, ScalarVertex]): void {
  const clipped: ScalarVertex[] = [];

  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i];
    const b = triangle[(i + 1) % triangle.length];
    const aInside = Number.isFinite(a.v) && a.v >= -1e-7;
    const bInside = Number.isFinite(b.v) && b.v >= -1e-7;

    if (aInside) clipped.push(a);
    if (aInside !== bInside) {
      const crossing = interpolateZeroCrossing(a, b);
      if (crossing) clipped.push(crossing);
    }
  }

  if (clipped.length < 3) return;
  for (let i = 1; i < clipped.length - 1; i++) {
    target.push(
      clipped[0].x, clipped[0].y,
      clipped[i].x, clipped[i].y,
      clipped[i + 1].x, clipped[i + 1].y,
    );
  }
}

function buildInequalityFillData(
  residual: ResidualFn,
  inequalityOp: InequalityOperator,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  width: number,
  height: number,
): Float32Array {
  const orient = inequalityOp === '>' || inequalityOp === '>=' ? 1 : -1;
  const xSteps = Math.max(40, Math.min(176, Math.ceil(width / 14)));
  const ySteps = Math.max(32, Math.min(144, Math.ceil(height / 14)));
  const xStep = (xMax - xMin) / xSteps;
  const yStep = (yMax - yMin) / ySteps;
  const values = new Float32Array((xSteps + 1) * (ySteps + 1));

  const valueAt = (ix: number, iy: number) => values[iy * (xSteps + 1) + ix];

  for (let iy = 0; iy <= ySteps; iy++) {
    const y = yMin + iy * yStep;
    for (let ix = 0; ix <= xSteps; ix++) {
      const x = xMin + ix * xStep;
      const raw = residual(x, y);
      values[iy * (xSteps + 1) + ix] = raw === null ? Number.NaN : raw * orient;
    }
  }

  const triangles: number[] = [];
  for (let iy = 0; iy < ySteps; iy++) {
    const y0 = yMin + iy * yStep;
    const y1 = y0 + yStep;
    for (let ix = 0; ix < xSteps; ix++) {
      const x0 = xMin + ix * xStep;
      const x1 = x0 + xStep;

      const bl: ScalarVertex = { x: x0, y: y0, v: valueAt(ix, iy) };
      const br: ScalarVertex = { x: x1, y: y0, v: valueAt(ix + 1, iy) };
      const tr: ScalarVertex = { x: x1, y: y1, v: valueAt(ix + 1, iy + 1) };
      const tl: ScalarVertex = { x: x0, y: y1, v: valueAt(ix, iy + 1) };

      appendClippedTriangleFill(triangles, [bl, br, tr]);
      appendClippedTriangleFill(triangles, [bl, tr, tl]);
    }
  }

  return new Float32Array(triangles);
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
  private uDashed!:     WebGLUniformLocation;  // reserved dash toggle; curves render solid

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
  private intersectionWorker: Worker | null = null;
  private latestIntersectionRequestId = 0;
  private intersectionCallbacks = new Map<number, (points: CurveIntersection[]) => void>();

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

    try {
      const worker = new IntersectionWorker();
      worker.onmessage = (e: MessageEvent) => {
        const { id, intersections } = e.data as { id: number; intersections: CurveIntersection[] };
        const cb = this.intersectionCallbacks.get(id);
        this.intersectionCallbacks.delete(id);
        if (!cb || id !== this.latestIntersectionRequestId) return;
        cb(intersections);
      };
      this.intersectionWorker = worker;
    } catch {
      this.intersectionWorker = null;
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
      const yRange = yMax - yMin;
      const rangeExtended = xMin < entry.lastSampledXMin + xRange * RESAMPLE_EDGE_FRACTION
                         || xMax > entry.lastSampledXMax - xRange * RESAMPLE_EDGE_FRACTION;
      const fillRangeExtended = entry.fillRegion === null
        || xMin < entry.lastFillSampleXMin + xRange * RESAMPLE_EDGE_FRACTION
        || xMax > entry.lastFillSampleXMax - xRange * RESAMPLE_EDGE_FRACTION
        || yMin < entry.lastFillSampleYMin + yRange * RESAMPLE_EDGE_FRACTION
        || yMax > entry.lastFillSampleYMax - yRange * RESAMPLE_EDGE_FRACTION;

      const needsCurveRefresh = needsQualityUpgrade || scaleDelta > 0.3 || rangeExtended;
      const needsFillRefresh = quality === 'full'
        && !!entry.inequalityOp
        && !!entry.residual
        && (scaleDelta > 0.2 || fillRangeExtended);

      if (!needsCurveRefresh && !needsFillRefresh) continue;

      if (needsCurveRefresh) {
        if (entry.isImplicit) {
          this.requestImplicitTrace(id, entry, vp, xMin, xMax, yMin, yMax, quality, onReady);
        } else {
          this.resampleCurve(id, entry, vp, xMin, xMax, yMin, yMax, quality);
          didSyncResample = true;
        }
      }

      if (needsFillRefresh) {
        this.updateInequalityFill(entry, vp, xMin, xMax, yMin, yMax);
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
    const relation = detectRelationOperator(desc.raw);
    const inequalityOp = isInequalityOperator(relation) ? relation : null;
    const normalizedRaw = normalise(desc.raw);
    const evaluators    = this.evaluator.getEvaluators(normalizedRaw);
    const residual      = this.evaluator.getResidual(normalizedRaw);
    const color         = cssVarToRGBA(desc.color, 1.0);
    const fillOpacity   = inequalityOp ? 0.38 : 0;
    const fillColor     = inequalityOp
      ? ([color[0], color[1], color[2], fillOpacity] as [number, number, number, number])
      : null;
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
        opacity:          1.0,
        fillRegion:       null,
        fillColor,
        fillOpacity,
        inequalityOp,
        fromChat:         desc.fromChat,
        raw:              normalizedRaw,
        isImplicit:       false,
        evaluators,
        residual,
        sampleQuality:    'full',
        lastSampledScale: vp.scale,
        lastSampledXMin:  xMin - margin,
        lastSampledXMax:  xMax + margin,
        lastFillSampleScale: 0,
        lastFillSampleXMin: 0,
        lastFillSampleXMax: 0,
        lastFillSampleYMin: 0,
        lastFillSampleYMax: 0,
      };

      this.updateInequalityFill(entry, vp, xMin, xMax, yMin, yMax);
      if (!this.curves.has(desc.id)) this.curveOrder.push(desc.id);
      this.curves.set(desc.id, entry);

    } else {
      // ── Marching squares path ─────────────────────────────────────────────
      // Insert a placeholder entry immediately so the equation shows in the
      // panel with correct color. Segments will be filled when worker replies.
      const placeholder: CurveEntry = {
        segments:         [],
        color, opacity:   1.0,
        fillRegion:       null,
        fillColor,
        fillOpacity,
        inequalityOp,
        fromChat:         desc.fromChat,
        raw:              normalizedRaw,
        isImplicit:       true,
        evaluators:       [],
        residual,
        sampleQuality:    'full',
        lastSampledScale: vp.scale,
        lastSampledXMin:  xMin,
        lastSampledXMax:  xMax,
        lastFillSampleScale: 0,
        lastFillSampleXMin: 0,
        lastFillSampleXMax: 0,
        lastFillSampleYMin: 0,
        lastFillSampleYMax: 0,
      };

      this.updateInequalityFill(placeholder, vp, xMin, xMax, yMin, yMax);
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
      if (entry.fillColor) {
        entry.fillColor[3] = visible ? entry.fillOpacity : 0;
      }
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
   * Curves always render solid now, including equations that originated in chat.
   * The fromChat flag is kept only for higher-level UI grouping.
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
    setOrigin(0, 0);
    for (const id of this.curveOrder) {
      if (!visible.has(id)) continue;
      const entry = this.curves.get(id);
      if (!entry?.fillRegion || !entry.fillColor || entry.fillColor[3] === 0) continue;
      this.drawGeometry(entry.fillRegion, entry.fillColor, gl.TRIANGLES);
    }

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
      gl.uniform1f(this.uDashed, 0.0);
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
    maxPoints: number = DEFAULT_INTERSECTION_POINTS,
  ): CurveIntersection[] {
    if (!this.viewport) return [];
    return computeCurveIntersections(this.buildIntersectionPayload(visible), this.viewport, maxPoints);
  }

  requestCurveIntersections(
    visible: Set<string>,
    onReady: (points: CurveIntersection[]) => void,
    maxPoints: number = DEFAULT_INTERSECTION_POINTS,
  ): void {
    if (!this.viewport) {
      onReady([]);
      return;
    }

    const curves = this.buildIntersectionPayload(visible);
    if (curves.length < 2) {
      onReady([]);
      return;
    }

    if (!this.intersectionWorker) {
      onReady(computeCurveIntersections(curves, this.viewport, maxPoints));
      return;
    }

    const requestId = ++this.latestIntersectionRequestId;
    this.intersectionCallbacks.clear();
    this.intersectionCallbacks.set(requestId, onReady);
    this.intersectionWorker.postMessage({
      id: requestId,
      curves,
      viewport: this.viewport,
      maxPoints,
    });
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
    this.intersectionWorker?.terminate();
    this.intersectionWorker = null;
    this.intersectionCallbacks.clear();
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

  private uploadFillGeometry(data: Float32Array, existing: GridBuffer | null): GridBuffer | null {
    if (data.length < 6) {
      if (existing) {
        this.gl.deleteBuffer(existing.buffer);
        this.gl.deleteVertexArray(existing.vao);
      }
      return null;
    }

    const { gl, program } = this;
    if (existing) {
      gl.bindVertexArray(existing.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, existing.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      return { ...existing, count: data.length / 2 };
    }

    const { vao, buffer } = createVAO(gl, program, data, gl.DYNAMIC_DRAW);
    return { vao, buffer, count: data.length / 2 };
  }

  private updateInequalityFill(
    entry: CurveEntry,
    vp: Viewport,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
  ): void {
    if (!entry.inequalityOp || !entry.residual) {
      if (entry.fillRegion) {
        this.gl.deleteBuffer(entry.fillRegion.buffer);
        this.gl.deleteVertexArray(entry.fillRegion.vao);
      }
      entry.fillRegion = null;
      return;
    }

    const xMargin = (xMax - xMin) * 0.45;
    const yMargin = (yMax - yMin) * 0.45;
    const sxMin = xMin - xMargin;
    const sxMax = xMax + xMargin;
    const syMin = yMin - yMargin;
    const syMax = yMax + yMargin;
    const data = buildInequalityFillData(
      entry.residual,
      entry.inequalityOp,
      sxMin,
      sxMax,
      syMin,
      syMax,
      vp.width,
      vp.height,
    );

    entry.fillRegion = this.uploadFillGeometry(data, entry.fillRegion);
    entry.lastFillSampleScale = vp.scale;
    entry.lastFillSampleXMin = sxMin;
    entry.lastFillSampleXMax = sxMax;
    entry.lastFillSampleYMin = syMin;
    entry.lastFillSampleYMax = syMax;
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

  private buildIntersectionPayload(visible: Set<string>): IntersectionCurveInput[] {
    return this.curveOrder
      .filter((id) => visible.has(id))
      .map((id) => {
        const entry = this.curves.get(id);
        if (!entry || entry.segments.length === 0) return null;
        return {
          id,
          raw: entry.raw,
          segments: entry.segments.map((segment) => segment.data),
        } satisfies IntersectionCurveInput;
      })
      .filter((entry): entry is IntersectionCurveInput => entry !== null);
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
    if (!entry) return;
    this.freeSegments(entry.segments);
    if (entry.fillRegion) {
      this.gl.deleteBuffer(entry.fillRegion.buffer);
      this.gl.deleteVertexArray(entry.fillRegion.vao);
      entry.fillRegion = null;
    }
  }
}