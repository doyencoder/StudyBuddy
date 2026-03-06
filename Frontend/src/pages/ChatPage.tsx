import { useState, useRef, useEffect } from "react";
import mermaid from "mermaid";
import {
  Send,
  Paperclip,
  Mic,
  Plus,
  Volume2,
  Globe,
  Copy,
  RefreshCw,
  FileText,
  Layers,
  CalendarDays,
  GitBranch,
  Network,
  Bot,
  Code,
  ImageIcon,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// ── Mermaid init (once, outside component) ────────────────────────────────────
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

interface DiagramData {
  diagram_id: string;
  type: "flowchart" | "diagram";
  topic: string;
  mermaid_code: string;
  created_at: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "diagram";
  content: string;
  diagramData?: DiagramData;
  timestamp: Date;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8000";
const USER_ID = "student-001";

const TOOLS = [
  { label: "Generate Quiz",       icon: FileText    },
  { label: "Generate Flashcards", icon: Layers      },
  { label: "Create Study Plan",   icon: CalendarDays },
  { label: "Generate Diagram",    icon: GitBranch   },
  { label: "Generate Flowchart",  icon: Network     },
];

const INITIAL_MESSAGES: Message[] = [
  {
    id: "1",
    role: "assistant",
    content:
      "Hey there! 👋 I'm your Study Buddy. I can help you understand complex topics, generate quizzes, create flashcards, build study plans, and much more. Just type your question or use the ➕ tools menu to get started!",
    timestamp: new Date(),
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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

// ── Markdown Renderer ─────────────────────────────────────────────────────────

function applyInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={i} className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono text-primary">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-1 my-2 ml-2">
          {items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    if (/^\s*[\*\-]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[\*\-]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[\*\-]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-1 my-2 ml-2">
          {items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    elements.push(
      <p key={`p-${i}`} className="text-sm leading-relaxed my-1">{applyInline(line)}</p>
    );
    i++;
  }
  return elements;
}

// ── DiagramCard ───────────────────────────────────────────────────────────────

const DiagramCard = ({ diagramData }: { diagramData: DiagramData }) => {
  const [svg, setSvg] = useState<string>("");
  const [renderError, setRenderError] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const containerId = useRef(`mermaid-${generateUUID().replace(/-/g, "")}`);

  useEffect(() => {
    if (!diagramData.mermaid_code) return;
    setRenderError(false);
    setSvg("");

    mermaid
      .render(containerId.current, diagramData.mermaid_code)
      .then(({ svg: renderedSvg }) => setSvg(renderedSvg))
      .catch((err) => {
        console.error("Mermaid render error:", err);
        // Clean up any leaked Mermaid error container
        const leaked = document.getElementById(`d${containerId.current}`);
        if (leaked) leaked.remove();
        setRenderError(true);
      });
  }, [diagramData.mermaid_code]);

  const typeLabel = diagramData.type === "flowchart" ? "Flowchart" : "Mind Map";
  const typeBadgeColor =
    diagramData.type === "flowchart"
      ? "bg-blue-500/15 text-blue-400"
      : "bg-purple-500/15 text-purple-400";

  return (
    <div className="w-full space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{diagramData.topic}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeColor}`}>
            {typeLabel}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {svg && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadPNG(svg, diagramData.topic)}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1.5"
              title="Download as PNG"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCode((v) => !v)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1.5"
          >
            <Code className="w-3.5 h-3.5" />
            {showCode ? "Hide code" : "View code"}
          </Button>
        </div>
      </div>

      {/* Rendered diagram */}
      {!showCode && (
        <div className="rounded-xl bg-secondary/60 border border-border p-4 overflow-x-auto min-h-[120px] flex items-center justify-center">
          {svg ? (
            <div className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : renderError ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-destructive">Failed to render diagram.</p>
              <p className="text-xs text-muted-foreground">Click "View code" to see the raw Mermaid syntax.</p>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>
      )}

      {/* Raw code view */}
      {showCode && (
        <div className="rounded-xl bg-secondary/80 border border-border p-4 overflow-x-auto">
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
            {diagramData.mermaid_code}
          </pre>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Saved to your <span className="text-primary">Images</span> library ✓
      </p>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const ChatPage = () => {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  // ── Generate Diagram ────────────────────────────────────────────────────────

  const generateDiagram = async (topic: string, diagramType: "flowchart" | "diagram") => {
    if (!topic.trim()) {
      toast.error("Please specify a topic for the diagram.");
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE}/diagrams/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: conversationId,
          topic: topic.trim(),
          diagram_type: diagramType,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Diagram generation failed");
      }

      const data: DiagramData = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "diagram",
          content: "",
          diagramData: data,
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      toast.error(`Could not generate diagram: ${err.message}`);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Sorry, I couldn't generate the diagram. ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Send Message ────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();

    if (/^generate flowchart/i.test(userMessage)) {
      const match = userMessage.match(/^generate flowchart(?:\s+for)?:?\s*(.*)/i);
      await generateDiagram(match?.[1]?.trim() || userMessage, "flowchart");
      return;
    }

    if (/^generate diagram/i.test(userMessage)) {
      const match = userMessage.match(/^generate diagram(?:\s+for)?:?\s*(.*)/i);
      await generateDiagram(match?.[1]?.trim() || userMessage, "diagram");
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    const aiMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: aiMsgId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    try {
      const response = await fetch(`${API_BASE}/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: conversationId,
          message: userMessage,
        }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        const lines = raw.split("\n\n").filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();

          if (dataStr === "[DONE]") { setIsTyping(false); break; }

          let parsed: { type: string; content?: string; conversation_id?: string };
          try { parsed = JSON.parse(dataStr); } catch { continue; }

          if (parsed.type === "meta" && parsed.conversation_id) {
            setConversationId(parsed.conversation_id);
          }
          if (parsed.type === "text" && parsed.content) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, content: m.content + parsed.content } : m
              )
            );
          }
          if (parsed.type === "error") {
            toast.error(`AI error: ${parsed.content}`);
            setIsTyping(false);
            break;
          }
        }
      }
    } catch (err) {
      toast.error("Could not reach the server. Is the backend running?");
      setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
    } finally {
      setIsTyping(false);
    }
  };

  // ── File Upload ─────────────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    let activeConversationId = conversationId;
    if (!activeConversationId) {
      activeConversationId = generateUUID();
      setConversationId(activeConversationId);
    }

    setIsUploading(true);
    toast.info(`Uploading "${file.name}"...`);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("user_id", USER_ID);
    formData.append("conversation_id", activeConversationId);

    try {
      const response = await fetch(`${API_BASE}/upload/file`, { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Upload failed");
      }
      const data = await response.json();
      toast.success(`"${file.name}" uploaded! ${data.chunks_stored} chunks indexed.`);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: `📎 I've processed **${file.name}** (${data.chunks_stored} chunks indexed). You can now ask me questions about it, or generate a flowchart / diagram from it!`,
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // ── Tool Click ──────────────────────────────────────────────────────────────

  const handleToolClick = (tool: string) => {
    if (tool === "Generate Flowchart") {
      setInput("Generate Flowchart for: ");
    } else if (tool === "Generate Diagram") {
      setInput("Generate Diagram for: ");
    } else {
      setInput(`${tool} for: `);
      toast.info(`Selected: ${tool}. Type your topic and send!`);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.map((msg) => {

          // ── Diagram bubble ──
          if (msg.role === "diagram" && msg.diagramData) {
            return (
              <div key={msg.id} className="flex justify-start animate-fade-in">
                <div className="w-full max-w-[90%] md:max-w-[80%]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                  </div>
                  <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5">
                    <DiagramCard diagramData={msg.diagramData} />
                  </div>
                </div>
              </div>
            );
          }

          // ── Normal chat bubble ──
          return (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
              <div className="max-w-[85%] md:max-w-[70%]">
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                  </div>
                )}

                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-card border border-glow text-card-foreground rounded-bl-md"
                  }`}
                >
                  {msg.role === "user" ? msg.content : renderMarkdown(msg.content)}
                </div>

                {msg.role === "assistant" && (
                  <div className="flex items-center gap-1 mt-2 ml-1">
                    {[
                      { icon: Volume2,   label: "Audio",      action: () => toast.info("Text-to-speech coming soon!") },
                      { icon: Globe,     label: "Translate",  action: () => toast.info("Translation coming soon!") },
                      { icon: Copy,      label: "Copy",       action: () => handleCopy(msg.content) },
                      { icon: RefreshCw, label: "Regenerate", action: () => toast.info("Regeneration coming soon!") },
                    ].map((btn) => (
                      <Button
                        key={btn.label}
                        variant="ghost"
                        size="sm"
                        onClick={btn.action}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5"
                      >
                        <btn.icon className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{btn.label}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-card border border-glow rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-border p-3 md:p-4 bg-card">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 h-10 w-10">
                <Plus className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="bg-card border-border w-56">
              {TOOLS.map((tool) => (
                <DropdownMenuItem key={tool.label} onClick={() => handleToolClick(tool.label)} className="gap-3 text-foreground">
                  <tool.icon className="w-4 h-4 text-primary" />
                  {tool.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex-1 flex items-end bg-secondary rounded-xl border border-border focus-within:border-primary/50 focus-within:glow-blue-sm transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask anything..."
              rows={1}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm px-4 py-2.5 resize-none outline-none min-h-[40px] max-h-[120px]"
            />
            <div className="flex items-center gap-1 pr-2 pb-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className={`w-4 h-4 ${isUploading ? "animate-pulse" : ""}`} />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                <Mic className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isTyping}
            size="icon"
            className="shrink-0 h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;