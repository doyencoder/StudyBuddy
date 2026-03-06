import { useState, useEffect } from "react";
import { ImageIcon, GitBranch, Network, RefreshCw, X, Download, Code, ZoomIn } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import mermaid from "mermaid";

// Ensure mermaid is initialized regardless of which page loads first
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    darkMode: true,
    background: "#1a1a2e",
    primaryColor: "#6366f1",
    primaryTextColor: "#e2e8f0",
    lineColor: "#6366f1",
    edgeLabelBackground: "#1e1e3f",
  },
  flowchart: { curve: "basis", htmlLabels: true },
  mindmap: { padding: 16 },
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiagramItem {
  diagram_id: string;
  type: string;          // "flowchart" | "diagram" | "image"
  topic: string;
  mermaid_code: string;
  image_url?: string;    // present for type="image"
  created_at: string;
  conversation_id: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8000";
const USER_ID = "student-001";

// ── Download helper ───────────────────────────────────────────────────────────

function downloadPNG(svgContent: string, filename: string) {
  // Use base64 data URL so the canvas is never tainted by blob URL origin
  const b64 = btoa(unescape(encodeURIComponent(svgContent)));
  const dataUrl = `data:image/svg+xml;base64,${b64}`;
  const img = new Image();
  img.onload = () => {
    const scale = 2; // retina quality
    const w = img.naturalWidth  || 1200;
    const h = img.naturalHeight || 800;
    const canvas = document.createElement("canvas");
    canvas.width  = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${filename.replace(/\s+/g, "_")}.png`;
    a.click();
  };
  img.src = dataUrl;
}

// ── DiagramPreview (card thumbnail) ───────────────────────────────────────────

const DiagramPreview = ({ item }: { item: DiagramItem }) => {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState(false);
  const id = `preview-${item.diagram_id.replace(/-/g, "")}`;

  useEffect(() => {
    // Real images don't need Mermaid rendering
    if (item.type === "image") return;
    if (!item.mermaid_code) return;
    mermaid
      .render(id, item.mermaid_code)
      .then(({ svg: renderedSvg }) => setSvg(renderedSvg))
      .catch(() => {
        const leaked = document.getElementById(`d${id}`);
        if (leaked) leaked.remove();
        setError(true);
      });
  }, [item.mermaid_code]);

  // ── Real AI-generated image ───────────────────────────────────────────────
  if (item.type === "image") {
    return (
      <div className="aspect-video bg-secondary/50 rounded-t-xl overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.topic}
            className="w-full h-full object-cover"
            onError={() => setError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-10 h-10 text-muted-foreground/40" />
          </div>
        )}
      </div>
    );
  }

  // ── Mermaid diagram (flowchart / mindmap) ─────────────────────────────────
  if (error) {
    return (
      <div className="aspect-video bg-secondary/50 rounded-t-xl flex items-center justify-center">
        <ImageIcon className="w-10 h-10 text-muted-foreground/40" />
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="aspect-video bg-secondary/50 rounded-t-xl flex items-center justify-center">
        <div className="flex gap-1.5">
          <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="aspect-video bg-secondary/50 rounded-t-xl overflow-hidden flex items-center justify-center p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

// ── DiagramModal (full-screen lightbox) ───────────────────────────────────────

const DiagramModal = ({
  item,
  onClose,
}: {
  item: DiagramItem;
  onClose: () => void;
}) => {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const modalId = `modal-${item.diagram_id.replace(/-/g, "")}`;

  const isImage = item.type === "image";

  useEffect(() => {
    // Skip Mermaid rendering for real images
    if (isImage) return;

    mermaid
      .render(modalId, item.mermaid_code)
      .then(({ svg: renderedSvg }) => setSvg(renderedSvg))
      .catch(() => {
        const leaked = document.getElementById(`d${modalId}`);
        if (leaked) leaked.remove();
        setError(true);
      });

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item.mermaid_code]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const typeLabel =
    item.type === "flowchart" ? "Flowchart"
    : item.type === "image"   ? "AI Image"
    : "Mind Map";

  const typeBadgeColor =
    item.type === "flowchart" ? "bg-blue-500/15 text-blue-400"
    : item.type === "image"   ? "bg-primary/15 text-primary"
    : "bg-purple-500/15 text-purple-400";

  const handleImageDownload = () => {
    if (!item.image_url) return;
    const a = document.createElement("a");
    a.href = item.image_url;
    a.download = `${item.topic.replace(/\s+/g, "_")}.png`;
    a.target = "_blank";
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <ImageIcon className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{item.topic}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeColor}`}>
              {typeLabel}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* View code button — only for Mermaid types */}
            {!isImage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCode((v) => !v)}
                className="h-8 px-3 text-xs text-muted-foreground hover:text-primary gap-1.5"
              >
                <Code className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{showCode ? "View diagram" : "View code"}</span>
              </Button>
            )}

            {/* Download: PNG export for Mermaid, direct URL for real image */}
            {isImage && item.image_url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleImageDownload}
                className="h-8 px-3 text-xs text-muted-foreground hover:text-primary gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Download PNG</span>
              </Button>
            )}
            {!isImage && svg && !showCode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadPNG(svg, item.topic)}
                className="h-8 px-3 text-xs text-muted-foreground hover:text-primary gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Download PNG</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-auto p-6">
          {isImage ? (
            item.image_url ? (
              <img
                src={item.image_url}
                alt={item.topic}
                className="w-full rounded-xl object-contain max-h-[65vh]"
                onError={() => setError(true)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-sm text-destructive">Image URL not available.</p>
              </div>
            )
          ) : showCode ? (
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap bg-secondary/60 rounded-xl p-4">
              {item.mermaid_code}
            </pre>
          ) : svg ? (
            <div
              className="w-full flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-destructive">Failed to render diagram.</p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 gap-1.5">
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="px-5 py-3 border-t border-border shrink-0">
          <p className="text-xs text-muted-foreground">
            {formatDate(item.created_at)} · Press <kbd className="text-[10px] bg-secondary px-1 py-0.5 rounded">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Shared date formatter ─────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return iso; }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const ImagesPage = () => {
  const [diagrams, setDiagrams] = useState<DiagramItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDiagram, setSelectedDiagram] = useState<DiagramItem | null>(null);

  const fetchDiagrams = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/diagrams/history?user_id=${USER_ID}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setDiagrams(data.diagrams || []);
    } catch (err: any) {
      setError("Could not load diagrams. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDiagrams(); }, []);

  const typeLabel = (type: string) =>
    type === "flowchart" ? "Flowchart" : type === "image" ? "AI Image" : "Mind Map";
  const typeBadgeColor = (type: string) =>
    type === "flowchart"
      ? "bg-blue-500/15 text-blue-400"
      : type === "image"
      ? "bg-primary/15 text-primary"
      : "bg-purple-500/15 text-purple-400";
  const TypeIcon = (type: string) =>
    type === "flowchart" ? Network : type === "image" ? ImageIcon : GitBranch;

  return (
    <>
      <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Generated Images</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All your AI-generated diagrams, flowcharts, and mind maps — saved across all sessions
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDiagrams}
            className="text-muted-foreground hover:text-primary gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="bg-card border-border">
                <CardContent className="p-0">
                  <div className="aspect-video bg-secondary/50 rounded-t-xl animate-pulse" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-secondary/70 rounded animate-pulse w-3/4" />
                    <div className="h-3 bg-secondary/50 rounded animate-pulse w-1/2" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchDiagrams}>Try again</Button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && diagrams.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No diagrams yet.</p>
            <p className="text-xs text-muted-foreground">
              Use the ➕ menu in Chat and select "Generate Flowchart" or "Generate Diagram".
            </p>
          </div>
        )}

        {/* Grid */}
        {!loading && !error && diagrams.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {diagrams.map((item) => {
              const Icon = TypeIcon(item.type);
              return (
                <Card
                  key={item.diagram_id}
                  onClick={() => setSelectedDiagram(item)}
                  className="bg-card border-border hover:border-primary/40 transition-all duration-200 cursor-pointer group hover:glow-blue-sm"
                >
                  <CardContent className="p-0">
                    {/* Thumbnail with zoom hint on hover */}
                    <div className="relative">
                      <DiagramPreview item={item} />
                      <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 rounded-t-xl transition-all duration-200 flex items-center justify-center">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/60 rounded-full p-2">
                          <ZoomIn className="w-5 h-5 text-white" />
                        </div>
                      </div>
                    </div>

                    {/* Card footer */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                        <h3 className="text-sm font-semibold text-foreground truncate">{item.topic}</h3>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeColor(item.type)}`}>
                          {typeLabel(item.type)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox modal */}
      {selectedDiagram && (
        <DiagramModal
          item={selectedDiagram}
          onClose={() => setSelectedDiagram(null)}
        />
      )}
    </>
  );
};

export default ImagesPage;