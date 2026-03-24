/**
 * GraphCanvas.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 * React wrapper around the NovaRenderer WebGL2 engine.
 *
 * KEY FIXES IN THIS VERSION:
 *
 * 1. BLANK CANVAS ON NAVIGATION
 *    Root cause: after initAfterLayout() runs and sets rendererRef.current,
 *    none of the other useEffects re-run because their deps (equations, viewport)
 *    haven't changed. The new renderer is empty.
 *    Fix: after init, we call populateRenderer() DIRECTLY and synchronously —
 *    reading all current values from refs. No effect re-runs needed.
 *
 * 2. HOVER THICKNESS NOT WORKING
 *    Root cause: scheduleRender is a useCallback with [equations] as dep.
 *    The rAF closure captures hoveredCurveRef at creation time — stale.
 *    Fix: scheduleRender has NO dependencies and reads ONLY refs. Every
 *    mutable value that scheduleRender needs lives in a ref that is kept
 *    in sync with state on every render.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import * as React from 'react';
import { ZoomIn, ZoomOut, Crosshair, Wrench, Minus, X, Sigma, Grid3X3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  NovaRenderer,
  type Viewport,
  type EquationDescriptor,
  type CurveIntersection,
  buildTickLabels,
} from './renderer/NovaRenderer';
import type { Equation } from './EquationsPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ZOOM_LEVELS    = [8, 12, 18, 25, 35, 50, 70, 100, 140, 200, 300];
const DEFAULT_ZOOM_IDX = 5;
const DENSITY_STEPS  = [0.5, 1, 1.5, 2, 3] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface GraphCanvasProps {
  equations:   Equation[];
  newFromChat: string | null;
  activeTool:  'tangent' | 'intersect' | 'area' | null;
  onToolClick: (tool: 'tangent' | 'intersect' | 'area') => void;
}

type HoveredPoint = {
  id: string;
  mathX: number;
  mathY: number;
  screenX: number;
  screenY: number;
};

const INTERSECTION_DOT_COLOR = 'hsl(var(--muted-foreground))';

function formatCoordinate(value: number): string {
  const snapped = Math.abs(value) < 0.05 ? 0 : value;
  const rounded = Math.round(snapped * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

function getIntersectionKey(point: CurveIntersection, index: number): string {
  return `${point.ids.join('|')}:${Math.round(point.x * 1e5)}:${Math.round(point.y * 1e5)}:${index}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphCanvas
// ─────────────────────────────────────────────────────────────────────────────

export function GraphCanvas({
  equations, newFromChat, activeTool, onToolClick,
}: GraphCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef    = React.useRef<HTMLCanvasElement>(null);
  const rendererRef  = React.useRef<NovaRenderer | null>(null);
  const rafRef       = React.useRef<number>(0);
  const panFrameRef  = React.useRef<number>(0);
  const pendingPanRef = React.useRef<{ x: number; y: number } | null>(null);
  const interactionTimerRef = React.useRef<number>(0);
  const intersectionTimerRef = React.useRef<number>(0);
  const resampleTimerRef = React.useRef<number>(0);
  const isInteractingRef = React.useRef(false);

  // ── UI State ──────────────────────────────────────────────────────────────
  const [cssSize,     setCssSize]     = React.useState({ w: 800, h: 600 });
  const [panOffset,   setPanOffset]   = React.useState({ x: 0, y: 0 });
  const [zoomIdx,     setZoomIdx]     = React.useState(DEFAULT_ZOOM_IDX);
  const [gridDensity, setGridDensity] = React.useState(1.5);
  const [webGLFailed, setWebGLFailed] = React.useState(false);
  const [isDragging,  setIsDragging]  = React.useState(false);
  const [mousePos,    setMousePos]    = React.useState<{ x: number; y: number } | null>(null);
  const [hoveredCurve, setHoveredCurve] = React.useState<HoveredPoint | null>(null);
  const [intersections, setIntersections] = React.useState<CurveIntersection[]>([]);
  const [hoveredIntersectionKey, setHoveredIntersectionKey] = React.useState<string | null>(null);

  // ── Refs that mirror state — ALWAYS current, safe in rAF closures ─────────
  // These are the single source of truth for scheduleRender and initAfterLayout.
  const equationsRef    = React.useRef<Equation[]>(equations);
  const panOffsetRef    = React.useRef(panOffset);
  const zoomIdxRef      = React.useRef(zoomIdx);
  const cssSizeRef      = React.useRef(cssSize);
  const gridDensityRef  = React.useRef(gridDensity);
  const hoveredIdRef    = React.useRef<string | undefined>(undefined);
  const hoveredCurveRef = React.useRef<HoveredPoint | null>(null);

  // Sync refs with state every render (synchronous, before any effects)
  equationsRef.current   = equations;
  panOffsetRef.current   = panOffset;
  zoomIdxRef.current     = zoomIdx;
  cssSizeRef.current     = cssSize;
  gridDensityRef.current = gridDensity;
  hoveredCurveRef.current = hoveredCurve;

  const dragStart         = React.useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const didDragRef        = React.useRef(false);
  const lastPinchDist     = React.useRef<number | null>(null);
  const lastResampleScale = React.useRef(ZOOM_LEVELS[DEFAULT_ZOOM_IDX]);
  const prevEqIdsRef      = React.useRef(new Set<string>());

  // ── Derived viewport values ───────────────────────────────────────────────
  const scale   = ZOOM_LEVELS[zoomIdx];
  const originX = cssSize.w / 2 + panOffset.x;
  const originY = cssSize.h / 2 + panOffset.y;

  const viewport = React.useMemo<Viewport>(() => ({
    originX, originY, scale, width: cssSize.w, height: cssSize.h,
  }), [originX, originY, scale, cssSize]);

  const tickLabels = React.useMemo(
    () => buildTickLabels(viewport, gridDensity),
    [gridDensity, viewport],
  );

  // ── scheduleRender — reads ONLY refs, zero stale closure risk ─────────────
  const scheduleRender = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const visible = new Set(
        equationsRef.current.filter(e => e.visible).map(e => e.id)
      );
      renderer.render(visible, hoveredIdRef.current);
    });
  }, []); // NO deps — intentional, uses refs only

  const flushPanOffset = React.useCallback(() => {
    if (panFrameRef.current) return;
    panFrameRef.current = requestAnimationFrame(() => {
      panFrameRef.current = 0;
      const next = pendingPanRef.current;
      if (!next) return;
      pendingPanRef.current = null;
      setPanOffset(next);
    });
  }, []);

  // ── populateRenderer — push all current state into a fresh renderer ───────
  // Called immediately after init so the canvas is never blank on navigation.
  const populateRenderer = React.useCallback((renderer: NovaRenderer) => {
    const sz  = cssSizeRef.current;
    const po  = panOffsetRef.current;
    const zi  = zoomIdxRef.current;
    const sc  = ZOOM_LEVELS[zi];
    const vp: Viewport = {
      originX: sz.w / 2 + po.x,
      originY: sz.h / 2 + po.y,
      scale:   sc,
      width:   sz.w,
      height:  sz.h,
    };

    renderer.setViewport(vp);
    renderer.setGridDensity(gridDensityRef.current);

    for (const eq of equationsRef.current) {
      renderer.upsertEquation({
        id:       eq.id,
        raw:      eq.expression,
        color:    eq.color,
        visible:  eq.visible,
        fromChat: !!eq.fromChat,
      } satisfies EquationDescriptor, () => scheduleRender());
    }
    // Render immediately — don't wait for effects
    const visible = new Set(
      equationsRef.current.filter(e => e.visible).map(e => e.id)
    );
    renderer.render(visible, hoveredIdRef.current);
  }, []); // NO deps — uses refs only

  // ── WebGL init ────────────────────────────────────────────────────────────
  const refreshIntersections = React.useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      setIntersections([]);
      return;
    }

    const visible = new Set(
      equationsRef.current.filter((eq) => eq.visible).map((eq) => eq.id),
    );
    if (visible.size < 2) {
      setIntersections([]);
      return;
    }

    renderer.requestCurveIntersections(visible, (points) => {
      if (isInteractingRef.current) return;
      setIntersections(points);
    });
  }, []);

  const scheduleIntersectionRefresh = React.useCallback((delay: number = 140) => {
    window.clearTimeout(intersectionTimerRef.current);
    intersectionTimerRef.current = window.setTimeout(() => {
      intersectionTimerRef.current = 0;
      if (isInteractingRef.current) {
        scheduleIntersectionRefresh(delay);
        return;
      }
      refreshIntersections();
    }, delay);
  }, [refreshIntersections]);

  const scheduleCurveRefresh = React.useCallback((fullDelay: number = 180) => {
    window.clearTimeout(resampleTimerRef.current);

    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.checkResample({
      quality: 'draft',
      onReady: scheduleRender,
    });
    scheduleRender();

    resampleTimerRef.current = window.setTimeout(() => {
      resampleTimerRef.current = 0;
      if (isInteractingRef.current) return;

      const liveRenderer = rendererRef.current;
      if (!liveRenderer) return;

      liveRenderer.checkResample({
        quality: 'full',
        onReady: () => {
          scheduleRender();
          scheduleIntersectionRefresh(120);
        },
      });
      scheduleRender();
    }, fullDelay);
  }, [scheduleIntersectionRefresh, scheduleRender]);

  const endInteraction = React.useCallback(() => {
    if (!isInteractingRef.current) return;
    isInteractingRef.current = false;

    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.setInteractiveMode(false);
    lastResampleScale.current = ZOOM_LEVELS[zoomIdxRef.current];
    scheduleCurveRefresh(150);
  }, [scheduleCurveRefresh]);

  const scheduleInteractionSettle = React.useCallback((delay: number = 120) => {
    window.clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = window.setTimeout(() => {
      interactionTimerRef.current = 0;
      endInteraction();
    }, delay);
  }, [endInteraction]);

  const beginInteraction = React.useCallback(() => {
    window.clearTimeout(resampleTimerRef.current);
    resampleTimerRef.current = 0;
    if (!isInteractingRef.current) {
      isInteractingRef.current = true;
      rendererRef.current?.setInteractiveMode(true);
      scheduleRender();
    }
    scheduleInteractionSettle(120);
  }, [scheduleInteractionSettle, scheduleRender]);

  // requestAnimationFrame defers until layout is complete, so
  // getBoundingClientRect() always returns real dimensions even on
  // navigate-back, fresh mount, or slow route transitions.
  React.useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    let rafId: number;

    const initAfterLayout = () => {
      const { width, height } = container.getBoundingClientRect();

      if (width === 0 || height === 0) {
        // Layout not settled yet — wait one more frame
        rafId = requestAnimationFrame(initAfterLayout);
        return;
      }

      // Size canvas at physical resolution
      canvas.width  = Math.round(width  * dpr);
      canvas.height = Math.round(height * dpr);

      // Update size state AND ref together so populateRenderer sees correct dims
      const newSize = { w: width, h: height };
      setCssSize(newSize);
      cssSizeRef.current = newSize;

      const renderer = new NovaRenderer();
      if (!renderer.init(canvas)) {
        setWebGLFailed(true);
        return;
      }
      renderer.resize(width, height, dpr);
      rendererRef.current = renderer;

      // THIS IS THE KEY FIX: populate immediately using refs.
      // We do not rely on useEffect deps to re-run — they won't because
      // equations and viewport haven't changed from React's perspective.
      populateRenderer(renderer);
    };

    rafId = requestAnimationFrame(initAfterLayout);

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(panFrameRef.current);
      window.clearTimeout(interactionTimerRef.current);
      window.clearTimeout(intersectionTimerRef.current);
      window.clearTimeout(resampleTimerRef.current);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resize observer ───────────────────────────────────────────────────────
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const ro  = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const canvas = canvasRef.current;
      if (!canvas || width === 0 || height === 0) return;
      canvas.width  = Math.round(width  * dpr);
      canvas.height = Math.round(height * dpr);
      setCssSize({ w: width, h: height });
      rendererRef.current?.resize(width, height, dpr);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Sync equations → renderer ─────────────────────────────────────────────
  React.useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const currentIds = new Set(equations.map(e => e.id));

    for (const id of prevEqIdsRef.current) {
      if (!currentIds.has(id)) renderer.removeEquation(id);
    }
    for (const eq of equations) {
      renderer.upsertEquation({
        id:       eq.id,
        raw:      eq.expression,
        color:    eq.color,
        visible:  eq.visible,
        fromChat: !!eq.fromChat,
      } satisfies EquationDescriptor, () => {
        scheduleRender();
        scheduleIntersectionRefresh(120);
      });
    }

    prevEqIdsRef.current = currentIds;
    scheduleRender();
    setHoveredIntersectionKey(null);
    scheduleIntersectionRefresh(60);
  }, [equations, scheduleIntersectionRefresh, scheduleRender]);

  // ── Sync viewport → renderer ──────────────────────────────────────────────
  React.useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.setViewport(viewport);
    scheduleRender();

    if (!isInteractingRef.current) {
      lastResampleScale.current = scale;
      setHoveredIntersectionKey(null);
      scheduleCurveRefresh(180);
    }
  }, [viewport, scale, scheduleCurveRefresh, scheduleRender]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync grid density → renderer ──────────────────────────────────────────
  React.useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setGridDensity(gridDensity);
    scheduleRender();
  }, [gridDensity]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setHoveredCurve((prev) => {
      if (!prev) return prev;
      const screenX = originX + prev.mathX * scale;
      const screenY = originY - prev.mathY * scale;
      if (Math.abs(prev.screenX - screenX) < 0.5 && Math.abs(prev.screenY - screenY) < 0.5) {
        return prev;
      }
      return { ...prev, screenX, screenY };
    });
  }, [originX, originY, scale]);

  // ── Re-render on hover change ─────────────────────────────────────────────
  // hoveredIdRef is updated BEFORE setHoveredCurve is called, so by the time
  // this effect fires and calls scheduleRender, the ref holds the correct id.
  React.useEffect(() => {
    scheduleRender();
  }, [hoveredCurve?.id, scheduleRender]);

  // ── Block browser pinch/trackpad zoom at document level ───────────────────
  React.useEffect(() => {
    const onTouch = (e: TouchEvent) => { if (e.touches.length >= 2) e.preventDefault(); };
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    document.addEventListener('touchstart', onTouch, { passive: false });
    document.addEventListener('touchmove',  onTouch, { passive: false });
    document.addEventListener('wheel',      onWheel, { passive: false });
    return () => {
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('touchmove',  onTouch);
      document.removeEventListener('wheel',      onWheel);
    };
  }, []);

  // ── Coordinate helper ─────────────────────────────────────────────────────
  const commitHover = React.useCallback((next: HoveredPoint | null) => {
    const prev = hoveredCurveRef.current;
    if (next === null) {
      if (prev !== null || hoveredIdRef.current !== undefined) {
        hoveredIdRef.current = undefined;
        hoveredCurveRef.current = null;
        setHoveredCurve(null);
      }
      return;
    }

    const unchanged = prev
      && prev.id === next.id
      && Math.abs(prev.screenX - next.screenX) < 0.5
      && Math.abs(prev.screenY - next.screenY) < 0.5;
    if (unchanged) return;

    hoveredIdRef.current = next.id;
    hoveredCurveRef.current = next;
    setHoveredCurve(next);
  }, []);

  const probeHoverAt = React.useCallback((sx: number, sy: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const sz = cssSizeRef.current;
    const po = panOffsetRef.current;
    const sc = ZOOM_LEVELS[zoomIdxRef.current];
    const ox = sz.w / 2 + po.x;
    const oy = sz.h / 2 + po.y;
    const mathX = (sx - ox) / sc;
    const mathY = (oy - sy) / sc;
    const threshold = 10;
    let bestPoint: HoveredPoint | null = null;
    let bestPixelDist = Number.POSITIVE_INFINITY;

    for (const eq of equationsRef.current) {
      if (!eq.visible) continue;
      const y = renderer.getCurveYAtX(eq.id, mathX, mathY, threshold, sc);
      if (y === null) continue;

      const pixelDist = Math.abs(mathY - y) * sc;
      if (pixelDist >= bestPixelDist) continue;

      bestPixelDist = pixelDist;
      bestPoint = {
        id: eq.id,
        mathX,
        mathY: y,
        screenX: ox + mathX * sc,
        screenY: oy - y * sc,
      };
    }

    commitHover(bestPoint);
  }, [commitHover]);

  // ── Mouse events ──────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    didDragRef.current = false;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: panOffset.x, py: panOffset.y };
    setMousePos(null);
    setHoveredIntersectionKey(null);
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx   = e.clientX - rect.left;
    const sy   = e.clientY - rect.top;

    if (isDragging && dragStart.current) {
      if (
        Math.abs(e.clientX - dragStart.current.mx) > 3
        || Math.abs(e.clientY - dragStart.current.my) > 3
      ) {
        didDragRef.current = true;
      }
      beginInteraction();
      pendingPanRef.current = {
        x: dragStart.current.px + e.clientX - dragStart.current.mx,
        y: dragStart.current.py + e.clientY - dragStart.current.my,
      };
      flushPanOffset();
      return;
    }

    setMousePos({ x: sx, y: sy });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStart.current = null;
    scheduleInteractionSettle(70);
  };
  const handleMouseLeave = () => {
    handleMouseUp();
    setMousePos(null);
    setHoveredIntersectionKey(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setHoveredIntersectionKey(null);
    probeHoverAt(sx, sy);
  };

  // ── Zoom towards a point (keeps math under cursor fixed) ──────────────────
  const zoomTowards = React.useCallback((focusX: number, focusY: number, delta: number) => {
    setZoomIdx(prev => {
      const nextIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, prev + delta));
      if (nextIdx === prev) return prev;

      const oldScale = ZOOM_LEVELS[prev];
      const newScale = ZOOM_LEVELS[nextIdx];
      // Read from refs so this is always fresh even in touch handlers
      const sz    = cssSizeRef.current;
      const po    = panOffsetRef.current;
      const ox    = sz.w / 2 + po.x;
      const oy    = sz.h / 2 + po.y;
      const mathX = (focusX - ox) / oldScale;
      const mathY = (oy - focusY) / oldScale;

      setPanOffset({
        x: focusX - sz.w / 2 - mathX * newScale,
        y: focusY - sz.h / 2 + mathY * newScale,
      });
      return nextIdx;
    });
  }, []); // uses refs only

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    beginInteraction();
    zoomTowards(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1 : -1);
  };

  // ── Touch events ──────────────────────────────────────────────────────────
  const handleTouchStartReact = (e: React.TouchEvent<HTMLCanvasElement>) => {
    setHoveredIntersectionKey(null);
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1) {
      dragStart.current = {
        mx: e.touches[0].clientX, my: e.touches[0].clientY,
        px: panOffsetRef.current.x, py: panOffsetRef.current.y,
      };
      setIsDragging(true);
    }
  };

  const handleTouchMoveReact = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dx    = e.touches[0].clientX - e.touches[1].clientX;
      const dy    = e.touches[0].clientY - e.touches[1].clientY;
      const dist  = Math.sqrt(dx * dx + dy * dy);
      const ratio = dist / lastPinchDist.current;
      const rect  = canvasRef.current!.getBoundingClientRect();
      const cx    = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy    = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      beginInteraction();
      if (ratio > 1.06)  { zoomTowards(cx, cy,  1); lastPinchDist.current = dist; }
      else if (ratio < 0.94) { zoomTowards(cx, cy, -1); lastPinchDist.current = dist; }
    } else if (e.touches.length === 1 && isDragging && dragStart.current) {
      beginInteraction();
      pendingPanRef.current = {
        x: dragStart.current.px + e.touches[0].clientX - dragStart.current.mx,
        y: dragStart.current.py + e.touches[0].clientY - dragStart.current.my,
      };
      flushPanOffset();
    }
  };

  const handleTouchEnd = () => {
    lastPinchDist.current = null;
    setIsDragging(false);
    dragStart.current = null;
    scheduleInteractionSettle(90);
  };

  const resetView = () => { setPanOffset({ x: 0, y: 0 }); setZoomIdx(DEFAULT_ZOOM_IDX); };

  // ── Hover colour ──────────────────────────────────────────────────────────
  const hoveredEqColor = React.useMemo(() => {
    if (!hoveredCurve) return null;
    const eq = equations.find(e => e.id === hoveredCurve.id);
    return eq ? `hsl(var(--${eq.color}))` : 'hsl(var(--primary))';
  }, [hoveredCurve, equations]);

  const visibleIntersections = React.useMemo(() => (
    intersections
      .map((point, index) => {
        const screenX = originX + point.x * scale;
        const screenY = originY - point.y * scale;
        return {
          key: getIntersectionKey(point, index),
          point,
          screenX,
          screenY,
        };
      })
      .filter(({ screenX, screenY }) => (
        screenX >= -12
        && screenX <= cssSize.w + 12
        && screenY >= -12
        && screenY <= cssSize.h + 12
      ))
  ), [cssSize.h, cssSize.w, intersections, originX, originY, scale]);

  const hoveredIntersection = React.useMemo(
    () => visibleIntersections.find((item) => item.key === hoveredIntersectionKey) ?? null,
    [hoveredIntersectionKey, visibleIntersections],
  );

  React.useEffect(() => {
    if (!hoveredIntersectionKey) return;
    if (visibleIntersections.some((item) => item.key === hoveredIntersectionKey)) return;
    setHoveredIntersectionKey(null);
  }, [hoveredIntersectionKey, visibleIntersections]);

  const hoveredCurveLabel = hoveredCurve
    ? `(${formatCoordinate(hoveredCurve.mathX)}, ${formatCoordinate(hoveredCurve.mathY)})`
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (webGLFailed) {
    return (
      <div className="flex-1 flex items-center justify-center bg-novaa-surface text-muted-foreground text-sm">
        WebGL2 not supported. Please use Chrome, Edge, or Firefox.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div ref={containerRef} className="relative flex-1 overflow-hidden bg-novaa-surface">

        {/* WebGL canvas */}
        <canvas
          ref={canvasRef}
          style={{
            position:    'absolute',
            inset:       0,
            width:       '100%',
            height:      '100%',
            cursor:      'default',
            touchAction: 'none',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleCanvasClick}
          onWheel={handleWheel}
          onTouchStart={handleTouchStartReact}
          onTouchMove={handleTouchMoveReact}
          onTouchEnd={handleTouchEnd}
        />

        {/* Tick labels HTML overlay */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', userSelect: 'none' }} aria-hidden>
          {tickLabels.map((lbl, i) => (
            <span key={i} style={{
              position:   'absolute',
              left:       lbl.x,
              top:        lbl.y,
              transform:  lbl.anchor === 'middle' ? 'translateX(-50%)' : 'translateX(-100%)',
              fontSize:   '10px',
              lineHeight: 1,
              color:      'hsl(var(--muted-foreground))',
              fontFamily: 'var(--font-mono)',
            }}>{lbl.text}</span>
          ))}
          <span style={{ position: 'absolute', left: Math.max(4, Math.min(cssSize.w - 18, originX + 6)), top: 12, fontSize: '10px', color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)' }}>y</span>
          <span style={{ position: 'absolute', left: cssSize.w - 14, top: Math.max(12, Math.min(cssSize.h - 4, originY + 12)), fontSize: '10px', color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)' }}>x</span>
        </div>

        {visibleIntersections.map(({ key, point, screenX, screenY }) => {
          const isHovered = hoveredIntersectionKey === key;
          const size = isHovered ? 9 : 7;
          return (
            <div
              key={key}
              onMouseEnter={() => setHoveredIntersectionKey(key)}
              onMouseLeave={() => setHoveredIntersectionKey((current) => (current === key ? null : current))}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: screenX - size / 2,
                top: screenY - size / 2,
                width: size,
                height: size,
                borderRadius: '50%',
                background: INTERSECTION_DOT_COLOR,
                boxShadow: '0 0 0 2px hsl(var(--background))',
                pointerEvents: 'auto',
                zIndex: 9,
                cursor: 'default',
              }}
              aria-label={`Intersection at ${formatCoordinate(point.x)}, ${formatCoordinate(point.y)}`}
            />
          );
        })}

        {hoveredIntersection && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(cssSize.w - 12, hoveredIntersection.screenX + 12),
              top: Math.max(10, hoveredIntersection.screenY - 32),
              transform: 'translateY(-100%)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                background: 'rgba(20, 24, 32, 0.92)',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                color: 'hsl(var(--foreground))',
                fontSize: 11,
                lineHeight: 1.2,
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              ({formatCoordinate(hoveredIntersection.point.x)}, {formatCoordinate(hoveredIntersection.point.y)})
            </div>
          </div>
        )}

        {hoveredCurve && hoveredEqColor && (
          <div style={{ position: 'absolute', pointerEvents: 'none', zIndex: 10 }}>
            <div style={{
              position: 'absolute', left: hoveredCurve.screenX - 5, top: hoveredCurve.screenY - 5,
              width: 10, height: 10, borderRadius: '50%', background: hoveredEqColor,
              boxShadow: `0 0 0 2px hsl(var(--background))`,
            }} />
            {hoveredCurveLabel && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(cssSize.w - 12, hoveredCurve.screenX + 12),
                  top: Math.max(10, hoveredCurve.screenY - 34),
                  transform: 'translateY(-100%)',
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: 'rgba(20, 24, 32, 0.92)',
                  border: `1px solid ${hoveredEqColor}`,
                  color: 'hsl(var(--foreground))',
                  fontSize: 11,
                  lineHeight: 1.2,
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                }}
              >
                {hoveredCurveLabel}
              </div>
            )}
          </div>
        )}

        {/* Crosshair */}
        {mousePos && !isDragging && (
          <div style={{ position: 'absolute', left: mousePos.x, top: mousePos.y, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', width: 1,  height: 20, background: 'hsl(var(--primary)/0.2)', transform: 'translate(-50%, -50%)' }} />
            <div style={{ position: 'absolute', width: 20, height: 1,  background: 'hsl(var(--primary)/0.2)', transform: 'translate(-50%, -50%)' }} />
            <div style={{ position: 'absolute', width: 6,  height: 6,  borderRadius: '50%', background: 'hsl(var(--primary)/0.35)', transform: 'translate(-50%, -50%)' }} />
          </div>
        )}

        {/* From-chat banner */}
        {newFromChat && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 20, pointerEvents: 'none' }}
            className="animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-primary">Plotted from chat</span>
            </div>
          </div>
        )}

        {/* Floating controls */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 bg-card/90 backdrop-blur-sm border border-border/60 text-muted-foreground hover:text-foreground shadow-sm">
                <Wrench className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-44">
              <DropdownMenuItem className={cn(activeTool === 'tangent'   && 'bg-primary/10 text-primary')} onClick={() => onToolClick('tangent')}>
                <Minus className="w-3.5 h-3.5 mr-2" />Tangent line<kbd className="ml-auto text-[10px] text-muted-foreground">T</kbd>
              </DropdownMenuItem>
              <DropdownMenuItem className={cn(activeTool === 'intersect' && 'bg-primary/10 text-primary')} onClick={() => onToolClick('intersect')}>
                <X     className="w-3.5 h-3.5 mr-2" />Intersection<kbd className="ml-auto text-[10px] text-muted-foreground">I</kbd>
              </DropdownMenuItem>
              <DropdownMenuItem className={cn(activeTool === 'area'      && 'bg-primary/10 text-primary')} onClick={() => onToolClick('area')}>
                <Sigma className="w-3.5 h-3.5 mr-2" />Area (∫)<kbd className="ml-auto text-[10px] text-muted-foreground">A</kbd>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-5 bg-border/50 mx-0.5" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon"
                className="h-8 w-8 bg-card/90 backdrop-blur-sm border border-border/60 text-muted-foreground hover:text-foreground shadow-sm"
                onClick={() => {
                  const idx  = DENSITY_STEPS.indexOf(gridDensity as any);
                  const next = DENSITY_STEPS[(idx + 1) % DENSITY_STEPS.length];
                  setGridDensity(next);
                }}>
                <Grid3X3 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Grid density (cycle)</TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-border/50 mx-0.5" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon"
                className="h-8 w-8 bg-card/90 backdrop-blur-sm border border-border/60 text-muted-foreground hover:text-foreground shadow-sm"
                onClick={() => zoomTowards(cssSizeRef.current.w / 2, cssSizeRef.current.h / 2, 1)}
                disabled={zoomIdx === ZOOM_LEVELS.length - 1}>
                <ZoomIn className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom in (scroll)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon"
                className="h-8 w-8 bg-card/90 backdrop-blur-sm border border-border/60 text-muted-foreground hover:text-foreground shadow-sm"
                onClick={() => zoomTowards(cssSizeRef.current.w / 2, cssSizeRef.current.h / 2, -1)}
                disabled={zoomIdx === 0}>
                <ZoomOut className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom out (scroll)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon"
                className="h-8 w-8 bg-card/90 backdrop-blur-sm border border-border/60 text-muted-foreground hover:text-foreground shadow-sm"
                onClick={resetView}>
                <Crosshair className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reset view</TooltipContent>
          </Tooltip>
        </div>

      </div>
    </TooltipProvider>
  );
}