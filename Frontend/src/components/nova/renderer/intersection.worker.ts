import {
  computeCurveIntersections,
  type IntersectionCurveInput,
  type IntersectionPoint,
  type IntersectionViewport,
} from './intersectionCore.ts';

self.onmessage = (e: MessageEvent) => {
  const {
    id,
    curves,
    viewport,
    maxPoints,
  } = e.data as {
    id: number;
    curves: IntersectionCurveInput[];
    viewport: IntersectionViewport;
    maxPoints?: number;
  };

  const intersections: IntersectionPoint[] = computeCurveIntersections(
    curves,
    viewport,
    maxPoints ?? 120,
  );

  self.postMessage({ id, intersections });
};