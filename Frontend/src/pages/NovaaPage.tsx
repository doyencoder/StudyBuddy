import * as React from "react";
import { useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { EquationsPanel, type Equation } from "@/components/novaa/EquationsPanel";
import { GraphCanvas } from "@/components/novaa/GraphCanvas";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Four maximally distinct hues: blue, red/coral, green, magenta.
// Cycled when adding new equations.
const CURVE_COLORS = [
  "novaa-curve-1",  // vivid sky blue   (210°)
  "novaa-curve-2",  // vivid red/coral  (  4°)
  "novaa-curve-3",  // vivid green      (142°)
  "novaa-curve-4",  // vivid magenta    (290°)
] as const;

const STORAGE_KEY = "novaa_equations";

const MIN_PANEL_WIDTH     = 140;  // px — minimum equations panel width
const MAX_PANEL_WIDTH     = 380;  // px — maximum equations panel width
const DEFAULT_PANEL_WIDTH = 220;  // px — default equations panel width

// ─────────────────────────────────────────────────────────────────────────────
// Session storage helpers
// Equations survive navigation within the session (e.g. going to Settings
// and coming back) but are cleared on browser tab close.
// ─────────────────────────────────────────────────────────────────────────────

function loadEquations(): Equation[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEquations(eqs: Equation[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(eqs));
  } catch {
    // Storage might be full — silently ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// nextColor
// Returns the first color in CURVE_COLORS not already used by any existing
// equation or group. This guarantees every new equation/group gets a
// visually distinct color (up to 4; after that it cycles).
// Each group counts as one color slot even if it has multiple y= halves.
// ─────────────────────────────────────────────────────────────────────────────

function nextColor(existing: Equation[]): string {
  const usedColors  = new Set<string>();
  const seenGroups  = new Set<string>();

  for (const eq of existing) {
    if (eq.groupId) {
      // Only count the group's color once, not once per equation
      if (!seenGroups.has(eq.groupId)) {
        seenGroups.add(eq.groupId);
        usedColors.add(eq.color);
      }
    } else {
      usedColors.add(eq.color);
    }
  }

  // First unused color
  for (const c of CURVE_COLORS) {
    if (!usedColors.has(c)) return c;
  }

  // All 4 slots used — cycle based on how many distinct objects are plotted
  return CURVE_COLORS[usedColors.size % CURVE_COLORS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// NovaaPage component
// ─────────────────────────────────────────────────────────────────────────────

const NovaaPage = () => {
  const { state: sidebarState } = useSidebar();
  const location                = useLocation();

  // ── State ──────────────────────────────────────────────────────────────────
  const [equations, setEquationsRaw] = React.useState<Equation[]>(loadEquations);
  const [activeTool, setActiveTool]  = React.useState<"tangent" | "intersect" | "area" | null>(null);
  const [newFromChat, setNewFromChat] = React.useState<string | null>(null);
  const [panelWidth, setPanelWidth]  = React.useState(DEFAULT_PANEL_WIDTH);
  const isResizing = React.useRef(false);

  // When the AppSidebar is fully expanded (text labels visible), collapse the
  // equations panel to icon-only mode to preserve canvas space.
  const equationsPanelCollapsed = sidebarState === "expanded";

  // ── Wrapped setEquations that also persists to sessionStorage ──────────────
  const setEquations = React.useCallback(
    (updater: Equation[] | ((prev: Equation[]) => Equation[])) => {
      setEquationsRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        saveEquations(next);
        return next;
      });
    },
    [],
  );

  // ── Handle equation arriving from ChatPage via React Router state ──────────
  // ChatPage sets location.state = { equation: "y = x^2" } (or equations: [...])
  // when the user clicks a clickable equation chip in the chat.
  React.useEffect(() => {
    const state = location.state as { equation?: string; equations?: string[] } | null;
    if (!state) return;

    const incoming: string[] = state.equations ?? (state.equation ? [state.equation] : []);
    if (!incoming.length) return;

    setEquations((prev) => {
      const updated = [...prev];
      const color   = nextColor(updated);
      const groupId = incoming.length > 1 ? `group_${Date.now()}` : undefined;

      incoming.forEach((expr) => {
        // Skip duplicates
        if (updated.some((e) => e.expression === expr)) return;
        updated.push({
          id:       String(Date.now() + Math.random()),
          expression: expr,
          color,
          visible:  true,
          fromChat: true,
          groupId,
        });
      });

      return updated;
    });

    // Show the "Plotted from chat" banner briefly
    setNewFromChat(String(Date.now()));
    const t = setTimeout(() => setNewFromChat(null), 3500);

    // Clear router state so navigating away and back doesn't re-add
    window.history.replaceState({}, "");

    return () => clearTimeout(t);
  }, [location.state]);

  // ── Add equations (from EquationsPanel input — Math or AI mode) ────────────
  // All equations in one batch share the same color and optionally a groupId
  // (e.g. the two halves of an ellipse are one batch with one groupId).
  // displayExpression: the pretty implicit form for the panel (e.g. "x^2/9 + y^2/4 = 1");
  // only stored on the first equation of a group.
  const handleAddEquations = (
    exprs: string[],
    _label: string,
    groupId?: string,
    displayExpression?: string,
  ) => {
    setEquations((prev) => {
      const updated = [...prev];
      const color   = nextColor(updated);
      const gid     = groupId ?? (exprs.length > 1 ? `group_${Date.now()}` : undefined);

      exprs.forEach((expr, idx) => {
        // Skip exact duplicates
        if (updated.some((e) => e.expression === expr)) return;

        updated.push({
          id:         String(Date.now() + Math.random()),
          expression: expr,
          // Only the first equation of a group carries the displayExpression
          displayExpression: idx === 0 ? displayExpression : undefined,
          color,
          visible:    true,
          fromChat:   false,
          groupId:    gid,
        });
      });

      return updated;
    });
  };

  // ── Individual equation actions ────────────────────────────────────────────

  const handleToggleVisibility = (id: string) =>
    setEquations((prev) =>
      prev.map((eq) => eq.id === id ? { ...eq, visible: !eq.visible } : eq),
    );

  const handleDelete = (id: string) =>
    setEquations((prev) => prev.filter((eq) => eq.id !== id));

  // When an equation is edited, clear its displayExpression (it no longer
  // matches the implicit form) so the panel shows the new raw expression.
  const handleEdit = (id: string, newExpr: string) =>
    setEquations((prev) =>
      prev.map((eq) =>
        eq.id === id
          ? { ...eq, expression: newExpr, displayExpression: undefined }
          : eq,
      ),
    );

  // ── Quick tool buttons (Tangent / Intersection / Area) ────────────────────
  // Clicking an active tool deactivates it (toggle behaviour).
  const handleToolClick = (tool: "tangent" | "intersect" | "area") =>
    setActiveTool((prev) => (prev === tool ? null : tool));

  // ── Resizable equations panel ─────────────────────────────────────────────
  // Drag the 1.5px handle on the right edge of the panel to resize it.
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startW = panelWidth;

    const onMove = (me: MouseEvent) => {
      if (!isResizing.current) return;
      const newW = startW + me.clientX - startX;
      setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, newW)));
    };

    const onUp = () => {
      isResizing.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 overflow-hidden" style={{ height: "100%" }}>

      {/* ── Equations panel (left column) ─────────────────────────────────── */}
      {/* Width is controlled here; EquationsPanel itself uses w-full. */}
      <div
        className="relative flex shrink-0"
        style={{ width: equationsPanelCollapsed ? 40 : panelWidth }}
      >
        <EquationsPanel
          isCollapsed={equationsPanelCollapsed}
          equations={equations}
          onToggleVisibility={handleToggleVisibility}
          onDelete={handleDelete}
          onAddEquations={handleAddEquations}
          onEditEquation={handleEdit}
        />

        {/* Drag handle — only visible when panel is expanded */}
        {!equationsPanelCollapsed && (
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize z-10 hover:bg-primary/30 active:bg-primary/50 transition-colors"
          />
        )}
      </div>

      {/* ── Graph canvas (right, fills remaining space) ───────────────────── */}
      {/* No padding or wrapper box — canvas starts immediately after the panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <GraphCanvas
          equations={equations}
          newFromChat={newFromChat}
          activeTool={activeTool}
          onToolClick={handleToolClick}
        />
      </div>

    </div>
  );
};

export default NovaaPage;