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
  buildTickLabels,
  type TickLabel,
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

  // ── UI State ──────────────────────────────────────────────────────────────
  const [cssSize,     setCssSize]     = React.useState({ w: 800, h: 600 });
  const [panOffset,   setPanOffset]   = React.useState({ x: 0, y: 0 });
  const [zoomIdx,     setZoomIdx]     = React.useState(DEFAULT_ZOOM_IDX);
  const [tickLabels,  setTickLabels]  = React.useState<TickLabel[]>([]);
  const [gridDensity, setGridDensity] = React.useState(1.5);
  const [webGLFailed, setWebGLFailed] = React.useState(false);
  const [isDragging,  setIsDragging]  = React.useState(false);
  const [mousePos,    setMousePos]    = React.useState<{ x: number; y: number } | null>(null);
  const [hoveredCurve, setHoveredCurve] = React.useState<{
    id: string; mathX: number; mathY: number; screenX: number; screenY: number;
  } | null>(null);

  // ── Refs that mirror state — ALWAYS current, safe in rAF closures ─────────
  // These are the single source of truth for scheduleRender and initAfterLayout.
  const equationsRef    = React.useRef<Equation[]>(equations);
  const panOffsetRef    = React.useRef(panOffset);
  const zoomIdxRef      = React.useRef(zoomIdx);
  const cssSizeRef      = React.useRef(cssSize);
  const gridDensityRef  = React.useRef(gridDensity);
  const hoveredIdRef    = React.useRef<string | undefined>(undefined);

  // Sync refs with state every render (synchronous, before any effects)
  equationsRef.current   = equations;
  panOffsetRef.current   = panOffset;
  zoomIdxRef.current     = zoomIdx;
  cssSizeRef.current     = cssSize;
  gridDensityRef.current = gridDensity;

  const dragStart         = React.useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
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
      } satisfies EquationDescriptor);
    }

    setTickLabels(buildTickLabels(vp, gridDensityRef.current));

    // Render immediately — don't wait for effects
    const visible = new Set(
      equationsRef.current.filter(e => e.visible).map(e => e.id)
    );
    renderer.render(visible, hoveredIdRef.current);
  }, []); // NO deps — uses refs only

  // ── WebGL init ────────────────────────────────────────────────────────────
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
      } satisfies EquationDescriptor);
    }

    prevEqIdsRef.current = currentIds;
    scheduleRender();
  }, [equations, scheduleRender]);

  // ── Sync viewport → renderer ──────────────────────────────────────────────
  React.useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.setViewport(viewport);

    // Always call checkResample — it checks internally whether pan/zoom
    // has moved the view outside the sampled range. With SAMPLE_MARGIN=2.0
    // this only does real work after panning ~200% of the canvas width.
    renderer.checkResample();
    lastResampleScale.current = scale;

    setTickLabels(buildTickLabels(viewport, gridDensityRef.current));
    scheduleRender();
  }, [viewport, scheduleRender]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync grid density → renderer ──────────────────────────────────────────
  React.useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setGridDensity(gridDensity);
    setTickLabels(buildTickLabels(viewport, gridDensity));
    scheduleRender();
  }, [gridDensity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-render on hover change ─────────────────────────────────────────────
  // hoveredIdRef is updated BEFORE setHoveredCurve is called, so by the time
  // this effect fires and calls scheduleRender, the ref holds the correct id.
  React.useEffect(() => {
    scheduleRender();
  }, [hoveredCurve, scheduleRender]);

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
  const toMath = (sx: number, sy: number) => ({
    mathX: (sx - originX) / scale,
    mathY: (originY - sy) / scale,
  });

  // ── Mouse events ──────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: panOffset.x, py: panOffset.y };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx   = e.clientX - rect.left;
    const sy   = e.clientY - rect.top;
    setMousePos({ x: sx, y: sy });

    if (isDragging && dragStart.current) {
      setPanOffset({
        x: dragStart.current.px + e.clientX - dragStart.current.mx,
        y: dragStart.current.py + e.clientY - dragStart.current.my,
      });
      return;
    }

    const renderer = rendererRef.current;
    if (!renderer) return;

    const { mathX, mathY } = toMath(sx, sy);
    const THRESHOLD = 10;
    let found = false;

    for (const eq of equations) {
      if (!eq.visible) continue;
      const y = renderer.getCurveYAtX(eq.id, mathX, mathY, THRESHOLD, scale);
      if (y !== null) {
        // Update ref FIRST, then state — so the effect fires with correct ref
        hoveredIdRef.current = eq.id;
        setHoveredCurve({
          id:      eq.id,
          mathX,
          mathY:   y,
          screenX: originX + mathX * scale,
          screenY: originY - y * scale,
        });
        found = true;
        break;
      }
    }
    if (!found) {
      hoveredIdRef.current = undefined;
      setHoveredCurve(null);
    }
  };

  const handleMouseUp = () => { setIsDragging(false); dragStart.current = null; };
  const handleMouseLeave = () => {
    handleMouseUp();
    setMousePos(null);
    hoveredIdRef.current = undefined;
    setHoveredCurve(null);
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
    zoomTowards(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1 : -1);
  };

  // ── Touch events ──────────────────────────────────────────────────────────
  const handleTouchStartReact = (e: React.TouchEvent<HTMLCanvasElement>) => {
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
      if (ratio > 1.06)  { zoomTowards(cx, cy,  1); lastPinchDist.current = dist; }
      else if (ratio < 0.94) { zoomTowards(cx, cy, -1); lastPinchDist.current = dist; }
    } else if (e.touches.length === 1 && isDragging && dragStart.current) {
      setPanOffset({
        x: dragStart.current.px + e.touches[0].clientX - dragStart.current.mx,
        y: dragStart.current.py + e.touches[0].clientY - dragStart.current.my,
      });
    }
  };

  const handleTouchEnd = () => {
    lastPinchDist.current = null;
    setIsDragging(false);
    dragStart.current = null;
  };

  const resetView = () => { setPanOffset({ x: 0, y: 0 }); setZoomIdx(DEFAULT_ZOOM_IDX); };

  // ── Hover colour ──────────────────────────────────────────────────────────
  const hoveredEqColor = React.useMemo(() => {
    if (!hoveredCurve) return null;
    const eq = equations.find(e => e.id === hoveredCurve.id);
    return eq ? `hsl(var(--${eq.color}))` : 'hsl(var(--primary))';
  }, [hoveredCurve, equations]);

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
            cursor:      isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
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

        {/* Hover dot + tooltip */}
        {hoveredCurve && hoveredEqColor && (
          <div style={{ position: 'absolute', pointerEvents: 'none', zIndex: 10 }}>
            <div style={{
              position: 'absolute', left: hoveredCurve.screenX - 5, top: hoveredCurve.screenY - 5,
              width: 10, height: 10, borderRadius: '50%', background: hoveredEqColor,
              boxShadow: `0 0 0 2px hsl(var(--background))`,
            }} />
            <div style={{
              position: 'absolute',
              left: hoveredCurve.screenX + (hoveredCurve.screenX > cssSize.w - 120 ? -110 : 14),
              top: Math.max(8, hoveredCurve.screenY - 22),
              background: 'hsl(var(--popover))', border: '0.5px solid hsl(var(--border))',
              borderRadius: 6, padding: '4px 8px', fontSize: 10,
              fontFamily: 'var(--font-mono)', color: 'hsl(var(--muted-foreground))',
              lineHeight: 1.6, whiteSpace: 'nowrap',
            }}>
              x: {hoveredCurve.mathX.toFixed(3)}<br />y: {hoveredCurve.mathY.toFixed(3)}
            </div>
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