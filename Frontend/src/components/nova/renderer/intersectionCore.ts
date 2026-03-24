import { MathEvaluator, type ResidualFn } from './MathEvaluator';

export interface IntersectionViewport {
  originX: number;
  originY: number;
  scale: number;
  width: number;
  height: number;
}

export interface IntersectionCurveInput {
  id: string;
  raw: string;
  segments: Float32Array[];
}

export interface IntersectionPoint {
  x: number;
  y: number;
  ids: string[];
}

const evaluator = new MathEvaluator();
export const DEFAULT_INTERSECTION_POINTS = 400;

export function computeCurveIntersections(
  curves: IntersectionCurveInput[],
  viewport: IntersectionViewport,
  maxPoints: number = DEFAULT_INTERSECTION_POINTS,
): IntersectionPoint[] {
  if (curves.length < 2) return [];

  const { scale, originX, originY, width, height } = viewport;
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

  const residualById = new Map<string, ResidualFn | null>();
  for (const curve of curves) residualById.set(curve.id, evaluator.getResidual(curve.raw));

  const pairCandidates = new Map<string, {
    ids: [string, string];
    points: Array<{ x: number; y: number }>;
  }>();
  const finalClusters: Array<IntersectionPoint & { hitCount: number }> = [];
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

    let bestCluster: (IntersectionPoint & { hitCount: number }) | null = null;
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
      const residual = residualById.get(id) ?? null;
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
    const aResidual = residualById.get(aId) ?? null;
    const bResidual = residualById.get(bId) ?? null;
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
  for (const curve of curves) {
    for (const data of curve.segments) {
      if (data.length < 4) continue;

      let segMinX = Number.POSITIVE_INFINITY;
      let segMaxX = Number.NEGATIVE_INFINITY;
      let segMinY = Number.POSITIVE_INFINITY;
      let segMaxY = Number.NEGATIVE_INFINITY;

      for (let i = 0; i < data.length; i += 2) {
        const x = data[i];
        const y = data[i + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        segMinX = Math.min(segMinX, x);
        segMaxX = Math.max(segMaxX, x);
        segMinY = Math.min(segMinY, y);
        segMaxY = Math.max(segMaxY, y);
      }

      if (
        segMaxX < xMin - xBuffer || segMinX > xMax + xBuffer
        || segMaxY < yMin - yBuffer || segMinY > yMax + yBuffer
      ) {
        continue;
      }

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
          curveId: curve.id,
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
        if (pairCandidates.size >= maxPoints * 24) break outer;
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

  const mergedClusters: Array<IntersectionPoint & { hitCount: number }> = [];
  for (const point of finalClusters) {
    const snapped = snapIntersectionPoint(point.ids, point.x, point.y);

    let bestCluster: (IntersectionPoint & { hitCount: number }) | null = null;
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