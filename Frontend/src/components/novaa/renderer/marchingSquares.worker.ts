/**
 * marchingSquares.worker.ts
 * Web Worker — traces implicit curves F(x,y)=0 via recursive subdivision.
 *
 * Key fixes vs previous version:
 *   1. Top-right child corner assignment was WRONG (tl/tr/bl/br swapped).
 *      Correct: tl=F(mx,y1), tr=F(x1,y1), bl=F(mx,my), br=F(x1,my).
 *   2. Added segment chaining: small independent segments are joined into
 *      long polylines → solid lines instead of dots on the canvas.
 *
 * Output format: NaN-separated chains.
 *   [x0,y0, x1,y1, ..., NaN,NaN, x0,y0, x1,y1, ..., NaN,NaN, ...]
 * Each run between NaN pairs is one polyline for gl.LINE_STRIP.
 */

const COARSE_GRID = 24;
const MAX_DEPTH   = 6;

// ─────────────────────────────────────────────────────────────────────────────
// F(x,y) builder
// ─────────────────────────────────────────────────────────────────────────────

function buildFn(expr: string): ((x: number, y: number) => number) | null {
  try {
    let js = expr
      .replace(/([a-zA-Z0-9])\s*\.\s*([a-zA-Z])/g, '$1*$2')
      .replace(/\^/g, '**')
      .replace(/\bsqrt\b/g,   'Math.sqrt')
      .replace(/\babs\b/g,    'Math.abs')
      .replace(/\bsign\b/g,   'Math.sign')
      .replace(/\bsin\b/g,    'Math.sin')
      .replace(/\bcos\b/g,    'Math.cos')
      .replace(/\btan\b/g,    'Math.tan')
      .replace(/\bln\b/g,     'Math.log')
      .replace(/\blog\b/g,    'Math.log10')
      .replace(/\bexp\b/g,    'Math.exp')
      .replace(/\barcsin\b/g, 'Math.asin')
      .replace(/\barccos\b/g, 'Math.acos')
      .replace(/\barctan\b/g, 'Math.atan')
      .replace(/\bpi\b/g,     'Math.PI')
      .replace(/\be\b(?!\w)/g,'Math.E');

    // _spow: real-valued power for negative bases with fractional exponents
    // e.g. (-8)^(1/3) = -2  (real cube root, not complex)
    const helpers = `
      const _spow=(b,e)=>{
        if(!isFinite(b)||!isFinite(e))return NaN;
        if(b===0)return 0;
        if(Number.isInteger(e))return b**e;
        return b<0?-(Math.abs(b)**e):Math.abs(b)**e;
      };
    `;
    // Replace x** and y** with _spow so x^(2/3) works for x<0
    js = js
      .replace(/\bx\s*\*\*\s*(\([^()]*\)|\d+\.?\d*)/g, '_spow(x,$1)')
      .replace(/\by\s*\*\*\s*(\([^()]*\)|\d+\.?\d*)/g, '_spow(y,$1)');

    // eslint-disable-next-line no-new-func
    return new Function('x','y',`"use strict";${helpers}try{return(${js});}catch{return NaN;}`) as (x:number,y:number)=>number;
  } catch { return null; }
}

function parseToF(raw: string): ((x: number, y: number) => number) | null {
  const s = raw.trim();
  const eq = s.indexOf('=');
  if (eq < 0) {
    const fn = buildFn(s);
    return fn ? (x,y) => y - fn(x,y) : null;
  }
  const lhsFn = buildFn(s.slice(0,eq).trim());
  const rhsFn = buildFn(s.slice(eq+1).trim());
  if (!lhsFn || !rhsFn) return null;
  return (x,y) => {
    const l = lhsFn(x,y), r = rhsFn(x,y);
    return (isFinite(l) && isFinite(r)) ? l - r : NaN;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marching squares helpers
// ─────────────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, fa: number, fb: number): number {
  if (Math.abs(fa-fb) < 1e-12) return (a+b)/2;
  const t = -fa / (fb - fa);
  const result = a + (b - a) * t;
  // Snap near-zero results to zero to ensure curves touch the origin
  return Math.abs(result) < 1e-10 ? 0 : result;
}

function extractSegments(
  x0:number, y0:number, x1:number, y1:number,
  tl:number, tr:number, bl:number, br:number,
  out: number[],
): void {
  const code = (tl>0?8:0)|(tr>0?4:0)|(bl>0?2:0)|(br>0?1:0);
  if (code===0||code===15) return;

  const top    = (): [number,number] => [lerp(x0,x1,tl,tr), y1];
  const bottom = (): [number,number] => [lerp(x0,x1,bl,br), y0];
  const left   = (): [number,number] => [x0, lerp(y0,y1,bl,tl)];
  const right  = (): [number,number] => [x1, lerp(y0,y1,br,tr)];

  const push = (a:[number,number], b:[number,number]) => {
    out.push(a[0],a[1],b[0],b[1]);
  };

  // For each case, only connect edges that actually have a sign crossing.
  // Cases 5 (0101) and 10 (1010): right/left have NO crossing → connect top↔bottom only.
  // Cases 6 and 9 are saddle cases: all 4 edges have crossings → 2 segments each.
  switch (code) {
    case  1: case 14: push(bottom(), right()); break;
    case  2: case 13: push(left(),   bottom()); break;
    case  4: case 11: push(top(),    right()); break;
    case  8: case  7: push(left(),   top()); break;
    case  3: case 12: push(left(),   right()); break;
    case  5: case 10: push(top(),    bottom()); break;  // only top/bottom have crossings
    case  6: push(top(),  right()); push(left(),  bottom()); break;
    case  9: push(left(), top());   push(bottom(), right());  break;
  }
}

function subdivide(
  F: (x:number,y:number)=>number,
  x0:number, y0:number, x1:number, y1:number,
  tl:number, tr:number, bl:number, br:number,
  depth: number,
  out: number[],
): void {
  const vals = [tl,tr,bl,br];
  if (vals.some(v => !isFinite(v))) return;
  const hasPos = vals.some(v => v>0);
  const hasNeg = vals.some(v => v<0);
  if (!hasPos || !hasNeg) return;

  if (depth >= MAX_DEPTH) {
    extractSegments(x0,y0,x1,y1,tl,tr,bl,br,out);
    return;
  }

  const mx = (x0+x1)/2, my = (y0+y1)/2;
  const fml = F(x0,my), fmr = F(x1,my);
  const fmt = F(mx,y1), fmb = F(mx,y0);
  const fmm = F(mx,my);

  // Bottom-left:  x=[x0,mx], y=[y0,my]
  subdivide(F, x0,y0,mx,my,  fml,fmm,bl, fmb, depth+1, out);
  // Bottom-right: x=[mx,x1], y=[y0,my]
  subdivide(F, mx,y0,x1,my,  fmm,fmr,fmb,br,  depth+1, out);
  // Top-left:     x=[x0,mx], y=[my,y1]
  subdivide(F, x0,my,mx,y1,  tl, fmt,fml,fmm, depth+1, out);
  // Top-right:    x=[mx,x1], y=[my,y1]  ← FIXED: was (tr,fmr,fmt,fmm) WRONG
  subdivide(F, mx,my,x1,y1,  fmt,tr, fmm,fmr, depth+1, out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Segment chaining
// Joins adjacent short segments into long polylines for solid rendering.
// Adjacent cells share endpoints EXACTLY (same F values, same lerp inputs),
// so we can match endpoints by their float values.
// ─────────────────────────────────────────────────────────────────────────────

function chainSegments(segs: number[]): number[][] {
  const N = segs.length / 4;
  if (N === 0) return [];

  // Build endpoint map: "x,y" → [segIdx, ...]
  const PREC = 9;
  const enc = (x:number,y:number) => `${x.toFixed(PREC)},${y.toFixed(PREC)}`;
  const endMap = new Map<string, number[]>();

  for (let i = 0; i < N; i++) {
    const k0 = enc(segs[i*4],   segs[i*4+1]);
    const k1 = enc(segs[i*4+2], segs[i*4+3]);
    if (!endMap.has(k0)) endMap.set(k0, []); endMap.get(k0)!.push(i);
    if (!endMap.has(k1)) endMap.set(k1, []); endMap.get(k1)!.push(i);
  }

  const used = new Uint8Array(N);

  // Given segment i and one known endpoint (x,y), return the other endpoint
  const otherEnd = (i:number, x:number, y:number): [number,number] => {
    const x0=segs[i*4],y0=segs[i*4+1], x1=segs[i*4+2],y1=segs[i*4+3];
    return (Math.abs(x0-x)<1e-9 && Math.abs(y0-y)<1e-9) ? [x1,y1] : [x0,y0];
  };

  // Find next unused segment sharing point (x,y), excluding 'exclude'
  const nextSeg = (x:number, y:number, exclude:number): number => {
    for (const idx of (endMap.get(enc(x,y)) || [])) {
      if (idx !== exclude && !used[idx]) return idx;
    }
    return -1;
  };

  const chains: number[][] = [];

  for (let start = 0; start < N; start++) {
    if (used[start]) continue;
    used[start] = 1;

    let ax=segs[start*4],ay=segs[start*4+1];
    let bx=segs[start*4+2],by=segs[start*4+3];

    // Walk forward from (bx,by)
    const fwd: Array<[number,number]> = [[ax,ay],[bx,by]];
    let [cx,cy]=[bx,by], prev=start;
    while (true) {
      const next = nextSeg(cx,cy,prev);
      if (next<0) break;
      used[next]=1;
      [cx,cy] = otherEnd(next,cx,cy);
      fwd.push([cx,cy]);
      prev=next;
    }

    // Walk backward from (ax,ay)
    const bwd: Array<[number,number]> = [];
    [cx,cy]=[ax,ay]; prev=start;
    while (true) {
      const next = nextSeg(cx,cy,prev);
      if (next<0) break;
      used[next]=1;
      [cx,cy] = otherEnd(next,cx,cy);
      bwd.push([cx,cy]);
      prev=next;
    }

    // Combine: bwd reversed + fwd
    const pts: number[] = [];
    for (let i=bwd.length-1; i>=0; i--) pts.push(bwd[i][0],bwd[i][1]);
    for (const [px,py] of fwd) pts.push(px,py);

    if (pts.length >= 4) chains.push(pts);
  }

  return chains;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main trace function
// ─────────────────────────────────────────────────────────────────────────────

function traceImplicit(
  raw: string,
  xMin:number, xMax:number, yMin:number, yMax:number,
): number[] {
  const F = parseToF(raw);
  if (!F) return [];

  const segs: number[] = [];
  const dx = (xMax-xMin)/COARSE_GRID;
  const dy = (yMax-yMin)/COARSE_GRID;

  for (let row=0; row<COARSE_GRID; row++) {
    for (let col=0; col<COARSE_GRID; col++) {
      const x0=xMin+col*dx, x1=x0+dx;
      const y0=yMin+row*dy, y1=y0+dy;
      const tl=F(x0,y1), tr=F(x1,y1), bl=F(x0,y0), br=F(x1,y0);
      subdivide(F,x0,y0,x1,y1,tl,tr,bl,br,0,segs);
    }
  }

  // Chain segments into polylines
  const chains = chainSegments(segs);

  // Encode as NaN-separated flat array
  const out: number[] = [];
  for (const chain of chains) {
    if (out.length > 0) out.push(NaN, NaN);
    out.push(...chain);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker message handler
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const { id, raw, xMin, xMax, yMin, yMax } = e.data as {
    id:string; raw:string; xMin:number; xMax:number; yMin:number; yMax:number;
  };
  const flat = new Float32Array(traceImplicit(raw, xMin, xMax, yMin, yMax));
  self.postMessage({ id, segments: flat }, { transfer: [flat.buffer] });
};