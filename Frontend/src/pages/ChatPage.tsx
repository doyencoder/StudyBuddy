/* eslint-disable react-refresh/only-export-components */
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import LoadingDots from "../components/LoadingDots";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import mermaid from "mermaid";
import katex from "katex";
import "katex/dist/katex.min.css";
import { API_BASE } from "@/config/api";
import {
  Send, Paperclip, Mic, Plus, Volume2, Globe, Copy, RefreshCw,
  FileText, CalendarDays, GitBranch, Network, Brain, Bot,
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, Code, Check,
  ImageIcon, Download, Square, Sparkles,
  Save,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
  Maximize2, ZoomIn, ZoomOut, X,TrendingUp, GraduationCap,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  extractGraphableEquations,
  normalizeEquationForNova,
  normalizeEscapedMathDelimiters,
} from "@/lib/novaMath";
import { withMindmapTheme } from "@/lib/mermaidMindmapTheme";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAppearance } from "@/contexts/AppearanceContext";
import CelebrationOverlay from "@/components/CelebrationOverlay";
import { addToSyncQueue, cacheConversation, getCachedConversation } from "@/lib/offlineStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { ModelSelector, type ProviderKey } from "@/components/ModelSelector";
import { useCoins } from "@/contexts/CoinContext";
import { useUser } from "@/contexts/UserContext";

// ── Mermaid init ──────────────────────────────────────────────────────────────
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
  flowchart: { curve: "basis", htmlLabels: true, useMaxWidth: true, rankSpacing: 60, nodeSpacing: 40 },
  mindmap: { padding: 16 },
});

// Inject welcome screen keyframe animation (Tailwind JIT can't do custom keyframes inline)
if (typeof document !== "undefined" && !document.getElementById("sb-welcome-anim")) {
  const style = document.createElement("style");
  style.id = "sb-welcome-anim";
  style.textContent = `
    @keyframes fadeSlideUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
    .animate-slide-in-right { animation: slideInRight 0.22s cubic-bezier(0.16,1,0.3,1) both; }
  `;
  document.head.appendChild(style);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
}

interface QuizResult {
  question_id: string;
  correct: boolean;
  selected_index: number;
  correct_index: number;
  explanation: string;
  question: string;
  options: string[];
}

interface QuizData {
  quiz_id: string;
  topic: string;
  questions: QuizQuestion[];
  submitted: boolean;
  fun_fact?: string;
  score?: number;
  correct_count?: number;
  total_questions?: number;
  weak_areas?: string[];
  results?: QuizResult[];
  timer_seconds?: number;
  num_questions?: number;        // original question count — persisted to survive reload/retake
  unanswered_indices?: number[]; // indices that timed out unanswered — frontend-only
}

interface DiagramData {
  diagram_id: string;
  type: "flowchart" | "diagram";
  topic: string;
  mermaid_code: string;
  created_at: string;
}

interface WeekPlanData {
  week_number: number;
  start_date: string;
  end_date: string;
  tasks: string[];
  estimate_hours?: number;
}

interface StudyPlanData {
  plan_id: string;
  title: string;
  start_date: string;
  end_date: string;
  weeks: WeekPlanData[];
  summary: string;
  goal_saved?: boolean;
}

interface ImageData {
  diagram_id: string;
  type: "image";
  topic: string;
  image_url: string;
  created_at: string;
}

interface WebSearchSource {
  title: string;
  url: string;
  snippet: string;
  favicon: string;
  source: string;
}

interface WebSearchImage {
  thumbnail: string;
  original: string;
  title: string;
  source: string;
  link: string;
}

interface WebSearchVideo {
  thumbnail: string;
  title: string;
  channel: string;
  duration: string;
  views: string;
  url: string;
  published: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "quiz" | "diagram" | "study_plan" | "image";
  attachments?: { name: string; blobUrl: string; fileType: "image" | "pdf" | "document" }[];
  intentHint?: string;
  content: string;
  quizData?: QuizData;
  quizVersions?: QuizData[];    // all attempts including original — for version navigator
  activeVersionIdx?: number;    // which version is currently displayed
  diagramData?: DiagramData;
  studyPlanData?: StudyPlanData;
  imageData?: ImageData;
  webSearchSources?: WebSearchSource[]; // populated by web_search_sources SSE event
  webSearchImages?: WebSearchImage[];   // populated by web_search_images SSE event
  webSearchVideos?: WebSearchVideo[];   // populated by web_search_videos SSE event
  // Regeneration version history (like quiz retake versions)
  regenVersions?: Array<{
    content: string;
    webSearchSources?: WebSearchSource[];
    webSearchImages?: WebSearchImage[];
    webSearchVideos?: WebSearchVideo[];
  }>;
  activeRegenVersionIdx?: number; // which version is currently displayed
  timestamp: Date;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOLS = [
  { label: "Generate Quiz", icon: FileText, intent: "quiz" },
  { label: "Create Study Plan", icon: CalendarDays, intent: "study_plan" },
  { label: "Generate Diagram", icon: GitBranch, intent: "image" },
  { label: "Generate Flowchart", icon: Network, intent: "flowchart" },
  { label: "Generate Mindmap", icon: Brain, intent: "mindmap" },
  { label: "Search Web", icon: Search, intent: "web_search" },
];

const INTENT_LABELS: Record<string, string> = {
  quiz: "📝 Generate Quiz",
  study_plan: "📅 Create Study Plan",
  image: "🎨 Generate Diagram",
  flowchart: "📊 Generate Flowchart",
  mindmap: "🧠 Generate Mindmap",
  web_search: "🔍 Search Web",
};

const CHIP_PLACEHOLDERS: Record<string, string> = {
  quiz:       `e.g. "photosynthesis" · add "10 questions" · add "30 seconds" for timed`,
  study_plan: `e.g. "machine learning" · add "6 weeks" · add "10 hours/week"`,
  flowchart:  `e.g. "the water cycle" or "how TCP handshake works"`,
  mindmap:    `e.g. "World War 2" or "photosynthesis concepts"`,
  image:      `e.g. "mitosis" or "structure of a neuron"`,
  web_search: `e.g. "latest AI research 2025" or "how does CRISPR work"`,
};

const INITIAL_MESSAGES: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "__welcome__",   // sentinel — triggers animated welcome screen instead of a chat bubble
    timestamp: new Date(),
  },
];


// ── Per-conversation state ────────────────────────────────────────────────────
// Each conversation gets its own isolated slice of state so that background
// streams never bleed into the currently visible chat (Option B isolation).
interface ConvState {
  messages: Message[];
  isTyping: boolean;
  isReadingDoc: boolean;
  isSearchingWeb: boolean;
  regeneratingMsgId: string | null;
  retakingMsgId: string | null;
}

// Temporary key used for a brand-new conversation before the backend assigns a real ID
const NEW_CONV_KEY = "__new__";

function defaultConvState(): ConvState {
  return {
    messages: INITIAL_MESSAGES,
    isTyping: false,
    isReadingDoc: false,
    isSearchingWeb: false,
    regeneratingMsgId: null,
    retakingMsgId: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatAttachmentName(name: string, maxBaseLength = 18): string {
  const trimmed = name.trim();
  if (!trimmed) return "File";

  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return trimmed.length > maxBaseLength
      ? `${trimmed.slice(0, Math.max(0, maxBaseLength - 3))}...`
      : trimmed;
  }

  const base = trimmed.slice(0, lastDot);
  const ext = trimmed.slice(lastDot);
  if (base.length <= maxBaseLength) return trimmed;

  return `${base.slice(0, Math.max(0, maxBaseLength - 3))}...${ext}`;
}

function isSafetyRefusalText(text?: string): boolean {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith("__refused__")) return true;
  return (
    t.includes("i'm studybuddy, an educational assistant") &&
    t.includes("can't help with that topic")
  );
}

function downloadPNG(svgContent: string, filename: string) {
  const b64 = btoa(unescape(encodeURIComponent(svgContent)));
  const dataUrl = `data:image/svg+xml;base64,${b64}`;
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const w = img.naturalWidth || 1200;
    const h = img.naturalHeight || 800;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
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

const LANG_TO_BCP47: Record<string, string> = {
  en: "en-US",
  hi: "hi-IN",
  mr: "mr-IN",
  ta: "ta-IN",
  te: "te-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  kn: "kn-IN",
};

function renderMath(latex: string, displayMode: boolean): React.ReactNode {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      output: "html",
    });
    return (
      <span
        key={latex}
        className={displayMode ? "block my-2 overflow-x-auto" : "inline"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return displayMode ? `$$${latex}$$` : `$${latex}$`;
  }
}

function applyInline(text: string, onEquationClick?: (eq: string) => void): React.ReactNode[] {
  // Matches y = f(x) written in plain text (not LaTeX).
  // The character whitelist deliberately excludes \ so LaTeX like \( y = \sin(x) \)
  // does NOT produce a chip — only clean plain-text equations like y = sin(x) do.
  void onEquationClick;
  const normalized = normalizeEscapedMathDelimiters(text);

  // Split on markdown links, math, bold, italic, code — links and $$ must come first
  return normalized.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|\$\$[^$]+\$\$|\$[^$\r\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    // Markdown link: [label](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (linkMatch)
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity break-all"
        >
          {linkMatch[1]}
        </a>
      );
    if (/^\$\$[^$]+\$\$$/.test(part))
      return <span key={i}>{renderMath(part.slice(2, -2), true)}</span>;
    if (/^\$[^$\r\n]+\$$/.test(part))
      return <span key={i}>{renderMath(part.slice(1, -1), false)}</span>;
    if (/^\\\([\s\S]+\\\)$/.test(part))
      return <span key={i}>{renderMath(part.slice(2, -2), false)}</span>;
    if (/^\\\[[\s\S]+?\\\]$/.test(part))
      return <span key={i}>{renderMath(part.slice(2, -2), true)}</span>;
    if (/^\*\*[^*]+\*\*$/.test(part))
      return (
        <strong key={i} className="font-semibold text-foreground">
          {applyInline(part.slice(2, -2))}
        </strong>
      );
    if (/^\*[^*]+\*$/.test(part))
      return (
        <em key={i} className="italic">
          {applyInline(part.slice(1, -1))}
        </em>
      );
    if (/^`[^`]+`$/.test(part))
      return (
        <code key={i} className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono text-primary">
          {part.slice(1, -1)}
        </code>
      );
    return [part];
  });
}

// ── Language config: label + keyword sets (no per-lang accent colors) ─────────
const LANG_CONFIG: Record<string, { label: string; keywords: string[] }> = {
  cpp:        { label: "C++",        keywords: ["int","float","double","char","bool","void","string","auto","const","return","if","else","for","while","do","switch","case","break","continue","class","struct","public","private","protected","new","delete","namespace","include","using","template","typename","nullptr","true","false","std","endl","cout","cin","vector","map","set"] },
  c:          { label: "C",          keywords: ["int","float","double","char","void","return","if","else","for","while","do","switch","case","break","continue","struct","const","static","include","define","null","true","false","printf","scanf","malloc","free","sizeof"] },
  python:     { label: "Python",     keywords: ["def","class","return","if","elif","else","for","while","in","not","and","or","is","import","from","as","with","try","except","finally","raise","pass","break","continue","None","True","False","self","lambda","yield","global","nonlocal","print","len","range","type","list","dict","set","tuple","str","int","float","bool"] },
  javascript: { label: "JavaScript", keywords: ["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","class","new","this","typeof","instanceof","import","export","default","from","async","await","try","catch","finally","throw","null","undefined","true","false","console","document","window","Promise","Array","Object","Math","JSON","map","filter","reduce","forEach"] },
  js:         { label: "JavaScript", keywords: ["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","class","new","this","typeof","instanceof","import","export","default","from","async","await","try","catch","finally","throw","null","undefined","true","false","console","document","window"] },
  typescript: { label: "TypeScript", keywords: ["const","let","var","function","return","if","else","for","while","class","interface","type","extends","implements","import","export","default","async","await","null","undefined","true","false","string","number","boolean","any","void","never","unknown","enum","namespace","readonly","public","private","protected"] },
  ts:         { label: "TypeScript", keywords: ["const","let","var","function","return","if","else","for","while","class","interface","type","extends","implements","import","export","async","await","string","number","boolean","any","void"] },
  java:       { label: "Java",       keywords: ["public","private","protected","class","interface","extends","implements","return","if","else","for","while","do","switch","case","break","continue","new","this","super","static","final","void","int","double","float","char","boolean","String","null","true","false","import","package","try","catch","finally","throw","throws","abstract","enum","instanceof"] },
  html:       { label: "HTML",       keywords: ["DOCTYPE","html","head","body","div","span","p","a","img","input","button","form","table","tr","td","th","ul","li","h1","h2","h3","h4","h5","h6","script","style","link","meta","title","section","article","nav","header","footer","main","aside"] },
  css:        { label: "CSS",        keywords: ["display","flex","grid","position","margin","padding","width","height","color","background","border","font","text","align","justify","overflow","transform","transition","animation","opacity","z-index","top","left","right","bottom","absolute","relative","fixed","sticky","none","block","inline","auto"] },
  bash:       { label: "Bash",       keywords: ["echo","cd","ls","mkdir","rm","cp","mv","cat","grep","find","chmod","chown","sudo","apt","npm","pip","git","export","source","if","then","else","fi","for","do","done","while","function","return","exit","read","set","unset","alias"] },
  shell:      { label: "Shell",      keywords: ["echo","cd","ls","mkdir","rm","cp","mv","cat","grep","find","chmod","sudo","if","then","else","fi","for","do","done","while","return","exit"] },
  rust:       { label: "Rust",       keywords: ["fn","let","mut","const","if","else","for","while","loop","match","return","use","mod","pub","struct","enum","impl","trait","self","Self","true","false","None","Some","Ok","Err","String","Vec","Option","Result","i32","u32","i64","u64","f32","f64","bool","str","usize"] },
  go:         { label: "Go",         keywords: ["func","var","const","type","return","if","else","for","range","switch","case","break","continue","struct","interface","map","chan","go","defer","select","package","import","true","false","nil","make","new","len","cap","append","copy","delete","print","println","error"] },
  sql:        { label: "SQL",        keywords: ["SELECT","FROM","WHERE","JOIN","INNER","LEFT","RIGHT","ON","GROUP","BY","ORDER","HAVING","INSERT","INTO","VALUES","UPDATE","SET","DELETE","CREATE","TABLE","DROP","ALTER","INDEX","DISTINCT","AS","AND","OR","NOT","IN","LIKE","BETWEEN","NULL","IS","COUNT","SUM","AVG","MAX","MIN"] },
};
const DEFAULT_LANG_CFG = { label: "code", keywords: [] as string[] };

// ── Lightweight tokenizer ─────────────────────────────────────────────────────
type Token = { text: string; type: "comment" | "string" | "keyword" | "number" | "plain" };
function tokenizeLine(line: string, keywords: string[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    if ((line[i] === "/" && line[i + 1] === "/") || line[i] === "#") {
      tokens.push({ text: line.slice(i), type: "comment" }); break;
    }
    if (line[i] === '"' || line[i] === "'") {
      const q = line[i]; let j = i + 1;
      while (j < line.length && !(line[j] === q && line[j-1] !== "\\")) j++;
      tokens.push({ text: line.slice(i, j + 1), type: "string" }); i = j + 1; continue;
    }
    if (/[0-9]/.test(line[i]) && (i === 0 || !/[a-zA-Z_]/.test(line[i-1]))) {
      let j = i;
      while (j < line.length && /[0-9.]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), type: "number" }); i = j; continue;
    }
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      tokens.push({ text: word, type: keywords.includes(word) ? "keyword" : "plain" }); i = j; continue;
    }
    const last = tokens[tokens.length - 1];
    if (last && last.type === "plain") last.text += line[i];
    else tokens.push({ text: line[i], type: "plain" });
    i++;
  }
  return tokens;
}

// Subtle, VSCode-inspired palette — no loud colors
function TokenSpan({ token }: { token: Token }) {
  const style: React.CSSProperties =
    token.type === "keyword" ? { color: "#7BA7D4" } :          // muted blue — keywords
    token.type === "string"  ? { color: "#98C379" } :          // muted green — strings
    token.type === "comment" ? { color: "#4B5563", fontStyle: "italic" } : // dim gray — comments
    token.type === "number"  ? { color: "#D19A66" } :          // warm amber — numbers
    { color: "#ABB2BF" };                                       // soft gray — plain text
  return <span style={style}>{token.text}</span>;
}

// ── CodeBlock component ───────────────────────────────────────────────────────
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const cfg = LANG_CONFIG[language] ?? { ...DEFAULT_LANG_CFG, label: language || "code" };
  const lines = code.split("\n");
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div
      className="my-3 rounded-lg overflow-hidden text-sm"
      style={{ background: "#1E1E1E", border: "1px solid #2D2D2D" }}
    >
      {/* ── Slim header ── */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: "#252526", borderBottom: "1px solid #2D2D2D" }}
      >
        <div className="flex items-center gap-1.5">
          <Code size={11} className="text-zinc-500" />
          <span className="text-xs text-zinc-400 font-medium">{cfg.label}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs transition-colors duration-150"
          style={{ color: copied ? "#98C379" : "#6B7280" }}
        >
          {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
        </button>
      </div>
      {/* ── Code body with line numbers ── */}
      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse"
          style={{ fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontSize: "13px", lineHeight: "1.65" }}
        >
          <tbody>
            {lines.map((line, idx) => {
              const tokens = tokenizeLine(line, cfg.keywords);
              return (
                <tr key={idx}>
                  <td
                    className="text-right pr-3 pl-4 select-none"
                    style={{ color: "#3C3C3C", borderRight: "1px solid #2D2D2D", minWidth: "2.5rem", verticalAlign: "top",
                      paddingTop: idx === 0 ? "12px" : "0", paddingBottom: idx === lines.length - 1 ? "12px" : "0" }}
                  >
                    {idx + 1}
                  </td>
                  <td
                    className="pl-4 pr-6 whitespace-pre"
                    style={{ verticalAlign: "top",
                      paddingTop: idx === 0 ? "12px" : "0", paddingBottom: idx === lines.length - 1 ? "12px" : "0" }}
                  >
                    {tokens.length === 0
                      ? <span>&nbsp;</span>
                      : tokens.map((tok, ti) => <TokenSpan key={ti} token={tok} />)
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderMarkdown(text: string, onEquationClick?: (eq: string) => void) {
  // Some model responses contain double-escaped math delimiters like `\\(`.
  // Normalize them so inline/display KaTeX parsing works consistently.
  const normalizedText = normalizeEscapedMathDelimiters(text);

  const lines = normalizedText.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  const headingClasses: Record<number, string> = {
    1: "text-lg font-bold text-foreground mt-3 mb-1",
    2: "text-base font-bold text-foreground mt-3 mb-1",
    3: "text-sm font-bold text-foreground mt-3 mb-1",
    4: "text-sm font-semibold text-foreground mt-2.5 mb-1",
    5: "text-sm font-semibold text-foreground/90 mt-2 mb-1",
    6: "text-xs font-semibold text-foreground/80 mt-2 mb-1 uppercase tracking-wide",
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── PLOT: tag — emitted by the AI for plottable equations ────────────────
    // Format: "PLOT: y = sin(x)"
    // Strip the line from the visible message (don't show the raw tag to the user)
    // and replace it with a clickable chip that sends the equation to Nova.
    const plotMatch = line.match(/^PLOT:\s*(.+)/i);
    if (plotMatch) {
      const eq = plotMatch[1].trim();
      if (onEquationClick && eq) {
        elements.push(
          <div key={`plot-${i}`} className="my-1.5">
            <button
              onClick={() => onEquationClick(eq)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono border border-primary/25 hover:bg-primary/20 active:scale-95 transition-all cursor-pointer"
              title="Click to plot in Nova"
            >
              <TrendingUp className="w-3 h-3 shrink-0" />
              {eq}
            </button>
          </div>
        );
      }
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const openFence = line.trim();
      const language = openFence.slice(3).trim().toLowerCase();
      const codeLines: string[] = [];
      i++; // skip opening fence line
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence line
      const code = codeLines.join("\n").replace(/\n$/, "");
      elements.push(
        <CodeBlock key={`cb-${i}`} language={language} code={code} />
      );
      continue;
    }

    // ── Display math block: \[...\] (LaTeX style) ────────────────────────────
    if (line.trim() === "\\[") {
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "\\]") {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // skip closing \]
      const latex = mathLines.join("\n");
      elements.push(
        <div key={`lm-${i}`} className="my-2 overflow-x-auto text-center">
          {renderMath(latex, true)}
        </div>
      );
      continue;
    }

    // ── Display math block: lines starting and ending with $$ ──────────────
    if (line.trim().startsWith("$$")) {
      const mathLines: string[] = [];
      const startLine = line.trim();
      // Single-line $$...$$ e.g. $$x = 5$$
      if (startLine.length > 4 && startLine.endsWith("$$") && startLine !== "$$") {
        const latex = startLine.slice(2, -2);
        elements.push(
          <div key={`dm-${i}`} className="my-2 overflow-x-auto text-center">
            {renderMath(latex, true)}
          </div>
        );
        i++;
        continue;
      }
      // Multi-line $$...$$
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("$$")) {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // skip closing $$
      const latex = mathLines.join("\n");
      elements.push(
        <div key={`dm-${i}`} className="my-2 overflow-x-auto text-center">
          {renderMath(latex, true)}
        </div>
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const tag = `h${level}` as keyof JSX.IntrinsicElements;
      const HeadingTag = tag;
      elements.push(
        <HeadingTag key={`h-${level}-${i}`} className={headingClasses[level]}>
          {applyInline(heading[2])}
        </HeadingTag>
      );
      i++;
      continue;
    }

    // ── Horizontal rule: ---, ***, ___ (with optional spaces) ───────────────
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,}|(?:-\s){3,}|(?:\*\s){3,}|(?:_\s){3,})\s*$/.test(line)) {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-0 border-t border-border/85" />);
      i++;
      continue;
    }

    // ── Markdown table: lines that start with | ───────────────────────────────
    if (/^\s*\|/.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        tableLines.push(lines[i++]);
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) =>
          row.split("|").map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        const isSeparatorRow = (row: string) => /^\s*\|[\s|:\-]+\|\s*$/.test(row);
        const headers = parseRow(tableLines[0]);
        const sepIdx = tableLines.findIndex(isSeparatorRow);
        const bodyRows = sepIdx >= 0 ? tableLines.slice(sepIdx + 1) : tableLines.slice(1);
        elements.push(
          <div key={`tbl-${i}`} className="overflow-x-auto my-3 rounded-lg border border-border/40">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="bg-primary/10 border-b border-border/40">
                  {headers.map((h, j) => (
                    <th key={j} className="px-4 py-2.5 text-left text-xs font-semibold text-foreground uppercase tracking-wide whitespace-nowrap">
                      {applyInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-background/60" : "bg-secondary/20"}>
                    {parseRow(row).map((cell, ci) => (
                      <td key={ci} className={`px-4 py-2 text-sm border-t border-border/20 align-top ${ci === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {applyInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      const startNum = parseInt(lines[i].match(/^\s*(\d+)\./)?.[1] ?? "1", 10);
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*\d+\.\s/, ""));
      elements.push(
        <ol key={`ol-${i}`} start={startNum} className="list-decimal list-inside space-y-1 my-2 ml-2">
          {items.map((item, j) => (
            <li key={j} className="text-sm">
              {applyInline(item, onEquationClick)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    if (/^\s*[\*\-]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[\*\-]\s/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*[\*\-]\s/, ""));
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-1 my-2 ml-2">
          {items.map((item, j) => (
            <li key={j} className="text-sm">
              {applyInline(item, onEquationClick)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    elements.push(
      <p key={`p-${i}`} className="text-sm leading-relaxed my-1">
        {applyInline(line, onEquationClick)}
      </p>
    );
    i++;
  }

  const extractedEquations = onEquationClick ? extractGraphableEquations(normalizedText) : [];
  if (extractedEquations.length) {
    elements.push(
      <div key="nova-chips" className="mt-3 flex flex-wrap gap-2">
        {extractedEquations.map((eq) => (
          <button
            key={eq}
            onClick={() => onEquationClick?.(eq)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono border border-primary/25 hover:bg-primary/20 active:scale-95 transition-all cursor-pointer"
            title="Click to plot in Nova"
          >
            <TrendingUp className="w-3 h-3 shrink-0" />
            {eq}
          </button>
        ))}
      </div>
    );
  }

  return elements;
}

// ── Quiz shared constants ─────────────────────────────────────────────────────
const QUIZ_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "mr", label: "मराठी" },
  { code: "ta", label: "தமிழ்" },
  { code: "te", label: "తెలుగు" },
  { code: "bn", label: "বাংলা" },
  { code: "gu", label: "ગુજรાતી" },
  { code: "kn", label: "ಕನ್ನಡ" },
];
const QUIZ_LANG_NAMES: Record<string, string> = {
  en: "English", hi: "हिन्दी", mr: "मराठी", ta: "தமிழ்",
  te: "తెలుగు", bn: "বাংলা", gu: "ગુજરાતી", kn: "ಕನ್ನಡ",
};

// ── Circular SVG countdown ring ───────────────────────────────────────────────
const TimerRing = ({ seconds, total }: { seconds: number; total: number }) => {
  const R = 22;
  const circ = 2 * Math.PI * R;
  const dash = (seconds / total) * circ;
  const isLow = seconds <= Math.min(10, total * 0.2);
  const isCritical = seconds <= Math.min(5, total * 0.1);
  const stroke = isCritical ? "#ef4444" : isLow ? "#f59e0b" : "#6366f1";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const label = mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : String(secs);
  return (
    <div className={`relative flex items-center justify-center shrink-0 ${isCritical ? "animate-pulse" : ""}`}>
      <svg width="54" height="54">
        <circle cx="27" cy="27" r={R} fill="none" stroke="currentColor" strokeWidth="3" className="text-secondary/60" />
        <circle cx="27" cy="27" r={R} fill="none" stroke={stroke} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 27 27)"
          style={{ transition: "stroke-dasharray 0.95s linear, stroke 0.3s ease" }} />
      </svg>
      <span className="absolute text-[11px] font-bold tabular-nums leading-none" style={{ color: stroke }}>{label}</span>
    </div>
  );
};

// ── WebSearchSourceCards ──────────────────────────────────────────────────────
// Mimics ChatGPT's source UI:
//   • Inline: compact chips (favicon + domain) in a horizontal row + "Sources" button
//   • Click "Sources" → fixed right-side panel slides in with full title + snippet per source
const WebSearchSourcePanel = ({
  sources,
  onClose,
}: {
  sources: WebSearchSource[];
  onClose: () => void;
}) => {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <>
      {/* Backdrop — clicking outside closes panel */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />
      {/* Side panel */}
      <div className="fixed top-0 right-0 h-full w-80 max-w-[90vw] z-50 bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Sources</span>
            <span className="text-xs text-muted-foreground bg-secondary rounded-full px-1.5 py-0.5">
              {sources.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source list */}
        <div className="flex-1 overflow-y-auto py-2">
          {sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors border-b border-border/30 last:border-b-0"
            >
              {/* Citation number badge */}
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                {/* Source name row */}
                <div className="flex items-center gap-1.5 mb-0.5">
                  <img
                    src={s.favicon}
                    alt=""
                    className="w-3.5 h-3.5 rounded-sm shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="text-[11px] text-muted-foreground truncate">{s.source}</span>
                </div>
                {/* Title */}
                <p className="text-xs font-medium text-foreground group-hover:text-primary line-clamp-2 leading-snug mb-1">
                  {s.title}
                </p>
                {/* Snippet */}
                {s.snippet && (
                  <p className="text-[11px] text-muted-foreground/70 line-clamp-2 leading-relaxed">
                    {s.snippet}
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
};

const WebSearchSourceCards = ({ sources }: { sources: WebSearchSource[] }) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (!sources || sources.length === 0) return null;

  const MAX_INLINE = 3;
  const visible = showAll ? sources : sources.slice(0, MAX_INLINE);
  const hiddenCount = sources.length - MAX_INLINE;

  return (
    <>
      {panelOpen && (
        <WebSearchSourcePanel sources={sources} onClose={() => setPanelOpen(false)} />
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/* Compact domain chips */}
        {visible.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.title}
            className="flex items-center gap-1.5 bg-secondary/50 hover:bg-secondary border border-border/40 hover:border-primary/30 rounded-full px-2.5 py-1 transition-all duration-150 max-w-[140px]"
          >
            <img
              src={s.favicon}
              alt=""
              className="w-3 h-3 rounded-sm shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="text-[11px] text-muted-foreground truncate">{s.source}</span>
          </a>
        ))}

        {/* Show more inline chips */}
        {!showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="text-[11px] text-muted-foreground/70 hover:text-primary px-2 py-1 rounded-full hover:bg-secondary/50 transition-colors"
          >
            +{hiddenCount} more
          </button>
        )}

        {/* Sources panel trigger */}
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-primary px-2.5 py-1 rounded-full hover:bg-secondary/50 border border-transparent hover:border-primary/20 transition-all ml-auto"
        >
          <Search className="w-3 h-3" />
          Sources
        </button>
      </div>
    </>
  );
};

// ── WebSearchImageGrid ────────────────────────────────────────────────────────
// Horizontal scrollable strip (like ChatGPT) — fixed height, source link on hover
const WebSearchImageGrid = ({ images }: { images: WebSearchImage[] }) => {
  const [lightbox, setLightbox] = useState<WebSearchImage | null>(null);
  if (!images || images.length === 0) return null;

  return (
    <>
      {/* Lightbox */}
      {lightbox && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-3xl max-h-[85vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={lightbox.original}
              alt={lightbox.title}
              className="max-h-[72vh] max-w-full rounded-xl object-contain shadow-2xl"
              onError={(e) => { (e.target as HTMLImageElement).src = lightbox.thumbnail; }}
            />
            {/* Source link in lightbox */}
            <a
              href={lightbox.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors"
            >
              <Globe className="w-3 h-3" />
              <span className="truncate max-w-xs">{lightbox.source}</span>
            </a>
          </div>
        </div>,
        document.body
      )}

      {/* Horizontal scrollable strip — fixed height, no wrap */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent" style={{ height: "156px" }}>
        {images.map((img, i) => (
          <div key={i} className="relative shrink-0 group" style={{ width: "140px", height: "140px" }}>
            {/* Image button — opens lightbox */}
            <button
              onClick={() => setLightbox(img)}
              className="w-full h-full rounded-xl overflow-hidden border border-border/30 hover:border-primary/40 transition-all duration-150 focus:outline-none"
              title={img.title}
            >
              <img
                src={img.thumbnail}
                alt={img.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </button>
            {/* Source link chip — appears on hover at bottom of image */}
            <a
              href={img.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-1.5 left-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-1 bg-black/70 backdrop-blur-sm rounded-md px-1.5 py-0.5"
              title={`View on ${img.source}`}
            >
              <Globe className="w-2.5 h-2.5 text-white/80 shrink-0" />
              <span className="text-[9px] text-white/90 truncate leading-tight">{img.source}</span>
            </a>
          </div>
        ))}
      </div>
    </>
  );
};

// ── WebSearchVideoCards ───────────────────────────────────────────────────────
// Horizontal scrollable strip of YouTube video cards
const WebSearchVideoCards = ({ videos }: { videos: WebSearchVideo[] }) => {
  if (!videos || videos.length === 0) return null;

  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
      {videos.map((v, i) => (
        <a
          key={i}
          href={v.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 group flex flex-col rounded-xl overflow-hidden border border-border/30 hover:border-primary/40 bg-secondary/30 hover:bg-secondary/60 transition-all duration-150"
          style={{ width: "220px" }}
        >
          {/* Thumbnail */}
          <div className="relative w-full overflow-hidden" style={{ height: "124px" }}>
            <img
              src={v.thumbnail}
              alt={v.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            {/* Duration badge */}
            {v.duration && (
              <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                {v.duration}
              </span>
            )}
            {/* Play icon overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
              <div className="w-10 h-10 rounded-full bg-red-600/90 flex items-center justify-center">
                <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </div>
          </div>
          {/* Info */}
          <div className="p-2.5 flex flex-col gap-1">
            <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
              {v.title}
            </p>
            <p className="text-[10px] text-muted-foreground/70 truncate">{v.channel}</p>
            {(v.views || v.published) && (
              <p className="text-[9px] text-muted-foreground/50">
                {[v.views, v.published].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </a>
      ))}
    </div>
  );
};

// ── QuizResults ───────────────────────────────────────────────────────────────
interface TranslatedResults {
  weakAreas: string[];
  results: { question: string; options: string[]; explanation: string }[];
}

const QuizResults = ({
  quizData,
  onRetake,
}: {
  quizData: QuizData;
  onRetake?: () => void;
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const score = quizData.score ?? 0;

  // Fire celebration only once per quiz_id — persisted in localStorage so it
  // survives remounts, conversation switches, and full page reloads.
  useEffect(() => {
    if (score !== 100) return;
    const STORAGE_KEY = "sb_celebrated_quizzes";
    try {
      const fired: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (fired.includes(quizData.quiz_id)) return; // already celebrated this quiz
      fired.push(quizData.quiz_id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fired));
    } catch {
      // localStorage unavailable — fall through and show once this session
    }
    setTimeout(() => setShowCelebration(true), 400);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally runs only on first mount
  const scoreColor = score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : "text-red-400";
  const scoreBg = score >= 80 ? "from-green-500/10 to-transparent" : score >= 60 ? "from-yellow-500/10 to-transparent" : "from-red-500/10 to-transparent";
  const scoreEmoji = score === 100 ? "🏆" : score >= 80 ? "🌟" : score >= 60 ? "📈" : score >= 40 ? "💪" : score > 0 ? "😓" : "😔";
  const scoreMsg = score === 100 ? "Perfect score!" : score >= 80 ? "Excellent work!" : score >= 60 ? "Good effort!" : score >= 40 ? "Keep practising!" : score > 0 ? "Don't give up — review and retry!" : "No worries, review the material and try again!";

  const [translated, setTranslated] = useState<TranslatedResults | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslatePicker, setShowTranslatePicker] = useState(false);
  const [translatedLang, setTranslatedLang] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowTranslatePicker(false);
    };
    if (showTranslatePicker) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTranslatePicker]);

  const translateResults = async (targetLang: string) => {
    setShowTranslatePicker(false);
    if (targetLang === "en") { setTranslated(null); setTranslatedLang(null); return; }
    setIsTranslating(true);
    try {
      const SEP = "§§§";
      const weakBlock = (quizData.weak_areas ?? []).join("\n") || "_";
      const resultBlocks = (quizData.results ?? []).map(
        (r) => `${r.question}\n${r.options.join("\n")}\n${r.explanation}`
      );
      const packed = [weakBlock, ...resultBlocks].join(`\n${SEP}\n`);
      const response = await fetch(`${API_BASE}/chat/translate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: packed, target_language: targetLang }),
      });
      if (!response.ok) throw new Error((await response.json()).detail || "Translation failed");
      const data = await response.json();
      const blocks = data.translated_text.split(`\n${SEP}\n`);
      const weakLines = blocks[0]?.trim() === "_" ? [] : (blocks[0]?.split("\n").filter(Boolean) ?? []);
      const parsedResults = (quizData.results ?? []).map((r, i) => {
        const lines = (blocks[i + 1] ?? "").trim().split("\n").filter(Boolean);
        const question = lines[0] ?? r.question;
        const explanation = lines[lines.length - 1] ?? r.explanation;
        const options = r.options.map((orig, j) => lines.slice(1, lines.length - 1)[j] ?? orig);
        return { question, options, explanation };
      });
      setTranslated({ weakAreas: weakLines, results: parsedResults });
      setTranslatedLang(targetLang);
    } catch (err: any) {
      toast.error(`Translation failed: ${err.message}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const activeWeakAreas = translated?.weakAreas ?? quizData.weak_areas ?? [];
  const activeResults   = translated?.results   ?? quizData.results ?? [];

  return (
    <div className="space-y-4">
      {/* Perfect score celebration */}
      <CelebrationOverlay
        show={showCelebration}
        variant="quiz"
        onClose={() => setShowCelebration(false)}
      />

      {/* Score hero card */}
      <div className={`rounded-2xl bg-gradient-to-b ${scoreBg} border border-border/40 p-5 text-center space-y-1`}>
        <div className="text-3xl mb-1">{scoreEmoji}</div>
        <p className={`text-4xl font-bold tracking-tight ${scoreColor}`}>{score}%</p>
        <p className="text-sm text-muted-foreground">{quizData.correct_count} / {quizData.total_questions} correct</p>
        <p className="text-xs text-muted-foreground/60 font-medium">{scoreMsg}</p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2">
        {onRetake && (
          <Button size="sm" onClick={onRetake} variant="ghost"
            className="flex-1 gap-2 text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 h-8">
            <RefreshCw className="w-3.5 h-3.5" />
            Retake Quiz
          </Button>
        )}
        <div className="relative shrink-0" ref={pickerRef}>
          <Button variant="ghost" size="sm"
            onClick={() => setShowTranslatePicker((v) => !v)}
            disabled={isTranslating || !quizData.results?.length}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5 disabled:opacity-40">
            <Globe className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isTranslating ? "Translating…" : translatedLang ? QUIZ_LANG_NAMES[translatedLang] : "Translate"}</span>
          </Button>
          {showTranslatePicker && (
            <div className="absolute top-9 right-0 z-50 bg-card border border-border rounded-xl shadow-xl p-1.5 min-w-[140px]">
              {QUIZ_LANGUAGES.map((lang) => (
                <button key={lang.code} onClick={() => translateResults(lang.code)}
                  className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${translatedLang === lang.code ? "bg-primary/20 text-primary font-medium" : "text-foreground hover:bg-primary/10 hover:text-primary"}`}>
                  {lang.label}{translatedLang === lang.code && <span className="ml-1.5">✓</span>}
                </button>
              ))}
              {translatedLang && (<>
                <div className="border-t border-border my-1" />
                <button onClick={() => { setTranslated(null); setTranslatedLang(null); setShowTranslatePicker(false); }}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                  Show original
                </button>
              </>)}
            </div>
          )}
        </div>
      </div>

      {/* Weak areas */}
      {activeWeakAreas.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-yellow-400">⚠️ Weak Areas Identified</p>
          <div className="flex flex-wrap gap-2">
            {activeWeakAreas.map((area, i) => (
              <Badge key={i} variant="outline" className="border-yellow-500/30 text-yellow-400 bg-yellow-500/10 text-xs">{area}</Badge>
            ))}
          </div>
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={() => setShowBreakdown((v) => !v)}
        className="w-full text-xs text-muted-foreground hover:text-primary">
        {showBreakdown ? "Hide" : "Show"} question breakdown
      </Button>

      {showBreakdown && quizData.results && (
        <div className="space-y-3">
          {quizData.results.map((r, i) => {
            const t = activeResults[i];
            const wasUnanswered = (quizData.unanswered_indices ?? []).includes(i);
            return (
              <div key={i} className="bg-secondary/40 rounded-xl p-3 space-y-2">
                <div className="flex items-start gap-2">
                  {wasUnanswered
                    ? <Clock className="w-4 h-4 text-muted-foreground/60 shrink-0 mt-0.5" />
                    : r.correct
                      ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                      : <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{t?.question ?? r.question}</p>
                    {wasUnanswered && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/60 bg-secondary px-2 py-0.5 rounded-full">
                        ⏱ Not answered — time ran out
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1 ml-6">
                  {(t?.options ?? r.options).map((opt, oi) => (
                    <div key={oi} className={`text-xs px-3 py-1.5 rounded-lg border ${
                      oi === r.correct_index
                        ? "border-green-500/40 bg-green-500/10 text-green-400"
                        : oi === r.selected_index && !r.correct && !wasUnanswered
                          ? "border-red-500/40 bg-red-500/10 text-red-400"
                          : "border-border text-muted-foreground"
                    }`}>{opt}</div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground ml-6 bg-secondary/50 p-2 rounded-lg">
                  💡 {t?.explanation ?? r.explanation}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};


// ── QuizCard ──────────────────────────────────────────────────────────────────
const QuizCard = ({
  messageId,
  quizData,
  onQuizComplete,
  onRetake,
  userId,
}: {
  messageId: string;
  quizData: QuizData;
  onQuizComplete: (id: string, data: QuizData) => void;
  onRetake?: () => void;
  userId: string;
}) => {
  const { completeMission } = useCoins();
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(quizData.questions.length).fill(null)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFunFact, setShowFunFact] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const totalSecs = quizData.timer_seconds ?? null;
  const [timeLeft, setTimeLeft] = useState<number | null>(totalSecs);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submitRef = useRef<(() => void) | null>(null);

  // tick every second
  useEffect(() => {
    if (totalSecs == null || quizData.submitted || timeLeft === null || timeLeft <= 0) return;
    const id = setTimeout(() => setTimeLeft((t) => (t != null ? t - 1 : null)), 1000);
    return () => clearTimeout(id);
  }, [timeLeft, totalSecs, quizData.submitted]);

  // auto-submit when timer hits 0
  const unansweredAtTimeoutRef = useRef<number[]>([]);
  useEffect(() => {
    if (totalSecs == null || timeLeft !== 0 || quizData.submitted || isSubmitting) return;
    // Capture which questions were genuinely unanswered BEFORE forcing them to 0
    const unanswered = answersRef.current
      .map((a, i) => (a === null ? i : -1))
      .filter((i) => i >= 0);
    unansweredAtTimeoutRef.current = unanswered;
    setTimedOut(true);
    setAnswers((prev) => prev.map((a) => (a === null ? 0 : a)));
    const id = setTimeout(() => submitRef.current?.(), 700);
    return () => clearTimeout(id);
  }, [timeLeft, totalSecs, quizData.submitted, isSubmitting]);

  // preclassify on mount
  useEffect(() => {
    fetch(`${API_BASE}/quiz/preclassify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, quiz_id: quizData.quiz_id }),
    }).catch(() => {});
  }, [quizData.quiz_id]);

  const [translatedQuestions, setTranslatedQuestions] = useState<QuizQuestion[] | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslatePicker, setShowTranslatePicker] = useState(false);
  const [translatedLang, setTranslatedLang] = useState<string | null>(null);
  const translatePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (translatePickerRef.current && !translatePickerRef.current.contains(e.target as Node))
        setShowTranslatePicker(false);
    };
    if (showTranslatePicker) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTranslatePicker]);

  const translateQuiz = async (targetLang: string) => {
    setShowTranslatePicker(false);
    if (targetLang === "en") { setTranslatedQuestions(null); setTranslatedLang(null); return; }
    setIsTranslating(true);
    try {
      const SEP = "\u00a7\u00a7\u00a7";
      const packed = quizData.questions
        .map((q) => `${q.question}\n${q.options.join("\n")}`)
        .join(`\n${SEP}\n`);
      const response = await fetch(`${API_BASE}/chat/translate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: packed, target_language: targetLang }),
      });
      if (!response.ok) throw new Error((await response.json()).detail || "Translation failed");
      const data = await response.json();
      const parsed: QuizQuestion[] = data.translated_text.split(`\n${SEP}\n`).map((block: string, i: number) => {
        const lines = block.trim().split("\n").filter((l: string) => l.trim() !== "");
        const safeOptions = quizData.questions[i].options.map((orig, j) => lines[j + 1] ?? orig);
        return { id: quizData.questions[i].id, question: lines[0] ?? quizData.questions[i].question, options: safeOptions };
      });
      setTranslatedQuestions(parsed);
      setTranslatedLang(targetLang);
    } catch (err: any) {
      toast.error(`Quiz translation failed: ${err.message}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const activeQuestions = translatedQuestions ?? quizData.questions;

  const handleSubmit = async (forcedAnswers?: (number | null)[]) => {
    const finalAnswers = (forcedAnswers ?? answersRef.current).map((a) => a ?? 0);
    const unanswered = unansweredAtTimeoutRef.current;
    setIsSubmitting(true);
    setShowFunFact(true);
    try {
      const response = await fetch(`${API_BASE}/quiz/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          quiz_id: quizData.quiz_id,
          answers: finalAnswers,
          unanswered_indices: unanswered.length > 0 ? unanswered : [],
        }),
      });
      if (!response.ok) throw new Error((await response.json()).detail || "Submission failed");
      const result = await response.json();
      onQuizComplete(messageId, {
        ...quizData, submitted: true,
        score: result.score, correct_count: result.correct_count,
        total_questions: result.total_questions,
        weak_areas: result.weak_areas, results: result.results,
        unanswered_indices: result.unanswered_indices?.length > 0
          ? result.unanswered_indices
          : undefined,
      });
      // Award Study Coins for completing a quiz
      completeMission("complete_quiz").catch(() => {});
    } catch (err: any) {
      toast.error(`Failed to submit quiz: ${err.message}`);
      setShowFunFact(false);
    } finally {
      setIsSubmitting(false);
    }
  };
  submitRef.current = () => handleSubmit(answersRef.current);

  if (quizData.submitted)
    return <QuizResults quizData={quizData} onRetake={onRetake} />;

  const question = activeQuestions[currentQ];
  const total = quizData.questions.length;
  const allAnswered = answers.every((a) => a !== null);
  const answeredCount = answers.filter((a) => a !== null).length;

  return (
    <div className="relative space-y-4">
      {showFunFact && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-card/95 backdrop-blur-sm border border-primary/20 p-6 space-y-4 animate-fade-in">
          {timedOut ? (
            <>
              <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
                <Clock className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm font-bold text-red-400 uppercase tracking-widest">Time's Up!</p>
              <p className="text-xs text-center text-muted-foreground max-w-xs">
                {answeredCount} of {total} answered — submitting your results…
              </p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs font-semibold text-primary uppercase tracking-widest">Did you know?</p>
              <p className="text-sm text-center text-foreground leading-relaxed max-w-xs">
                {quizData.fun_fact || "The brain consolidates memories during sleep — always rest after a study session!"}
              </p>
            </>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            Submitting your answers…
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">📝 {quizData.topic}</p>
          {translatedLang && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20">
              {QUIZ_LANG_NAMES[translatedLang]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalSecs != null && timeLeft != null && (
            <TimerRing seconds={timeLeft} total={totalSecs} />
          )}
          <div className="relative" ref={translatePickerRef}>
            <Button variant="ghost" size="sm"
              onClick={() => setShowTranslatePicker((v) => !v)}
              disabled={isTranslating}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5 disabled:opacity-40">
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isTranslating ? "Translating…" : "Translate"}</span>
            </Button>
            {showTranslatePicker && (
              <div className="absolute top-9 right-0 z-50 bg-card border border-border rounded-xl shadow-xl p-1.5 min-w-[140px]">
                {QUIZ_LANGUAGES.map((lang) => (
                  <button key={lang.code} onClick={() => translateQuiz(lang.code)}
                    className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                      translatedLang === lang.code ? "bg-primary/20 text-primary font-medium" : "text-foreground hover:bg-primary/10 hover:text-primary"
                    }`}>
                    {lang.label}{translatedLang === lang.code && <span className="ml-1.5 text-primary">✓</span>}
                  </button>
                ))}
                {translatedLang && translatedLang !== "en" && (<>
                  <div className="border-t border-border my-1" />
                  <button onClick={() => { setTranslatedQuestions(null); setTranslatedLang(null); setShowTranslatePicker(false); }}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                    Show original
                  </button>
                </>)}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{currentQ + 1} / {total}</span>
        </div>
      </div>

      <div className="w-full bg-secondary rounded-full h-1.5">
        <div className="bg-primary h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${(answeredCount / total) * 100}%` }} />
      </div>

      <p className="text-sm font-medium text-foreground">{question.question}</p>

      <div className="space-y-2">
        {question.options.map((opt, i) => (
          <button key={i}
            onClick={() => setAnswers((prev) => { const u = [...prev]; u[currentQ] = i; return u; })}
            className={`w-full text-left text-sm px-4 py-2.5 rounded-xl border transition-all duration-150 ${
              answers[currentQ] === i
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5"
            }`}>
            {opt}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" size="sm" onClick={() => setCurrentQ((q) => q - 1)}
          disabled={currentQ === 0}
          className="gap-1 text-xs text-muted-foreground hover:text-primary">
          <ChevronLeft className="w-4 h-4" /> Previous
        </Button>
        {currentQ < total - 1 ? (
          <Button variant="ghost" size="sm" onClick={() => setCurrentQ((q) => q + 1)}
            className="gap-1 text-xs text-muted-foreground hover:text-primary">
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button size="sm" onClick={() => handleSubmit()}
            disabled={!allAnswered || isSubmitting}
            className="text-xs bg-primary hover:bg-primary/90 disabled:opacity-40">
            {isSubmitting
              ? <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />Submitting…</span>
              : "Submit Quiz"}
          </Button>
        )}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        {answeredCount} of {total} answered
        {totalSecs != null && timeLeft != null && <span className="ml-1.5 opacity-50">· timed</span>}
      </p>
    </div>
  );
};

// ── DiagramCard Component ─────────────────────────────────────────────────────
const DiagramCard = ({ diagramData }: { diagramData: DiagramData }) => {
  const [svg, setSvg] = useState<string>("");
  const [svgNaturalW, setSvgNaturalW] = useState(800);
  const [svgNaturalH, setSvgNaturalH] = useState(400);
  const [renderError, setRenderError] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const containerId = useRef(`mermaid-${generateUUID().replace(/-/g, "")}`);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const themedCode = withMindmapTheme(
    diagramData.mermaid_code,
    `${diagramData.diagram_id}:${diagramData.topic}`,
  );

  // Close on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Reset zoom when opening fullscreen
  useEffect(() => { if (fullscreen) setZoom(1); }, [fullscreen]);

  // Non-passive wheel → zoom.
  // setTimeout(0) defers until after the portal has been painted to DOM,
  // guaranteeing scrollAreaRef.current is not null when we attach.
  useEffect(() => {
    if (!fullscreen) return;
    let cleanup: (() => void) | undefined;
    const timer = setTimeout(() => {
      const el = scrollAreaRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((z) => Math.min(4, Math.max(0.2, Math.round((z + delta) * 10) / 10)));
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      cleanup = () => el.removeEventListener("wheel", onWheel);
    }, 0);
    return () => { clearTimeout(timer); cleanup?.(); };
  }, [fullscreen]);

  // Render SVG and parse natural dimensions from viewBox so the scroll
  // wrapper can be sized correctly at any zoom level.
  useEffect(() => {
    if (!themedCode) return;
    setRenderError(false);
    setSvg("");

    mermaid
      .render(containerId.current, themedCode)
      .then(({ svg: renderedSvg }) => {
        // Force responsive SVG sizing so diagrams never clip on smaller viewports.
        const normalizedSvg = renderedSvg.replace(
          "<svg ",
          '<svg style="max-width:100%;height:auto;display:block;" '
        );
        setSvg(normalizedSvg);
        // viewBox="minX minY width height" — split on whitespace, take index 2 & 3
        const vbMatch = normalizedSvg.match(/viewBox="([^"]+)"/);
        if (vbMatch) {
          const parts = vbMatch[1].trim().split(/\s+/);
          if (parts.length === 4) {
            setSvgNaturalW(Math.max(parseFloat(parts[2]), 100));
            setSvgNaturalH(Math.max(parseFloat(parts[3]), 100));
          }
        }
      })
      .catch((err) => {
        console.error("Mermaid render error:", err);
        const leaked = document.getElementById(`d${containerId.current}`);
        if (leaked) leaked.remove();
        setRenderError(true);
      });
  }, [themedCode]);

  const typeLabel = diagramData.type === "flowchart" ? "Flowchart" : "Mind Map";
  const typeBadgeColor =
    diagramData.type === "flowchart"
      ? "bg-blue-500/15 text-blue-400"
      : "bg-purple-500/15 text-purple-400";

  return (
    <div className="w-full space-y-3">
      {/* ── Header row ── */}
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
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFullscreen(true)}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1.5"
                title="Fullscreen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Expand</span>
              </Button>
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
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCode((v) => !v)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1.5"
          >
            <Code className="w-3.5 h-3.5" />
            {showCode ? "Hide Mermaid" : "View Mermaid"}
          </Button>
        </div>
      </div>

      {/* ── Inline preview (clickable to open fullscreen) ── */}
      {!showCode && (
        <div
          className="rounded-xl bg-secondary/60 border border-border p-4 overflow-x-auto min-h-[120px] flex items-center justify-center relative group cursor-pointer"
          onClick={() => svg && setFullscreen(true)}
          title="Click to expand"
        >
          {svg ? (
            <>
              <div className="min-w-full flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
              {/* Hover overlay hint */}
              <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center pointer-events-none">
                <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 text-white text-xs bg-black/60 px-3 py-1.5 rounded-full transition-opacity duration-200">
                  <Maximize2 className="w-3 h-3" /> Click to expand
                </span>
              </div>
            </>
          ) : renderError ? (
            <div className="text-center space-y-2" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-destructive">Failed to render diagram.</p>
              <p className="text-xs text-muted-foreground">
                Click "View Mermaid" to see the raw Mermaid syntax.
              </p>
            </div>
          ) : (
            <LoadingDots size={65} />
          )}
        </div>
      )}

      {showCode && (
        <div className="rounded-xl bg-secondary/80 border border-border p-4 overflow-x-auto">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-2">Mermaid code</p>
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
            {diagramData.mermaid_code}
          </pre>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Saved to your <span className="text-primary">Images</span> library ✓
      </p>

      {/* ── Modal — Portal into document.body so no parent overflow/transform clips it ── */}
      {fullscreen && createPortal(
        <>
          {/* Dim backdrop — click to close */}
          <div
            onClick={() => setFullscreen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
          />

          {/* Modal card */}
          <div
            style={{
              position: "fixed", zIndex: 9999,
              top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(92vw, 960px)",
              height: "min(88vh, 700px)",
              background: "#12121a",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              flexShrink: 0,
              background: "rgba(255,255,255,0.03)",
            }}>
              {/* Left: icon + title + badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <ImageIcon size={15} color="#818cf8" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
                  {diagramData.topic}
                </span>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 999, flexShrink: 0,
                  background: diagramData.type === "flowchart" ? "rgba(59,130,246,0.18)" : "rgba(168,85,247,0.18)",
                  color: diagramData.type === "flowchart" ? "#60a5fa" : "#c084fc",
                  fontWeight: 500,
                }}>
                  {typeLabel}
                </span>
              </div>

              {/* Right: actions */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => setShowCode((v) => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <Code size={13} /> {showCode ? "View diagram" : "View Mermaid"}
                </button>
                <button
                  onClick={() => downloadPNG(svg, diagramData.topic)}
                  style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <Download size={13} /> Download PNG
                </button>
                <button
                  onClick={() => setFullscreen(false)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, background: "rgba(255,255,255,0.07)", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", marginLeft: 4 }}
                  title="Close (Esc)"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* ── Diagram area ── */}
            {!showCode && (
              <div
                ref={scrollAreaRef}
                style={{ flex: 1, overflow: "auto", padding: "32px 24px" }}
              >
                {/*
                  IMPORTANT — do NOT use display:flex + justifyContent:center here.
                  When flex-centered content overflows horizontally, the browser splits
                  the overflow equally left and right, but scroll only recovers the right
                  side — the left half is permanently clipped and unreachable.

                  Instead: display:block scroll container + margin:0 auto on the spacer.
                  margin:auto centers the spacer when it fits inside the container.
                  When the spacer is wider than the container, margin:auto collapses to 0
                  and scroll starts correctly from the left edge — nothing gets clipped.
                */}
                <div style={{ width: svgNaturalW * zoom, height: svgNaturalH * zoom, position: "relative", margin: "0 auto" }}>
                  <div
                    style={{ transform: `scale(${zoom})`, transformOrigin: "top left", position: "absolute", top: 0, left: 0, width: svgNaturalW }}
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                </div>
              </div>
            )}

            {/* ── Code view ── */}
            {showCode && (
              <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
                <p style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "rgba(255,255,255,0.45)", margin: "0 0 8px 0" }}>
                  Mermaid code
                </p>
                <pre style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap", margin: 0 }}>
                  {diagramData.mermaid_code}
                </pre>
              </div>
            )}

            {/* ── Footer ── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "7px 16px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · Scroll to zoom · Press <kbd style={{ fontFamily: "monospace", background: "rgba(255,255,255,0.1)", borderRadius: 4, padding: "0 4px", fontSize: 10 }}>Esc</kbd> to close
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                {Math.round(zoom * 100)}%
              </span>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

// ── ImageCard ─────────────────────────────────────────────────────────────────
const ImageCard = ({ imageData }: { imageData: ImageData }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleDownload = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/diagrams/download-image?url=${encodeURIComponent(
          imageData.image_url
        )}&filename=${encodeURIComponent(imageData.topic.replace(/\s+/g, "_"))}.png`
      );
      if (!res.ok) throw new Error("proxy failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${imageData.topic.replace(/\s+/g, "_")}.png`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(imageData.image_url, "_blank");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">
            {imageData.topic}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium shrink-0">
            AI Image
          </span>
        </div>
        {loaded && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-primary gap-1 shrink-0"
          >
            <Download className="w-3 h-3" />
            Download
          </Button>
        )}
      </div>

      {/* Image — constrained, click to expand */}
      <div
        className="rounded-lg overflow-hidden bg-secondary/40 flex items-center justify-center cursor-pointer relative group"
        style={{ minHeight: loaded ? undefined : "80px" }}
        onClick={() => loaded && setExpanded(true)}
      >
        {error ? (
          <div className="flex flex-col items-center gap-1 py-4">
            <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs text-destructive">Failed to load image.</p>
          </div>
        ) : (
          <>
            {!loaded && <LoadingDots size={50} />}
            <img
              src={imageData.image_url}
              alt={imageData.topic}
              className={`w-full max-h-[200px] object-contain rounded-lg transition-opacity duration-300 ${
                loaded ? "opacity-100" : "opacity-0 absolute"
              }`}
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
            />
            {loaded && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-all duration-200 flex items-center justify-center rounded-lg">
                <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/60 px-2 py-1 rounded-md transition-opacity">
                  🔍 Expand
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground text-right">
        Saved to your Images library ✓
      </p>

      {/* Fullscreen lightbox */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setExpanded(false)}
        >
          <img
            src={imageData.image_url}
            alt={imageData.topic}
            className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-5 right-5 text-white bg-black/50 hover:bg-black/80 rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
            onClick={() => setExpanded(false)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

// ── StudyPlanCard Component ────────────────────────────────────────────────
const StudyPlanCard = ({
  studyPlanData,
  conversationId,
  userId,
}: {
  studyPlanData: StudyPlanData;
  conversationId: string | null;
  userId: string;
}) => {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([1]));
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(studyPlanData.goal_saved ?? false);

  const toggleWeek = (weekNum: number) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekNum)) next.delete(weekNum);
      else next.add(weekNum);
      return next;
    });
  };

  const handleSaveAsGoal = async () => {
    setIsSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/goals/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          title: studyPlanData.title,
          start_date: studyPlanData.start_date,
          end_date: studyPlanData.end_date,
          weekly_plan: studyPlanData.weeks,
          progress: 0,
          reminder: null,
        }),
      });
      if (!resp.ok) throw new Error("Failed to save goal");
      setSaved(true);
      toast.success("Study plan saved as a goal! View it on the Goals page.");
      // Persist goal_saved flag to conversation history
      if (conversationId) {
        fetch(`${API_BASE}/study_plans/mark_goal_saved`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            plan_id: studyPlanData.plan_id,
            conversation_id: conversationId,
          }),
        }).catch(() => {}); // fire-and-forget
      }
    } catch (err: any) {
      toast.error(`Could not save goal: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const totalHours = studyPlanData.weeks.reduce((s, w) => s + (w.estimate_hours || 0), 0);

  return (
    <div className="w-full space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">{studyPlanData.title}</span>
      </div>

      {/* Overview badges */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="text-xs border-primary/30 text-primary bg-primary/10">
          {studyPlanData.weeks.length} weeks
        </Badge>
        <Badge variant="outline" className="text-xs border-border text-muted-foreground">
          {studyPlanData.start_date} → {studyPlanData.end_date}
        </Badge>
        {totalHours > 0 && (
          <Badge variant="outline" className="text-xs border-border text-muted-foreground">
            <Clock className="w-3 h-3 mr-1" />
            ~{totalHours}h total
          </Badge>
        )}
      </div>

      {/* Summary */}
      {studyPlanData.summary && (
        <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3">
          {studyPlanData.summary}
        </p>
      )}

      {/* Weekly breakdown */}
      <div className="space-y-2">
        {studyPlanData.weeks.map((week) => (
          <div key={week.week_number} className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => toggleWeek(week.week_number)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-secondary/30 hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Week {week.week_number}
                </span>
                <span className="text-xs text-muted-foreground">
                  {week.start_date} – {week.end_date}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {week.estimate_hours && (
                  <span className="text-xs text-muted-foreground">{week.estimate_hours}h</span>
                )}
                {expandedWeeks.has(week.week_number) ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>
            </button>
            {expandedWeeks.has(week.week_number) && (
              <div className="px-4 py-3 space-y-1.5">
                {week.tasks.map((task, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <span className="text-xs text-foreground">{task}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleSaveAsGoal}
          disabled={isSaving || saved}
          className="text-xs bg-primary hover:bg-primary/90 gap-1.5"
        >
          <Save className="w-3.5 h-3.5" />
          {saved ? "Saved ✓" : isSaving ? "Saving..." : "Save as Goal"}
        </Button>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

// ── WelcomeScreen ─────────────────────────────────────────────────────────────
// Shown only when no conversation has started yet (messages.length === 1).
// Fades out the moment the user sends their first message.
const SUGGESTION_CARDS = [
  {
    icon: FileText,
    title: "Generate a Quiz",
    subtitle: "Test your knowledge on any topic",
    intent: "quiz",
    color: "group-hover:text-violet-400",
    iconBg: "bg-violet-500/10 group-hover:bg-violet-500/20",
  },
  {
    icon: CalendarDays,
    title: "Build a Study Plan",
    subtitle: "Get a structured week-by-week plan",
    intent: "study_plan",
    color: "group-hover:text-blue-400",
    iconBg: "bg-blue-500/10 group-hover:bg-blue-500/20",
  },
  {
    icon: GitBranch,
    title: "Draw a Flowchart",
    subtitle: "Visualise a process or concept",
    intent: "flowchart",
    color: "group-hover:text-emerald-400",
    iconBg: "bg-emerald-500/10 group-hover:bg-emerald-500/20",
  },
  {
    icon: Brain,
    title: "Make a Mind Map",
    subtitle: "Map out ideas and connections",
    intent: "mindmap",
    color: "group-hover:text-amber-400",
    iconBg: "bg-amber-500/10 group-hover:bg-amber-500/20",
  },
  {
    icon: ImageIcon,
    title: "AI Diagram",
    subtitle: "Generate an illustrated visual diagram",
    intent: "image",
    color: "group-hover:text-pink-400",
    iconBg: "bg-pink-500/10 group-hover:bg-pink-500/20",
  },
  {
    icon: Network,
    title: "Ask Anything",
    subtitle: "Explain concepts, solve problems, summarise",
    intent: "",
    color: "group-hover:text-primary",
    iconBg: "bg-primary/10 group-hover:bg-primary/20",
  },
];

const STARTER_PROMPTS = [
  "Explain Newton's laws of motion in simple terms",
  "What is the difference between mitosis and meiosis?",
];

interface WelcomeScreenProps {
  onSuggestion: (prompt: string, intent: string) => void;
  onStarterPrompt: (prompt: string) => void;
}

function WelcomeScreen({ onSuggestion, onStarterPrompt }: WelcomeScreenProps) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full px-4 select-none gap-4"
      style={{ animation: "welcomeFadeIn 0.5s ease both" }}
    >
      {/* Logo + heading */}
      <div
        className="flex flex-col items-center gap-2"
        style={{ animation: "welcomeSlideUp 0.5s ease both" }}
      >
        <div
          className="w-11 h-11 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center shadow-lg"
          style={{ animation: "welcomePulse 3s ease-in-out infinite" }}
        >
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            What would you like to study?
          </h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
            Ask a question, upload your notes, or pick a tool to get started
          </p>
        </div>
      </div>

      {/* Suggestion cards — 3-column grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 w-full max-w-xl">
        {SUGGESTION_CARDS.map((card, i) => (
          <button
            key={card.intent + card.title}
            onClick={() => onSuggestion("", card.intent)}
            className="group text-left p-3 rounded-xl border border-border/60 bg-card/60 hover:bg-card hover:border-primary/30 hover:shadow-md hover:-translate-y-1.5 transition-all duration-200 cursor-pointer"
            style={{ animation: `welcomeSlideUp 0.5s ease ${0.08 + i * 0.06}s both` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors duration-200 ${card.iconBg}`}>
                <card.icon className={`w-3 h-3 text-primary transition-colors duration-200 ${card.color}`} />
              </div>
              <span className="text-xs font-semibold text-foreground leading-tight">{card.title}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{card.subtitle}</p>
          </button>
        ))}
      </div>

      {/* Starter prompts */}
      <div className="flex flex-col gap-1.5 w-full max-w-xl"
        style={{ animation: "welcomeSlideUp 0.5s ease 0.5s both" }}
      >
        <p className="text-xs text-muted-foreground font-medium px-0.5">Try asking</p>
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onStarterPrompt(prompt)}
            className="flex items-center gap-3 text-left px-3 py-2 rounded-xl border border-border/40 bg-card/40 hover:bg-card hover:border-primary/30 transition-all duration-150 group"
          >
            <ChevronRight className="w-3 h-3 text-primary/40 shrink-0 group-hover:text-primary transition-colors" />
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{prompt}</span>
          </button>
        ))}
      </div>

      <style>{`
        @keyframes welcomeFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes welcomeSlideUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes welcomePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.15); }
          50%       { box-shadow: 0 0 0 10px rgba(99,102,241,0); }
        }
      `}</style>
    </div>
  );
}


const ChatPage = () => {
  const { currentUser } = useUser();
  const USER_ID = currentUser.id;
  const { language } = useLanguage();
  const { voice } = useAppearance();
  const { isOnline } = useOnlineStatus();
  const { completeMission } = useCoins();
  // ── Per-conversation state map ──────────────────────────────────────────────
  // Keyed by conversation ID (or NEW_CONV_KEY for an unsaved new chat).
  // SSE handlers always write into their own slot, so switching convs never
  // corrupts the currently visible conversation.
  const [convStates, setConvStates] = useState<Record<string, ConvState>>({});
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  // Tracks the ephemeral __pending__ key for the in-progress new-chat stream
  // currently being shown on the new-chat screen. Null when the screen is blank
  // or when the user has navigated away mid-stream. This is React state (not a
  // ref) because it must drive viewKey which drives rendering.
  const [pendingConvKey, setPendingConvKey] = useState<string | null>(null);

  // Helper: immutably update one conversation's slice
  const updateConv = (convId: string, updater: (s: ConvState) => ConvState) => {
    setConvStates((prev) => {
      const cur = prev[convId] ?? defaultConvState();
      return { ...prev, [convId]: updater(cur) };
    });
  };

  // Derived: the state for whichever conversation is currently on screen.
  // Priority: real conv ID > active pending stream > blank new-chat slot.
  const viewKey = activeConvId ?? pendingConvKey ?? NEW_CONV_KEY;
  const { messages, isTyping, isReadingDoc, isSearchingWeb, regeneratingMsgId, retakingMsgId } =
    convStates[viewKey] ?? defaultConvState();

  // Convenience alias so the rest of the code can still read `conversationId`
  const conversationId = activeConvId;

  // Broadcast to the sidebar (and any other listener) whenever any conversation
  // starts or stops thinking, so the "New chat" button can be disabled.
  useEffect(() => {
    const isAnyTyping = Object.values(convStates).some((s) => s.isTyping);
    window.dispatchEvent(
      new CustomEvent("typing-state-changed", { detail: { isAnyTyping } })
    );
  }, [convStates]);

  // Track which conv IDs we have already loaded from the server (or are
  // actively streaming) so the history effect never overwrites live state.
  const loadedConvIds = useRef<Set<string>>(new Set());

  // ── Other UI state (not per-conversation) ───────────────────────────────────
  const [input, setInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<
    {
      id: string;
      name: string;
      status: "uploading" | "ready" | "error";
      blobUrl: string;    // short-lived SAS — used only for immediate RAG ingestion
      blobName: string;   // permanent blob path — used to build the proxy URL for display/storage
      fileType: "image" | "pdf" | "document";
      previewUrl?: string; // local object URL for instant preview before upload completes
    }[]
  >([]);
  const [isDragging, setIsDragging] = useState(false);
  const [intentChip, setIntentChip] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [curriculumBoard, setCurriculumBoard] = useState<string | null>(null);
  const [curriculumGrade, setCurriculumGrade] = useState<string | null>(null);
  const [curriculumEnabled, setCurriculumEnabled] = useState(false);
  // ── Dynamic model selection ────────────────────────────────────────────────
  // Defaults to "azure" (matches server-side default). Restored from Cosmos
  // when a conversation is loaded — see the history useEffect below.
  // Sent as model_provider on every /chat/message request so the backend
  // can route to the correct LLM provider for this specific conversation.
  const [modelProvider, setModelProvider] = useState<ProviderKey>("azure");

  // TTS / audio state
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [loadingAudioMsgId, setLoadingAudioMsgId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipHistoryReload = useRef(false);
  const lastLoadedId = useRef<string | null>(null);
  const forceScrollOnNextUpdateRef = useRef(false);
  // Tracks which pending key "owns" the new-chat view right now.
  // Set when a brand-new chat stream starts; cleared when the user navigates
  // away to a fresh new-chat screen. Prevents the meta handler from hijacking
  // the user's view if they clicked "New Chat" before the backend replied.
  const streamOwnerRef = useRef<string | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const handleEquationClick = (eq: string) => {
    const normalizedEquation = normalizeEquationForNova(eq);
    if (!normalizedEquation) return;
    navigate("/nova", { state: { equation: normalizedEquation } });
  };
  const [searchParams] = useSearchParams();
  const curriculumReady = Boolean(curriculumBoard && curriculumGrade);
  const curriculumContextActive = curriculumEnabled && curriculumReady;

  // Keep curriculum toggle available in chat composer without opening Settings.
  useEffect(() => {
    let cancelled = false;
    const loadCurriculumSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setCurriculumBoard(data.curriculum_board ?? null);
        setCurriculumGrade(data.curriculum_grade ?? null);
        setCurriculumEnabled(Boolean(data.curriculum_enabled ?? false));
      } catch {
        // Non-blocking: chat must still work if settings are unavailable.
      }
    };
    loadCurriculumSettings();
    return () => { cancelled = true; };
  }, []);

  const updateCurriculumToggle = (nextEnabled: boolean) => {
    if (nextEnabled && !curriculumReady) {
      toast.info("Set board and class in Settings before enabling curriculum context.");
      return;
    }

    // Optimistic update for instantaneous UI feedback.
    setCurriculumEnabled(nextEnabled);
    const body = JSON.stringify({ curriculum_enabled: nextEnabled });

    void (async () => {
      try {
        if (!navigator.onLine) {
          await addToSyncQueue({
            type: "settings_save",
            url: `${API_BASE}/settings/?user_id=${USER_ID}`,
            method: "PUT",
            body,
            createdAt: new Date().toISOString(),
          });
          return;
        }

        await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch {
        // Keep optimistic state to avoid visible lag/jitter.
      }
    })();
  };

  // AutoSend trigger: fires sendMessage on mount if sessionStorage flag is set.
  useEffect(() => {
    if (!sessionStorage.getItem('sb_landing_autosend')) return;
    const t = setTimeout(() => sendMessage(), 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill input from navigation state (autoSend from landing page)
  useEffect(() => {
    const state = location.state as { prefillInput?: string; autoSend?: boolean } | null;
    if (state?.prefillInput) {
      setInput(state.prefillInput);
      if (state.autoSend) {
        sessionStorage.setItem('sb_landing_autosend', state.prefillInput);
      }
      window.history.replaceState({}, document.title);
    }
  }, []);

  // Load conversation from URL param
  useEffect(() => {
    const urlConversationId = searchParams.get("conversationId");

    if (!urlConversationId) {
      // Navigating to the new-chat screen — just switch the active view.
      // We do NOT wipe convStates; background streams keep running untouched.
      // Clear both the stream owner and the pending key so the old stream can
      // no longer auto-navigate back here, and the screen shows blank.
      streamOwnerRef.current = null;
      setPendingConvKey(null);
      setActiveConvId(null);
      setInput("");
      lastLoadedId.current = null;
      setModelProvider("azure"); // reset to default — new chat has no stored provider
      return;
    }

    if (skipHistoryReload.current) {
      skipHistoryReload.current = false;
      return;
    }

    // Always update which conv is on screen immediately
    setActiveConvId(urlConversationId);

    // If this conv is already in our state map (streaming or previously visited)
    // don't overwrite it with a server fetch — just show what we have.
    if (loadedConvIds.current.has(urlConversationId)) {
      lastLoadedId.current = urlConversationId;
      return;
    }

    setIsLoadingHistory(true);
    // Initialise an empty slot so the spinner shows while we fetch
    setConvStates((prev) => ({
      ...prev,
      [urlConversationId]: {
        messages: [],
        isTyping: false,
        isReadingDoc: false,
        isSearchingWeb: false,
        regeneratingMsgId: null,
        retakingMsgId: null,
      },
    }));

    const loadHistory = async () => {
      let data: any = null;

      // Try network first, fall back to IndexedDB cache
      try {
        const res = await fetch(`${API_BASE}/chat/history/${urlConversationId}`);
        if (!res.ok) throw new Error("fetch failed");
        data = await res.json();
        // Cache for offline browsing (non-blocking)
        cacheConversation({
          conversation_id: urlConversationId,
          messages: data.messages,
          cachedAt: new Date().toISOString(),
        }).catch(() => {});
      } catch {
        // Offline or network error — try cache
        try {
          const cached = await getCachedConversation(urlConversationId);
          if (cached) {
            data = { messages: cached.messages };
          } else {
            // Not cached — show inline message instead of blank screen
            updateConv(urlConversationId, () => ({
              messages: [
                INITIAL_MESSAGES[0],
                {
                  id: "offline-notice",
                  role: "assistant" as const,
                  content: "📡 This conversation isn't available offline. Open it once while connected to cache it for offline viewing.",
                  timestamp: new Date(),
                },
              ],
              isTyping: false, isReadingDoc: false, isSearchingWeb: false,
              regeneratingMsgId: null, retakingMsgId: null,
            }));
            setIsLoadingHistory(false);
            lastLoadedId.current = urlConversationId;
            loadedConvIds.current.add(urlConversationId);
            return;
          }
        } catch {
          toast.error("Could not load conversation history.");
          setIsLoadingHistory(false);
          return;
        }
      }

      try {
        const loadedMessages: Message[] = data.messages.map((m: any) => {
          let parsed: any = null;
          if (
            m.role === "assistant" &&
            typeof m.content === "string" &&
            m.content.startsWith('{"__type":')
          ) {
            try {
              parsed = JSON.parse(m.content);
            } catch {
              /* not JSON, render as text */
            }
          }

          if (parsed?.__type === "quiz") {
            return {
              id: m.id,
              role: "quiz" as const,
              content: "",
              quizData: {
                quiz_id: parsed.quiz_id,
                topic: parsed.topic,
                questions: parsed.questions ?? [],
                submitted: parsed.submitted ?? false,
                fun_fact: parsed.fun_fact ?? "",
                score: parsed.score,
                correct_count: parsed.correct_count,
                total_questions: parsed.total_questions,
                weak_areas: parsed.weak_areas ?? [],
                results: parsed.results ?? [],
                timer_seconds: parsed.timer_seconds ?? null,
                num_questions: parsed.num_questions ?? (parsed.questions?.length ?? 5),
                unanswered_indices: parsed.unanswered_indices?.length > 0
                  ? parsed.unanswered_indices
                  : undefined,
              },
              timestamp: new Date(m.timestamp),
            };
          }

          if (parsed?.__type === "diagram") {
            return {
              id: m.id,
              role: "diagram" as const,
              content: "",
              diagramData: {
                diagram_id: parsed.diagram_id,
                type: parsed.type as "flowchart" | "diagram",
                topic: parsed.topic,
                mermaid_code: parsed.mermaid_code,
                created_at: parsed.created_at,
              },
              timestamp: new Date(m.timestamp),
            };
          }

          if (parsed?.__type === "image") {
            return {
              id: m.id,
              role: "image" as const,
              content: "",
              imageData: {
                diagram_id: parsed.diagram_id,
                type: "image" as const,
                topic: parsed.topic,
                image_url: parsed.image_url,
                created_at: parsed.created_at,
              },
              timestamp: new Date(m.timestamp),
            };
          }

          if (parsed?.__type === "study_plan") {
            return {
              id: m.id,
              role: "study_plan" as const,
              content: "",
              studyPlanData: {
                plan_id: parsed.plan_id,
                title: parsed.title,
                start_date: parsed.start_date,
                end_date: parsed.end_date,
                weeks: parsed.weeks,
                summary: parsed.summary,
                goal_saved: parsed.goal_saved ?? false,
              },
              timestamp: new Date(m.timestamp),
            };
          }

          // Reconstruct web search answers: restore answer text + source cards + image grid from Cosmos
          if (parsed?.__type === "web_search_answer") {
            const rawAnswer = parsed.answer ?? "";
            const isRefusalAnswer = isSafetyRefusalText(rawAnswer);
            const regenVersions = Array.isArray(parsed.regen_versions)
              ? parsed.regen_versions
                  .map((v: any) => ({
                    content: v?.content ?? v?.answer ?? "",
                    webSearchSources: isSafetyRefusalText(v?.content ?? v?.answer ?? "")
                      ? undefined
                      : (v?.sources?.length ? v.sources : undefined),
                    webSearchImages: isSafetyRefusalText(v?.content ?? v?.answer ?? "")
                      ? undefined
                      : (v?.images?.length ? v.images : undefined),
                    webSearchVideos: isSafetyRefusalText(v?.content ?? v?.answer ?? "")
                      ? undefined
                      : (v?.videos?.length ? v.videos : undefined),
                  }))
                  .filter((v: any) => typeof v.content === "string")
              : undefined;
            const activeRegenVersionIdx =
              typeof parsed.active_regen_version_idx === "number" && regenVersions && regenVersions.length > 0
                ? Math.max(0, Math.min(parsed.active_regen_version_idx, regenVersions.length - 1))
                : regenVersions && regenVersions.length > 0
                  ? regenVersions.length - 1
                  : undefined;
            return {
              id: m.id,
              role: "assistant" as const,
              content: rawAnswer.replace(/^__REFUSED__\s*/i, ""),
              webSearchSources: !isRefusalAnswer && parsed.sources?.length > 0 ? parsed.sources : undefined,
              webSearchImages: !isRefusalAnswer && parsed.images?.length > 0 ? parsed.images : undefined,
              webSearchVideos: !isRefusalAnswer && parsed.videos?.length > 0 ? parsed.videos : undefined,
              regenVersions,
              activeRegenVersionIdx,
              timestamp: new Date(m.timestamp),
            };
          }

          // Detect user messages with attachments and/or intent chip
          if (
            m.role === "user" &&
            typeof m.content === "string" &&
            m.content.includes('"__type"')
          ) {
            try {
              const parsed = JSON.parse(m.content);
              const t = parsed.__type;
              if (
                t === "user_with_attachments" ||
                t === "user_with_intent" ||
                t === "user_with_intent_and_attachments"
              ) {
                return {
                  id: m.id,
                  role: "user" as const,
                  content: parsed.text ?? "",
                  intentHint: parsed.intent_hint ?? undefined,
                  attachments: (parsed.attachments ?? []).map((a: any) => ({
                    name: a.name,
                    // Prefer blob_name (host-agnostic) → rebuild proxy URL with current API_BASE
                    // Falls back to stored blob_url for old messages that predate blob_name storage
                    blobUrl: a.blob_name
                      ? `${API_BASE}/upload/view-file?blob_name=${encodeURIComponent(a.blob_name)}`
                      : a.blob_url,
                    fileType: a.file_type as "image" | "pdf" | "document",
                  })),
                  timestamp: new Date(m.timestamp),
                };
              }
            } catch {
              /* fall through */
            }
          }

          // Default: regular text message
          return {
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: new Date(m.timestamp),
          };
        });

        // ── Post-process: merge retake quiz messages into their parent's quizVersions ──
        // The backend saves a "Generate a fresh quiz on: <topic>" user message + quiz
        // assistant message for every retake. On reload we collapse those back into a
        // single card with a version navigator instead of separate cards.
        const RETAKE_PREFIX = "Generate a fresh quiz on:";
        const mergedMessages: Message[] = [];
        for (let i = 0; i < loadedMessages.length; i++) {
          const msg = loadedMessages[i];
          const nextMsg = loadedMessages[i + 1];
          if (
            msg.role === "user" &&
            typeof msg.content === "string" &&
            msg.content.startsWith(RETAKE_PREFIX) &&
            nextMsg?.role === "quiz" &&
            nextMsg.quizData
          ) {
            // Find the most recent quiz card in already-merged output
            // findLastIndex is ES2023 — use a backwards loop for compatibility
            let lastQuizIdx = -1;
            for (let j = mergedMessages.length - 1; j >= 0; j--) {
              if (mergedMessages[j].role === "quiz") { lastQuizIdx = j; break; }
            }
            if (lastQuizIdx >= 0) {
              const parent = mergedMessages[lastQuizIdx];
              const existingVersions: QuizData[] = parent.quizVersions ?? [parent.quizData!];
              mergedMessages[lastQuizIdx] = {
                ...parent,
                quizVersions: [...existingVersions, nextMsg.quizData!],
                activeVersionIdx: existingVersions.length, // show newest
                quizData: nextMsg.quizData!, // keep quizData pointing at active
              };
              i++; // skip the quiz assistant message — already merged
              continue;
            }
          }
          mergedMessages.push(msg);
        }

        updateConv(urlConversationId, () => ({
          messages:
            mergedMessages.length > 0
              ? [INITIAL_MESSAGES[0], ...mergedMessages]
              : INITIAL_MESSAGES,
          isTyping: false,
          isReadingDoc: false,
          isSearchingWeb: false,
          regeneratingMsgId: null,
          retakingMsgId: null,
        }));

        // Restore the model selector to the provider that was active when this
        // conversation was last used.  Falls back to "azure" for conversations
        // created before this feature was introduced (model_provider is null).
        if (data.model_provider === "azure" || data.model_provider === "gemini") {
          setModelProvider(data.model_provider);
        } else {
          setModelProvider("azure");
        }
      } catch {
        toast.error("Could not load conversation history.");
      } finally {
        setIsLoadingHistory(false);
        lastLoadedId.current = urlConversationId;
        loadedConvIds.current.add(urlConversationId);
      }
    };

    loadHistory();
  }, [searchParams]);

  // ── Sync conversation ID to URL + sidebar ───────────────────────────────
  const syncConversationToUrl = (cid: string, isNew: boolean) => {
    skipHistoryReload.current = true;
    navigate(`/chat?conversationId=${cid}`, { replace: true });
    if (isNew) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("conversation-created"));
      }, 700);
    }
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const syncTextareaHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const [translatingMsgId, setTranslatingMsgId] = useState<string | null>(null);
  const [translatedContent, setTranslatedContent] = useState<Record<string, string>>({});
  const [translatedLang, setTranslatedLang] = useState<Record<string, string>>({});
  const [showTranslatePicker, setShowTranslatePicker] = useState<string | null>(null);
  const [translatePickerUp, setTranslatePickerUp] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    syncTextareaHeight();
  };

  // Keep textarea height in sync for programmatic updates (speech-to-text,
  // prefill actions, or layout remounts) so multiline text never appears cut.
  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [input, intentChip]);

  // ── Effects ───────────────────────────────────────────────────────────────

  // Listen for imperative new-chat requests from the sidebar.
  // We cannot rely on the URL effect for this because navigate("/chat") is a
  // silent no-op when the URL is already "/chat" (no conversationId param) —
  // searchParams never changes, the effect never fires, and pendingConvKey /
  // streamOwnerRef are never cleared, leaving the user stuck watching the
  // in-progress stream with no way to start a fresh conversation.
  useEffect(() => {
    const handler = () => {
      streamOwnerRef.current = null;
      setPendingConvKey(null);
      setActiveConvId(null);
      setInput("");
      lastLoadedId.current = null;
      setModelProvider("azure"); // reset to default — new chat has no stored provider
      navigate("/chat", { replace: true });
    };
    window.addEventListener("new-chat-clicked", handler);
    return () => window.removeEventListener("new-chat-clicked", handler);
  }, [navigate]);

  // Use rAF after chip layout toggles because the textarea node may remount.
  useEffect(() => {
    requestAnimationFrame(syncTextareaHeight);
  }, [intentChip]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (forceScrollOnNextUpdateRef.current) {
      scrollToBottom("smooth");
      forceScrollOnNextUpdateRef.current = false;
    }
  }, [messages, isTyping]);

  // Stop audio when leaving the page
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      audioRef.current?.pause();
    };
  }, []);

  // Stop audio when switching browser tab
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stopSpeech();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Stop audio when new messages arrive
  useEffect(() => {
    stopSpeech();
  }, [messages.length]);

  // ── stopSpeech helper ─────────────────────────────────────────────────────
  const stopSpeech = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeakingMsgId(null);
    setLoadingAudioMsgId(null);
  };

  // ── Script auto-detection for TTS ──────────────────────────────────────────
  // When the AI responds directly in a non-English language (e.g. user asked
  // "explain in Hindi"), translatedLang is never set. We detect the dominant
  // Unicode script in the text and pick the correct voice automatically.
  const detectScriptLang = (text: string): string | null => {
    const counts: Record<string, number> = {
      hi: (text.match(/[ऀ-ॿ]/g) || []).length, // Devanagari (Hindi/Marathi overlap)
      ta: (text.match(/[஀-௿]/g) || []).length, // Tamil
      te: (text.match(/[ఀ-౿]/g) || []).length, // Telugu
      bn: (text.match(/[ঀ-৿]/g) || []).length, // Bengali
      gu: (text.match(/[઀-૿]/g) || []).length, // Gujarati
      kn: (text.match(/[ಀ-೿]/g) || []).length, // Kannada
      mr: (text.match(/[ऀ-ॿ]/g) || []).length, // Marathi (same Devanagari range as Hindi)
    };
    // Find the script with the highest character count
    const best = Object.entries(counts).reduce(
      (a, b) => (b[1] > a[1] ? b : a),
      ["", 0]
    );
    // Only override if a meaningful number of non-Latin chars found (>5% of text length)
    if (best[1] > 0 && best[1] / text.length > 0.05) {
      // Devanagari is shared by Hindi and Marathi — prefer app language if it's one of them,
      // otherwise default to Hindi (more common).
      if (best[0] === "mr" || best[0] === "hi") {
        return (language === "mr") ? "mr" : "hi";
      }
      return best[0];
    }
    return null;
  };

  // ── Azure Neural TTS ────────────────────────────────────────────────────────
  const speakText = async (msgId: string, text: string, langOverride?: string) => {
    if (speakingMsgId === msgId || loadingAudioMsgId === msgId) {
      stopSpeech();
      return;
    }
    stopSpeech();

    // If the whole message is just code blocks, don't call TTS at all —
    // show a friendly nudge instead of an Azure 400 error.
    const hasFencedCode = /```[\s\S]*?```/.test(text);
    const textWithoutCode = text.replace(/```[\s\S]*?```/g, "").trim();
    if (hasFencedCode && !textWithoutCode) {
      toast("Audio isn't available for code-only messages.", { icon: "💡" });
      return;
    }

    const cleanText = (hasFencedCode ? textWithoutCode : text)
      .replace(/\\\[[\s\S]*?\\\]/g, "")   // strip \[...\] display math
      .replace(/\\\([\s\S]*?\\\)/g, "")   // strip \(...\) inline math
      .replace(/\$\$[\s\S]*?\$\$/g, "")      // strip $$...$$ display math
      .replace(/\$[^$\r\n]+\$/g, "")          // strip $...$ inline math
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`(.*?)`/g, "$1")
      .replace(/#{1,6}\s/g, "")
      .replace(/[-*]\s/g, "")
      .trim();
    if (!cleanText) return;

    // Priority: explicit override (Translate button) → script auto-detection → app language
    const targetLang = langOverride ?? detectScriptLang(cleanText) ?? language;
    setLoadingAudioMsgId(msgId);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE}/chat/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, language: targetLang, voice_style: voice }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: "TTS failed" }));
        throw new Error(err.detail ?? "TTS request failed");
      }

      const blob = await response.blob();
      const objectURL = URL.createObjectURL(blob);
      const audio = new Audio(objectURL);
      audioRef.current = audio;

      audio.onplay = () => {
        setLoadingAudioMsgId(null);
        setSpeakingMsgId(msgId);
      };
      audio.onended = () => {
        URL.revokeObjectURL(objectURL);
        audioRef.current = null;
        abortRef.current = null;
        setSpeakingMsgId(null);
        setLoadingAudioMsgId(null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectURL);
        audioRef.current = null;
        abortRef.current = null;
        setSpeakingMsgId(null);
        setLoadingAudioMsgId(null);
        toast.error("Audio playback failed.");
      };

      await audio.play();
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setSpeakingMsgId(null);
      setLoadingAudioMsgId(null);
      audioRef.current = null;
      abortRef.current = null;
      toast.error("Whoops, that message is a bit too long for our free plan! Upgrade to a Pro plan to listen to longer texts.");
    }
  };

  // ── STT ─────────────────────────────────────────────────────────────────────
  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast.error("Your browser doesn't support speech input. Try Chrome or Edge.");
      return;
    }

    const recognition: any = new SpeechRecognitionAPI();
    recognition.lang = LANG_TO_BCP47[language] ?? "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    baseTextRef.current = input;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) baseTextRef.current = (baseTextRef.current + " " + final).trim();
      setInput((baseTextRef.current + " " + interim).trim());
      requestAnimationFrame(syncTextareaHeight);
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      const msgs: Record<string, string> = {
        "language-not-supported": "Speech input not supported for this language. Try English.",
        "not-allowed": "Microphone access denied.",
        "no-speech": "No speech detected.",
        network: "Network error during speech recognition.",
      };
      toast.error(msgs[event.error] ?? "Speech recognition error. Try typing instead.");
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  // ── Translation ─────────────────────────────────────────────────────────────
  const translateMessage = async (msgId: string, text: string, targetLang: string) => {
    stopSpeech();
    setShowTranslatePicker(null);
    setTranslatingMsgId(msgId);
    try {
      const response = await fetch(`${API_BASE}/chat/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target_language: targetLang }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Translation failed");
      }
      const data = await response.json();
      setTranslatedContent((prev) => ({ ...prev, [msgId]: data.translated_text }));
      setTranslatedLang((prev) => ({ ...prev, [msgId]: targetLang }));
    } catch (err: any) {
      toast.error(`Translation failed: ${err.message}`);
    } finally {
      setTranslatingMsgId(null);
    }
  };

  // ── Quiz helpers ────────────────────────────────────────────────────────────
  const handleQuizComplete = (messageId: string, updatedQuizData: QuizData) => {
    if (!activeConvId) return;

    // Cache quiz for offline retake (results contain correct_index)
    if (updatedQuizData.results && updatedQuizData.results.length > 0) {
      import("@/lib/offlineStore").then(({ cacheQuizDetail }) => {
        cacheQuizDetail({
          quiz_id: updatedQuizData.quiz_id,
          topic: updatedQuizData.topic,
          questions: updatedQuizData.results!.map(r => ({
            question: r.question,
            options: r.options,
            correct_index: r.correct_index,
            explanation: r.explanation,
          })),
          timer_seconds: updatedQuizData.timer_seconds,
          num_questions: updatedQuizData.num_questions,
          cachedAt: new Date().toISOString(),
        }).catch(() => {});
      });
    }

    updateConv(activeConvId, (s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        // Bug 1 fix: also sync the matching entry inside quizVersions so that
        // switching attempts via the version navigator never reverts to the
        // unsubmitted state (quizData was updated but quizVersions was stale).
        const updatedVersions = m.quizVersions?.map((v) =>
          v.quiz_id === updatedQuizData.quiz_id ? updatedQuizData : v
        );
        return {
          ...m,
          quizData: updatedQuizData,
          ...(updatedVersions ? { quizVersions: updatedVersions } : {}),
        };
      }),
    }));
  };

  const handleRetake = async (originalQuizData: QuizData, msgId: string) => {
    if (!activeConvId) return;
    const convId = activeConvId;
    updateConv(convId, (s) => ({ ...s, retakingMsgId: msgId }));

    // Bug: quiz titles fix — send the raw topic as the message (no "Generate a fresh quiz on:" prefix),
    // and pass count + timer as dedicated override fields so the backend never needs to regex-parse
    // them from text. The old approach embedded them in message text which broke the _INTENT_STRIP
    // regex and polluted quiz titles with "Generate a fresh quiz on: Generate a fresh quiz on: ..."
    const retakeMessage = originalQuizData.topic;
    try {
      const response = await fetch(`${API_BASE}/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: convId,
          message: retakeMessage,
          intent_hint: "quiz",
          num_questions_override: originalQuizData.num_questions ?? originalQuizData.questions.length,
          timer_seconds_override: originalQuizData.timer_seconds ?? null,
          model_provider: modelProvider,
        }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split("\n\n").filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") break;
          let evt: any;
          try { evt = JSON.parse(dataStr); } catch { continue; }
          if (evt.type === "quiz_result" && evt.data) {
            const d = evt.data;
            const newQuiz: QuizData = {
              quiz_id: d.quiz_id,
              topic: d.topic,
              questions: d.questions,
              submitted: false,
              fun_fact: d.fun_fact ?? "",
              timer_seconds: originalQuizData.timer_seconds ?? null,
              num_questions: originalQuizData.num_questions ?? originalQuizData.questions.length,
            };
            // Push new quiz into versions array on the same card — no new message
            updateConv(convId, (s) => ({
              ...s,
              retakingMsgId: null,
              messages: s.messages.map((m) => {
                if (m.id !== msgId) return m;
                const existingVersions: QuizData[] = m.quizVersions ?? [m.quizData!];
                const newVersions = [...existingVersions, newQuiz];
                return {
                  ...m,
                  quizData: newQuiz,                    // active = newest
                  quizVersions: newVersions,
                  activeVersionIdx: newVersions.length - 1,
                };
              }),
            }));
          }
        }
      }
    } catch (err: any) {
      toast.error(`Retake failed: ${err.message}`);
      updateConv(convId, (s) => ({ ...s, retakingMsgId: null }));
    }
  };

  // Switch which attempt is shown in a versioned quiz card
  const handleVersionSwitch = (msgId: string, newIdx: number) => {
    if (!activeConvId) return;
    updateConv(activeConvId, (s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== msgId || !m.quizVersions) return m;
        return {
          ...m,
          activeVersionIdx: newIdx,
          quizData: m.quizVersions[newIdx],
        };
      }),
    }));
  };

  // Switch which regenerated response version is shown
  const handleRegenVersionSwitch = (msgId: string, newIdx: number) => {
    if (!activeConvId) return;
    updateConv(activeConvId, (s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== msgId || !m.regenVersions) return m;
        if (newIdx < 0 || newIdx >= m.regenVersions.length) return m;
        const version = m.regenVersions[newIdx];
        return {
          ...m,
          content: version.content,
          webSearchSources: version.webSearchSources,
          webSearchImages: version.webSearchImages,
          webSearchVideos: version.webSearchVideos,
          activeRegenVersionIdx: newIdx,
        };
      }),
    }));
  };

  // ── Shared SSE stream helper ────────────────────────────────────────────────
  const streamIntoMessage = async (
    userText: string,
    targetMsgId: string,
    convId: string
  ) => {
    const response = await fetch(`${API_BASE}/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: USER_ID,
        conversation_id: convId,
        message: userText,
        model_provider: modelProvider,
      }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let firstChunk = true;

    // ── OPT 4: RAF batching — accumulate text tokens in a plain variable and
    // flush to React state at most once per animation frame (60fps).
    // Without this, each SSE token triggers a re-render which blocks reader.read(),
    // causing tokens to pile up in the TCP buffer and arrive in large bursts.
    let pendingContent = "";
    let rafScheduled = false;
    const flushPending = () => {
      if (pendingContent === "") return;
      const toFlush = pendingContent;
      pendingContent = "";
      rafScheduled = false;
      // Use updateConv so the flush writes into the correct conversation slot
      updateConv(convId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === targetMsgId
            ? { ...m, content: firstChunk ? toFlush : m.content + toFlush }
            : m
        ),
      }));
      firstChunk = false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split("\n\n").filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") {
          flushPending(); // flush any remaining buffered text before stopping
          updateConv(convId, (s) => ({ ...s, isTyping: false }));
          break;
        }

        let parsed: { type: string; content?: string; conversation_id?: string };
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue;
        }

        // meta — backend confirms conversation ID (shouldn't change for regen, but guard anyway)
        if (parsed.type === "meta" && parsed.conversation_id) {
          setActiveConvId((prev) =>
            prev === convId ? parsed.conversation_id! : prev
          );
        }

        if (parsed.type === "text" && parsed.content) {
          // Accumulate into plain variable — RAF batches the actual React update
          pendingContent += parsed.content;
          if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(flushPending);
          }
        }

        if (parsed.type === "error") {
          toast.error(`AI error: ${parsed.content}`);
          updateConv(convId, (s) => ({ ...s, isTyping: false }));
          break;
        }
      }
    }
  };

  // ── Regenerate ──────────────────────────────────────────────────────────────
  const regenerateMessage = async (assistantMsgId: string) => {
    stopSpeech();

    const convId = activeConvId;
    if (!convId) return;

    // Clear translation cache for this message
    setTranslatedContent((prev) => {
      const n = { ...prev };
      delete n[assistantMsgId];
      return n;
    });
    setTranslatedLang((prev) => {
      const n = { ...prev };
      delete n[assistantMsgId];
      return n;
    });

    // Capture the current version BEFORE clearing, for the version history
    const currentConvState = convStates[convId];
    const currentMsg = currentConvState?.messages.find(m => m.id === assistantMsgId);
    const existingRegenVersions = currentMsg?.regenVersions ?? [];

    // Build the "previous versions" list — on first regen, seed it with the original response.
    // On subsequent regens, existingRegenVersions already contains all previous versions.
    const versionsBeforeRegen = existingRegenVersions.length > 0
      ? existingRegenVersions
      : currentMsg
        ? [{
            content: currentMsg.content,
            webSearchSources: currentMsg.webSearchSources,
            webSearchImages: currentMsg.webSearchImages,
            webSearchVideos: currentMsg.webSearchVideos,
          }]
        : [];

    // Clear the message content AND all web-search metadata, mark as regenerating
    updateConv(convId, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: "",
              webSearchSources: undefined,
              webSearchImages: undefined,
              webSearchVideos: undefined,
            }
          : m
      ),
      regeneratingMsgId: assistantMsgId,
      isTyping: true,
    }));

    try {
      // ── Call the dedicated regenerate endpoint ──────────────────────────────
      // Unlike /chat/message, this endpoint:
      //   • does NOT save a new user message to Cosmos (no duplicate on refresh)
      //   • REPLACES the existing assistant message (no duplicate on refresh)
      //   • injects a variation instruction so Gemini produces a different answer
      const response = await fetch(`${API_BASE}/chat/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: convId,
          message_id: assistantMsgId,
        }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let firstChunk = true;

      // Track the full new content and new web search metadata for version history
      let fullNewContent = "";
      let newSources: WebSearchSource[] | undefined;
      let newImages: WebSearchImage[] | undefined;
      let newVideos: WebSearchVideo[] | undefined;
      let regenDone = false;

      // RAF batching — same pattern as sendMessage for smooth 60fps streaming
      let pendingContent = "";
      let rafScheduled = false;
      const flushPending = () => {
        if (pendingContent === "") return;
        const toFlush = pendingContent;
        pendingContent = "";
        rafScheduled = false;
        fullNewContent = firstChunk ? toFlush : fullNewContent + toFlush;
        updateConv(convId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: firstChunk ? toFlush : m.content + toFlush }
              : m
          ),
        }));
        firstChunk = false;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n\n").filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            flushPending();
            regenDone = true;
            updateConv(convId, (s) => ({ ...s, isTyping: false }));
            break;
          }

          let parsed: any;
          try { parsed = JSON.parse(dataStr); } catch { continue; }

          if (parsed.type === "text" && parsed.content) {
            pendingContent += parsed.content;
            if (!rafScheduled) {
              rafScheduled = true;
              requestAnimationFrame(flushPending);
            }
          }

          // Handle web search metadata events so sources/images/videos are
          // refreshed rather than lost or stale after regeneration.
          if (parsed.type === "web_search_sources" && parsed.data) {
            flushPending();
            newSources = parsed.data as WebSearchSource[];
            updateConv(convId, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? isSafetyRefusalText(m.content)
                    ? { ...m, webSearchSources: undefined, webSearchImages: undefined, webSearchVideos: undefined }
                    : { ...m, webSearchSources: newSources }
                  : m
              ),
            }));
          }

          if (parsed.type === "web_search_images" && parsed.data) {
            flushPending();
            newImages = parsed.data as WebSearchImage[];
            updateConv(convId, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? isSafetyRefusalText(m.content)
                    ? { ...m, webSearchSources: undefined, webSearchImages: undefined, webSearchVideos: undefined }
                    : { ...m, webSearchImages: newImages }
                  : m
              ),
            }));
          }

          if (parsed.type === "web_search_videos" && parsed.data) {
            flushPending();
            newVideos = parsed.data as WebSearchVideo[];
            updateConv(convId, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMsgId
                  ? isSafetyRefusalText(m.content)
                    ? { ...m, webSearchSources: undefined, webSearchImages: undefined, webSearchVideos: undefined }
                    : { ...m, webSearchVideos: newVideos }
                  : m
              ),
            }));
          }

          // Fix 2: sync the real Cosmos message ID from the backend
          if (parsed.type === "message_saved" && parsed.message_id) {
            const realId: string = parsed.message_id;
            if (realId !== assistantMsgId) {
              updateConv(convId, (s) => ({
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, id: realId } : m
                ),
              }));
              // Update assistantMsgId reference in regenVersions push below
              // (we reference it by closure, so we mutate the outer variable)
              assistantMsgId = realId;
            }
          }

          if (parsed.type === "error") {
            toast.error(`Regeneration failed: ${parsed.content}`);
            updateConv(convId, (s) => ({ ...s, isTyping: false }));
            break;
          }
        }
      }

      // Fix 3: Push the new version to regenVersions so user can navigate back
      if (regenDone && fullNewContent) {
        const newVersion = {
          content: fullNewContent,
          webSearchSources: newSources,
          webSearchImages: newImages,
          webSearchVideos: newVideos,
        };
        const allVersions = [...versionsBeforeRegen, newVersion];
        updateConv(convId, (s) => ({
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== assistantMsgId) return m;
            return {
              ...m,
              regenVersions: allVersions,
              activeRegenVersionIdx: allVersions.length - 1,
            };
          }),
        }));
      }
    } catch {
      toast.error("Could not reach the server. Is the backend running?");
    } finally {
      updateConv(convId, (s) => ({ ...s, regeneratingMsgId: null, retakingMsgId: null, isTyping: false }));
    }
  };

  // ── sendMessage ─────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    // AutoSend from landing page: read sessionStorage override.
    const landingMsg = sessionStorage.getItem('sb_landing_autosend') || '';
    if (landingMsg) sessionStorage.removeItem('sb_landing_autosend');

    const hasContent =
      (landingMsg || input.trim()) || attachedFiles.some((f) => f.status === "ready") || intentChip;
    const uploadingFiles = attachedFiles.filter((f) => f.status === "uploading");
    if (uploadingFiles.length > 0) {
      toast.info(
        uploadingFiles.length === 1
          ? `Please wait — "${uploadingFiles[0].name}" is still uploading.`
          : `Please wait — ${uploadingFiles.length} files are still uploading.`
      );
      return;
    }
    if (!hasContent || isTyping) return;

    const userMessage = landingMsg || input.trim();
    const sentFiles = attachedFiles.filter((f) => f.status === "ready");
    const chipValue = intentChip;

    setInput("");
    setAttachedFiles([]);
    setIntentChip(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsgId = generateUUID();
    const aiMsgId = generateUUID();

    // ── Snapshot which conversation this request belongs to ──────────────────
    // For a brand-new chat (no conversationId yet) we give each stream its own
    // unique ephemeral key (e.g. "__pending__<uuid>") instead of sharing the
    // single NEW_CONV_KEY. This means two overlapping new-chat streams can
    // never collide in convStates, and the blank new-chat screen (which still
    // derives its viewKey from NEW_CONV_KEY) always stays empty and clean.
    const startConvId = activeConvId; // null for new chat
    let convKey = startConvId ?? `__pending__${generateUUID()}`;

    // For brand-new chats, register this stream as the current "owner" of the
    // new-chat view. The meta handler uses this to decide whether to
    // auto-navigate the user once the real conversation ID arrives.
    // Also set pendingConvKey as React state so viewKey tracks this slot and
    // the user's message actually renders on screen.
    if (!startConvId) {
      streamOwnerRef.current = convKey;
      setPendingConvKey(convKey);
    }

    // Mark this slot as "live" so the history effect never overwrites it
    loadedConvIds.current.add(convKey);

    // Optimistically add the user's message and start the typing indicator,
    // all scoped to convKey so no other conversation is affected.
    updateConv(convKey, (s) => ({
      ...s,
      messages: [
        ...s.messages,
        {
          id: userMsgId,
          role: "user",
          content: userMessage,
          intentHint: chipValue ?? undefined,
          attachments: sentFiles.map((f) => ({
            name: f.name,
            // Use proxy URL for display: works forever regardless of SAS expiry
            blobUrl: f.blobName
              ? `${API_BASE}/upload/view-file?blob_name=${encodeURIComponent(f.blobName)}`
              : f.blobUrl,
            fileType: getFileType(f.name),
          })),
          timestamp: new Date(),
        },
      ],
      isTyping: true,
    }));
    forceScrollOnNextUpdateRef.current = true;

    // Existing-chat UX: move this chat up immediately in the sidebar.
    // If the request fails before any assistant output, we roll this back.
    if (startConvId) {
      window.dispatchEvent(
        new CustomEvent("conversation-optimistic-bump", {
          detail: { conversationId: startConvId },
        })
      );
    }

    let messageAdded = false;
    try {
      const primaryFile = sentFiles[0];
      // filePayload uses the real short-lived SAS so the backend can pass it
      // directly to Azure Document Intelligence for text extraction.
      // This is safe because it's used immediately after upload (within 1 hour).
      const filePayload = primaryFile
        ? { blob_url: primaryFile.blobUrl, filename: primaryFile.name }
        : {};
      const attachmentsPayload =
        sentFiles.length > 0
          ? {
              attachments: sentFiles.map((f) => ({
                name: f.name,
                blob_url: f.blobUrl,      // real SAS — used by backend for OCR
                blob_name: f.blobName ?? "", // permanent path — saved to Cosmos, host-agnostic
                file_type: f.fileType ?? getFileType(f.name),
              })),
            }
          : {};
      const intentPayload = chipValue ? { intent_hint: chipValue } : {};

      const response = await fetch(`${API_BASE}/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: startConvId, // null is correct for a new conversation
          message: userMessage,
          ...filePayload,
          ...attachmentsPayload,
          ...intentPayload,
          model_provider: modelProvider,
        }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      // ── OPT 4: RAF batching — same pattern as streamIntoMessage.
      // Accumulate SSE text tokens in a plain variable and flush to React state
      // at most once per animation frame. Keeps reader.read() unblocked so the
      // TCP buffer drains continuously → smooth word-by-word streaming.
      let pendingContent = "";
      let rafScheduled = false;
      const flushPending = () => {
        if (pendingContent === "") return;
        const toFlush = pendingContent;
        pendingContent = "";
        rafScheduled = false;
        // Use updateConv so the flush writes into the correct conversation slot
        if (!messageAdded) {
          updateConv(convKey, (s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: aiMsgId,
                role: "assistant",
                content: toFlush,
                timestamp: new Date(),
              },
            ],
          }));
          messageAdded = true;
        } else {
          updateConv(convKey, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === aiMsgId ? { ...m, content: m.content + toFlush } : m
            ),
          }));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n\n").filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            flushPending(); // flush any remaining buffered text before stopping
            updateConv(convKey, (s) => ({ ...s, isTyping: false }));
            // Fallback refresh signal so sidebar reorders even if message_saved
            // event arrives before listeners process state changes.
            window.dispatchEvent(
              new CustomEvent("conversation-updated", {
                detail: { conversationId: startConvId ?? convKey },
              })
            );
            break;
          }

          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          // ── meta: backend assigned a real conversation ID ────────────────
          if (parsed.type === "meta" && parsed.conversation_id) {
            const realId: string = parsed.conversation_id;
            if (convKey !== realId) {
              // Migrate the streaming state from the temp key to the real ID
              loadedConvIds.current.add(realId);
              loadedConvIds.current.delete(convKey);

              setConvStates((prev) => {
                const liveState = prev[convKey] ?? defaultConvState();
                const { [convKey]: _drop, ...rest } = prev;
                return { ...rest, [realId]: liveState };
              });

              if (startConvId) {
                // Case A: existing conversation — switch view unconditionally
                // if the user hasn't manually navigated somewhere else.
                setActiveConvId((prev) => (prev === startConvId ? realId : prev));
              } else {
                // Case B: brand-new conversation — only take over the view if
                // this stream still "owns" the new-chat screen (i.e. the user
                // has NOT clicked New Chat since this stream started).
                if (streamOwnerRef.current === convKey) {
                  streamOwnerRef.current = null;
                  setPendingConvKey(null);
                  setActiveConvId((prev) => (prev === null ? realId : prev));
                  skipHistoryReload.current = true;
                  navigate(`/chat?conversationId=${realId}`, { replace: true });
                }
                // Regardless of whether the user is still watching, tell the
                // sidebar to refresh so the new chat appears in the list.
                // No delay needed — the conversation is already committed to
                // Cosmos when the backend emits the meta event.
                window.dispatchEvent(new CustomEvent("conversation-created"));
              }

              if (startConvId) {
                // Update the URL for Case A (existing conv)
                skipHistoryReload.current = true;
                navigate(`/chat?conversationId=${realId}`, { replace: true });
              }

              // All subsequent SSE writes go to the real ID
              convKey = realId;
            }
          }

          // Document reading status
          if (parsed.type === "status") {
            updateConv(convKey, (s) => ({
              ...s,
              isReadingDoc: parsed.content === "reading_document",
              isSearchingWeb: parsed.content === "searching_web",
            }));
          }

          // Regular streaming text — accumulate into plain variable, RAF batches the React update
          if (parsed.type === "text" && parsed.content) {
            pendingContent += parsed.content;
            if (!rafScheduled) {
              rafScheduled = true;
              requestAnimationFrame(flushPending);
            }
          }

          // ── Feature result events ─────────────────────────────────────
          if (parsed.type === "quiz_result" && parsed.data) {
            const d = parsed.data;
            updateConv(convKey, (s) => ({
              ...s,
              messages: [
                ...s.messages,
                {
                  id: aiMsgId,
                  role: "quiz",
                  content: "",
                  quizData: {
                    quiz_id: d.quiz_id,
                    topic: d.topic,
                    questions: d.questions,
                    submitted: false,
                    fun_fact: d.fun_fact ?? "",
                    timer_seconds: d.timer_seconds ?? null,
                    num_questions: d.num_questions ?? (d.questions?.length ?? 5),
                },
                  timestamp: new Date(),
                },
              ],
            }));
            messageAdded = true;
          }

          if (parsed.type === "diagram_result" && parsed.data) {
            updateConv(convKey, (s) => ({
              ...s,
              messages: [
                ...s.messages,
                {
                  id: aiMsgId,
                  role: "diagram",
                  content: "",
                  diagramData: parsed.data as DiagramData,
                  timestamp: new Date(),
                },
              ],
            }));
            messageAdded = true;
          }

          if (parsed.type === "image_result" && parsed.data) {
            updateConv(convKey, (s) => ({
              ...s,
              messages: [
                ...s.messages,
                {
                  id: aiMsgId,
                  role: "image",
                  content: "",
                  imageData: { ...parsed.data, type: "image" as const },
                  timestamp: new Date(),
                },
              ],
            }));
            messageAdded = true;
          }

          if (parsed.type === "study_plan_result" && parsed.data) {
            updateConv(convKey, (s) => ({
              ...s,
              messages: [
                ...s.messages,
                {
                  id: aiMsgId,
                  role: "study_plan",
                  content: "",
                  studyPlanData: parsed.data as StudyPlanData,
                  timestamp: new Date(),
                },
              ],
            }));
            messageAdded = true;
          }

          // web_search_sources: attach citation cards to the streamed assistant message
          // IMPORTANT: flush RAF-buffered text first so aiMsgId exists in messages
          if (parsed.type === "web_search_sources" && parsed.data) {
            flushPending();
            updateConv(convKey, (s) => ({
              ...s,
              isSearchingWeb: false,
              messages: s.messages.map((m) =>
                m.id === aiMsgId
                  ? isSafetyRefusalText(m.content)
                    ? { ...m, webSearchSources: undefined, webSearchImages: undefined, webSearchVideos: undefined }
                    : { ...m, webSearchSources: parsed.data as WebSearchSource[] }
                  : m
              ),
            }));
          }

          // web_search_images: attach image grid to the streamed assistant message
          // IMPORTANT: flush RAF-buffered text first so aiMsgId exists in messages
          if (parsed.type === "web_search_images" && parsed.data) {
            flushPending();
            updateConv(convKey, (s) => ({
              ...s,
              isSearchingWeb: false,
              messages: s.messages.map((m) =>
                m.id === aiMsgId
                  ? isSafetyRefusalText(m.content)
                    ? { ...m, webSearchSources: undefined, webSearchImages: undefined, webSearchVideos: undefined }
                    : { ...m, webSearchImages: parsed.data as WebSearchImage[] }
                  : m
              ),
            }));
          }

          // web_search_videos: attach YouTube video cards (flush first same reason)
          if (parsed.type === "web_search_videos" && parsed.data) {
            flushPending();
            updateConv(convKey, (s) => ({
              ...s,
              isSearchingWeb: false,
              messages: s.messages.map((m) =>
                m.id === aiMsgId
                  ? isSafetyRefusalText(m.content)
                    ? { ...m, webSearchSources: undefined, webSearchImages: undefined, webSearchVideos: undefined }
                    : { ...m, webSearchVideos: parsed.data as WebSearchVideo[] }
                  : m
              ),
            }));
          }

          if (parsed.type === "error") {
            toast.error(`AI error: ${parsed.content}`);
            // If no AI response was ever streamed, remove the orphaned user
            // message so the chat doesn't show a prompt with no reply.
            updateConv(convKey, (s) => ({
              ...s,
              isTyping: false,
              messages: messageAdded
                ? s.messages
                : s.messages.filter((m) => m.id !== userMsgId),
            }));
            if (startConvId && !messageAdded) {
              window.dispatchEvent(
                new CustomEvent("conversation-optimistic-rollback", {
                  detail: { conversationId: startConvId },
                })
              );
            }
            break;
          }

          // ── message_saved: backend confirms the real Cosmos message ID ────
          // The frontend creates aiMsgId as a local UUID. Cosmos generates its
          // own UUID when save_message() is called. We must sync them so that
          // clicking Regenerate immediately after a response passes the correct
          // ID to /chat/regenerate instead of a frontend-only UUID.
          if (parsed.type === "message_saved" && parsed.message_id) {
            const realMsgId: string = parsed.message_id;
            updateConv(convKey, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === aiMsgId ? { ...m, id: realMsgId } : m
              ),
            }));
            // Primary refresh signal: backend has persisted the assistant reply.
            window.dispatchEvent(
              new CustomEvent("conversation-updated", {
                detail: { conversationId: startConvId ?? convKey },
              })
            );
          }
        }
      }
    } catch {
      toast.error("Could not reach the server. Is the backend running?");
      if (startConvId && !messageAdded) {
        window.dispatchEvent(
          new CustomEvent("conversation-optimistic-rollback", {
            detail: { conversationId: startConvId },
          })
        );
      }
    } finally {
      updateConv(convKey, (s) => ({ ...s, isTyping: false }));
    }
  };

  const processFiles = async (files: File[]) => {
    if (!files.length) return;
    const currentCount = attachedFiles.length;
    const availableSlots = 5 - currentCount;
    if (availableSlots <= 0) {
      toast.error("You can attach a maximum of 5 files at a time.");
      return;
    }
    const toAdd = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      toast.error(
        `Looks like you have a lot to upload! We skipped ${files.length - availableSlots} file(s) since you only have room for ${availableSlots} more. Upgrade to Pro Version to unlock larger batch uploads!`
      );
    }
    const newEntries = toAdd.map((file) => ({
      id: generateUUID(),
      name: file.name,
      status: "uploading" as const,
      blobUrl: "",
      blobName: "",
      fileType: getFileType(file.name),
      previewUrl: getFileType(file.name) === "image" ? URL.createObjectURL(file) : undefined,
    }));
    setAttachedFiles((prev) => [...prev, ...newEntries]);

    await Promise.all(
      toAdd.map(async (file, i) => {
        const entryId = newEntries[i].id;
        const formData = new FormData();
        formData.append("file", file);
        formData.append("user_id", USER_ID);
        try {
          const r = await fetch(`${API_BASE}/upload/blob-only`, {
            method: "POST",
            body: formData,
          });
          if (!r.ok) {
            const err = await r.json();
            // Pass the raw detail through so the catch block can inspect it
            throw new Error(err.detail || "Upload failed");
          }
          const data = await r.json();
          setAttachedFiles((prev) =>
            prev.map((f) =>
              f.id === entryId
                ? { ...f, status: "ready", blobUrl: data.blob_url, blobName: data.blob_name }
                : f
            )
          );
          // Award Study Coins for uploading a document
          completeMission("upload_doc").catch(() => {});
        } catch (err: any) {
          const msg: string = err.message || "";
          if (msg.startsWith("PAGE_LIMIT_EXCEEDED:")) {
            const pageCount = msg.split(":")[1];
            toast.error(
              `"${file.name}" has ${pageCount} pages. Free plan supports up to 35 pages. Upgrade to Pro Version to upload longer documents.`,
              { duration: 6000 }
            );
          } else if (msg.toLowerCase().includes("exceeds") && msg.toLowerCase().includes("mb")) {
            toast.error(
              `"${file.name}" is too large. Free plan supports up to 20 MB. Upgrade to Pro Version to upload larger files.`,
              { duration: 6000 }
            );
          } else {
            toast.error(`Could not upload "${file.name}". ${msg || "Please try again."}`);
          }
          setAttachedFiles((prev) => prev.filter((f) => f.id !== entryId));
        }
      })
    );
  };

  const getFileType = (name: string): "image" | "pdf" | "document" => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (["jpg", "jpeg", "png", "webp", "tiff"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    return "document";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = "";
    await processFiles(files);
  };

  const handleToolClick = (tool: (typeof TOOLS)[0]) => {
    setIntentChip(tool.intent);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const visibleMessages = messages.filter((msg) => msg.content !== "__welcome__");
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const shouldShowTypingIndicator =
    isTyping &&
    !regeneratingMsgId &&
    lastVisibleMessage?.role === "user";

  // ── Loading history spinner ─────────────────────────────────────────────────
  if (isLoadingHistory) {
    return (
      <div className="flex flex-col gap-5 p-4 md:p-6 overflow-hidden h-full animate-pulse">

        {/* Assistant bubble 1 — short */}
        <div className="flex justify-start">
          <div className="max-w-[70%] space-y-1.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-full bg-primary/20" />
              <div className="h-3 w-20 bg-secondary/50 rounded" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 space-y-2">
              <div className="h-3 w-48 bg-secondary/60 rounded" />
              <div className="h-3 w-36 bg-secondary/40 rounded" />
            </div>
          </div>
        </div>

        {/* User bubble 1 */}
        <div className="flex justify-end">
          <div className="max-w-[60%]">
            <div className="bg-primary/30 rounded-2xl rounded-br-md px-4 py-3 space-y-2">
              <div className="h-3 w-40 bg-primary/40 rounded" />
            </div>
          </div>
        </div>

        {/* Assistant bubble 2 — longer */}
        <div className="flex justify-start">
          <div className="max-w-[70%] space-y-1.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-full bg-primary/20" />
              <div className="h-3 w-20 bg-secondary/50 rounded" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 space-y-2">
              <div className="h-3 w-64 bg-secondary/60 rounded" />
              <div className="h-3 w-56 bg-secondary/50 rounded" />
              <div className="h-3 w-48 bg-secondary/40 rounded" />
              <div className="h-3 w-36 bg-secondary/30 rounded" />
            </div>
          </div>
        </div>

        {/* User bubble 2 */}
        <div className="flex justify-end">
          <div className="max-w-[55%]">
            <div className="bg-primary/30 rounded-2xl rounded-br-md px-4 py-3 space-y-2">
              <div className="h-3 w-52 bg-primary/40 rounded" />
              <div className="h-3 w-32 bg-primary/30 rounded" />
            </div>
          </div>
        </div>

        {/* Assistant bubble 3 — medium */}
        <div className="flex justify-start">
          <div className="max-w-[70%] space-y-1.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-full bg-primary/20" />
              <div className="h-3 w-20 bg-secondary/50 rounded" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 space-y-2">
              <div className="h-3 w-56 bg-secondary/60 rounded" />
              <div className="h-3 w-44 bg-secondary/40 rounded" />
              <div className="h-3 w-28 bg-secondary/30 rounded" />
            </div>
          </div>
        </div>

      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(pdf|png|jpg|jpeg|webp|tiff)$/i.test(f.name)
    );
    if (!files.length) {
      toast.error("Only PDF and image files are supported.");
      return;
    }
    await processFiles(files);
  };
  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter(
      (f) => /\.(pdf|png|jpg|jpeg|webp|tiff)$/i.test(f.name) || f.type.startsWith("image/")
    );
    if (!files.length) return;
    e.preventDefault();
    await processFiles(files);
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
        className="hidden"
        onChange={handleFileChange}
        multiple
      />

      {/* Drag & drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary/50 rounded-2xl flex flex-col items-center justify-center gap-3 pointer-events-none">
          <Paperclip className="w-10 h-10 text-primary animate-bounce" />
          <p className="text-primary font-semibold text-lg">Drop files here</p>
          <p className="text-muted-foreground text-sm">PDF, PNG, JPG, WEBP, TIFF · Max 5 files</p>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className={
          messages.length === 1 && messages[0].content === "__welcome__"
            ? "flex-1 overflow-hidden min-h-0"
            : "flex-1 overflow-y-auto min-h-0 p-4 md:p-6 pb-24 space-y-4"
        }
      >
        {/* Welcome screen — visible only before the user has sent anything */}
        {messages.length === 1 && (
          <WelcomeScreen
            onSuggestion={(prompt, intent) => {
              if (intent) setIntentChip(intent);
              // Don't pre-fill input — just set the chip and let the user type their topic
              setTimeout(() => textareaRef.current?.focus(), 50);
            }}
            onStarterPrompt={(prompt) => {
              setInput(prompt);
              setTimeout(() => textareaRef.current?.focus(), 50);
            }}
          />
        )}
        {messages.filter((msg) => msg.content !== "__welcome__").map((msg) => {
          if (msg.role === "quiz" && msg.quizData)
            return (
              <div key={msg.id} className="flex justify-start animate-fade-in">
                <div className="w-full max-w-[90%] md:max-w-[75%] min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                  </div>

                  {/* Version navigator — shown when there are multiple attempts */}
                  {(msg.quizVersions?.length ?? 0) > 1 && (
                    <div className="flex items-center justify-end gap-1 mb-1.5 pr-1">
                      <button
                        onClick={() => handleVersionSwitch(msg.id, (msg.activeVersionIdx ?? 0) - 1)}
                        disabled={(msg.activeVersionIdx ?? 0) === 0}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Attempt {(msg.activeVersionIdx ?? 0) + 1} / {msg.quizVersions!.length}
                      </span>
                      <button
                        onClick={() => handleVersionSwitch(msg.id, (msg.activeVersionIdx ?? 0) + 1)}
                        disabled={(msg.activeVersionIdx ?? 0) >= (msg.quizVersions!.length - 1)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5">
                    {/* Bug 1 fix: replace content entirely during retake so open breakdown
                        can't inflate the loading box. Fixed-height instead of overlay. */}
                    {retakingMsgId === msg.id ? (
                      <div className="flex flex-col items-center justify-center py-10 gap-3">
                        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                        <p className="text-xs text-muted-foreground">Generating new questions…</p>
                      </div>
                    ) : (
                      <QuizCard
                        key={msg.quizData.quiz_id}
                        messageId={msg.id}
                        quizData={msg.quizData}
                        onQuizComplete={handleQuizComplete}
                        onRetake={() => handleRetake(msg.quizData!, msg.id)}
                        userId={USER_ID}
                      />
                    )}
                  </div>
                </div>
              </div>
            );

          if (msg.role === "diagram" && msg.diagramData)
            return (
              <div key={msg.id} className="flex justify-start animate-fade-in">
                <div className="w-full max-w-[90%] md:max-w-[80%] min-w-0">
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

          if (msg.role === "image" && msg.imageData)
            return (
              <div key={msg.id} className="flex justify-start animate-fade-in">
                <div className="max-w-[60%] md:max-w-[50%]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                  </div>
                  <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-4">
                    <ImageCard imageData={msg.imageData} />
                  </div>
                </div>
              </div>
            );

          // Study Plan message
          if (msg.role === "study_plan" && msg.studyPlanData) {
            return (
              <div key={msg.id} className="flex justify-start animate-fade-in">
                <div className="w-full max-w-[90%] md:max-w-[80%] min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                  </div>
                  <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5">
                    <StudyPlanCard
                      studyPlanData={msg.studyPlanData}
                      conversationId={conversationId}
                      userId={USER_ID}
                    />
                  </div>
                </div>
              </div>
            );
          }

          if (msg.role === "assistant" && msg.content === "" && regeneratingMsgId !== msg.id)
            return null;

          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
            >
              <div className="max-w-[85%] md:max-w-[70%] min-w-0">
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                  </div>
                )}

                {regeneratingMsgId === msg.id && msg.content.length < 5 ? (
                  <LoadingDots size={65} />
                ) : (
                  <>
                    {msg.role === "user" && (() => {
                      const imageAtts = msg.attachments?.filter(a => a.fileType === "image") ?? [];
                      const fileAtts  = msg.attachments?.filter(a => a.fileType !== "image") ?? [];
                      return (
                        <>
                          {/* ── Image attachments — adaptive grid, right-aligned ── */}
                          {imageAtts.length > 0 && (
                            <div className={`grid gap-1.5 mb-1.5 w-fit ml-auto ${imageAtts.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                              {imageAtts.map((att) => (
                                <a
                                  key={att.name}
                                  href={att.blobUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block"
                                >
                                  <img
                                    src={att.blobUrl}
                                    alt={att.name}
                                    className="w-40 h-32 rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity border border-primary/20"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                          {/* ── Non-image attachments — pill style ── */}
                          {fileAtts.map((att) => (
                            <a
                              key={att.name}
                              href={att.blobUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 mb-1.5 bg-primary/80 rounded-2xl px-3 py-2 hover:opacity-80 transition-opacity"
                            >
                              <div className="w-7 h-7 rounded-md bg-primary-foreground/20 flex items-center justify-center shrink-0">
                                <Paperclip className="w-3.5 h-3.5 text-primary-foreground" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span
                                  className="text-xs font-medium text-primary-foreground truncate"
                                  title={att.name}
                                >
                                  {formatAttachmentName(att.name)}
                                </span>
                                <span className="text-xs text-primary-foreground/60">
                                  Click to open
                                </span>
                              </div>
                            </a>
                          ))}
                        </>
                      );
                    })()}

                    {/* Regeneration version navigator — shown above content for assistant messages with history */}
                    {msg.role === "assistant" && (msg.regenVersions?.length ?? 0) > 1 && (
                      <div className="flex items-center justify-end gap-1 mb-1.5 pr-1">
                        <button
                          onClick={() => handleRegenVersionSwitch(msg.id, (msg.activeRegenVersionIdx ?? 0) - 1)}
                          disabled={(msg.activeRegenVersionIdx ?? 0) === 0}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Previous response"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Response {(msg.activeRegenVersionIdx ?? 0) + 1} / {msg.regenVersions!.length}
                        </span>
                        <button
                          onClick={() => handleRegenVersionSwitch(msg.id, (msg.activeRegenVersionIdx ?? 0) + 1)}
                          disabled={(msg.activeRegenVersionIdx ?? 0) >= (msg.regenVersions!.length - 1)}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Next response"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {(msg.content || msg.intentHint) && (
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-relaxed break-words ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-md w-fit ml-auto"
                            : "bg-card border border-glow text-card-foreground rounded-bl-md"
                        }`}
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {msg.role === "user" ? (
                          <>
                            {msg.intentHint && (
                              <div
                                className={`flex items-center gap-1.5 ${
                                  msg.content
                                    ? "mb-1.5 pb-1.5 border-b border-primary-foreground/20"
                                    : ""
                                }`}
                              >
                                <span className="text-xs font-medium opacity-90">
                                  {INTENT_LABELS[msg.intentHint] ?? msg.intentHint}
                                </span>
                              </div>
                            )}
                            {msg.content}
                          </>
                        ) : (
                          renderMarkdown(translatedContent[msg.id] ?? msg.content, handleEquationClick)
                        )}

                        {msg.role === "assistant" && translatedContent[msg.id] && (
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40">
                            <span className="text-xs text-primary/70">🌐 Translated</span>
                            <button
                              onClick={() => {
                                stopSpeech();
                                setTranslatedContent((prev) => {
                                  const n = { ...prev };
                                  delete n[msg.id];
                                  return n;
                                });
                                setTranslatedLang((prev) => {
                                  const n = { ...prev };
                                  delete n[msg.id];
                                  return n;
                                });
                              }}
                              className="text-xs text-muted-foreground hover:text-primary"
                            >
                              Show original
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Web search source cards — rendered below the answer bubble */}
                    {msg.role === "assistant" && msg.webSearchSources && msg.webSearchSources.length > 0 && (
                      <WebSearchSourceCards sources={msg.webSearchSources} />
                    )}

                    {/* Web search image grid — rendered below the answer bubble */}
                    {msg.role === "assistant" && msg.webSearchImages && msg.webSearchImages.length > 0 && (
                      <WebSearchImageGrid images={msg.webSearchImages} />
                    )}

                    {/* YouTube video cards — rendered below the answer bubble */}
                    {msg.role === "assistant" && msg.webSearchVideos && msg.webSearchVideos.length > 0 && (
                      <WebSearchVideoCards videos={msg.webSearchVideos} />
                    )}
                  </>
                )}

                {msg.role === "assistant" && regeneratingMsgId !== msg.id && (
                  <div className="flex items-center gap-1 mt-2 ml-1 flex-wrap relative">
                    {[
                      {
                        icon:
                          loadingAudioMsgId === msg.id
                            ? RefreshCw
                            : speakingMsgId === msg.id
                              ? Square
                              : Volume2,
                        label:
                          loadingAudioMsgId === msg.id
                            ? "Loading..."
                            : speakingMsgId === msg.id
                              ? "Stop"
                              : "Audio",
                        action: () =>
                          speakText(
                            msg.id,
                            translatedContent[msg.id] ?? msg.content,
                            translatedLang[msg.id]
                          ),
                        spin: loadingAudioMsgId === msg.id,
                        disabled: !!regeneratingMsgId,
                      },
                      {
                        icon: Copy,
                        label: "Copy",
                        action: () =>
                          handleCopy(translatedContent[msg.id] ?? msg.content),
                        spin: false,
                        disabled: !!regeneratingMsgId,
                      },
                      {
                        icon: RefreshCw,
                        label:
                          regeneratingMsgId === msg.id
                            ? "Regenerating..."
                            : "Regenerate",
                        action: () => regenerateMessage(msg.id),
                        spin: regeneratingMsgId === msg.id,
                        disabled:
                          !!regeneratingMsgId || isTyping || msg.id === "1",
                      },
                    ].map((btn) => (
                      <Button
                        key={btn.label}
                        variant="ghost"
                        size="sm"
                        onClick={btn.action}
                        disabled={btn.disabled}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5 disabled:opacity-40"
                      >
                        <btn.icon
                          className={`w-3.5 h-3.5 ${btn.spin ? "animate-spin" : ""}`}
                        />
                        <span className="hidden sm:inline">{btn.label}</span>
                      </Button>
                    ))}

                    <div className="relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          const rect = (
                            e.currentTarget as HTMLElement
                          ).getBoundingClientRect();
                          const spaceBelow = window.innerHeight - rect.bottom;
                          setTranslatePickerUp(spaceBelow < 280);
                          setShowTranslatePicker(
                            showTranslatePicker === msg.id ? null : msg.id
                          );
                        }}
                        disabled={
                          translatingMsgId === msg.id || !!regeneratingMsgId
                        }
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5 disabled:opacity-40"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">
                          {translatingMsgId === msg.id
                            ? "Translating..."
                            : "Translate"}
                        </span>
                      </Button>
                      {showTranslatePicker === msg.id && (
                        <div
                          className={`absolute ${
                            translatePickerUp ? "bottom-9" : "top-9"
                          } right-0 z-50 bg-card border border-border rounded-xl shadow-xl p-1.5 min-w-[140px]`}
                        >
                          {[
                            { code: "en", label: "English" },
                            { code: "hi", label: "हिन्दी" },
                            { code: "mr", label: "मराठी" },
                            { code: "ta", label: "தமிழ்" },
                            { code: "te", label: "తెలుగు" },
                            { code: "bn", label: "বাংলা" },
                            { code: "gu", label: "ગુજરાતી" },
                            { code: "kn", label: "ಕನ್ನಡ" },
                          ].map((lang) => (
                            <button
                              key={lang.code}
                              onClick={() =>
                                translateMessage(msg.id, msg.content, lang.code)
                              }
                              className="w-full text-left text-xs px-3 py-2 rounded-lg text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                            >
                              {lang.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {shouldShowTypingIndicator && (
          <div className="flex justify-start items-center gap-3 animate-fade-in">
            <LoadingDots size={65} />
            {isReadingDoc && (
              <span className="text-xs text-muted-foreground/60 italic">
                Reading document...
              </span>
            )}
            {isSearchingWeb && (
              <span className="text-xs text-muted-foreground/60 italic flex items-center gap-1.5">
                <Search className="w-3 h-3 animate-pulse" />
                Searching the web...
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex-none w-full sticky bottom-0 z-20 pt-2 px-4 bg-background/95 backdrop-blur-md" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
        <div className="w-full max-w-4xl mx-auto">
          <div
            className={`flex flex-col bg-secondary/95 backdrop-blur-md border rounded-2xl shadow-2xl px-1 py-1 transition-all duration-200 ${
              isListening
                ? "border-red-500/60 shadow-red-500/10"
                : "border-border/70 focus-within:border-primary/50"
            }`}
          >
            {/* Attached files row — shown above textarea when files are attached */}
            {attachedFiles.length > 0 && (
              <div className="flex items-start gap-2 px-3 pt-3 pb-1 flex-wrap">
                {attachedFiles.map((file) => (
                  <div key={file.id} className="relative shrink-0 flex items-center gap-2 bg-muted/70 border border-border/50 rounded-xl px-2 py-1.5 pr-6 max-w-[160px]">
                    {/* Icon / thumbnail */}
                    {file.fileType === "image" ? (
                      <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-muted border border-border/40">
                        {file.previewUrl ? (
                          <img src={file.previewUrl} alt={file.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-lg shrink-0 bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    {/* Text */}
                    <div className="flex flex-col min-w-0">
                      <span
                        className="text-xs font-medium text-foreground truncate w-[80px] leading-tight"
                        title={file.name}
                      >
                        {formatAttachmentName(file.name)}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        {file.status === "uploading" ? (
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full border border-primary/40 border-t-primary animate-spin inline-block" />
                            Uploading
                          </span>
                        ) : file.fileType === "image" ? "Image" : (file.name.split(".").pop()?.toUpperCase() ?? "File")}
                      </span>
                    </div>
                    {/* Remove */}
                    <button
                      onClick={() => setAttachedFiles((prev) => prev.filter((f) => f.id !== file.id))}
                      className="absolute top-1 right-1.5 text-[10px] text-muted-foreground hover:text-foreground leading-none"
                      aria-label="Remove file"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            {intentChip ? (
              /* ── TWO-ROW layout when chip is active ── */
              <>
                {/* Row 1: textarea full width */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!isOnline) return;
                      if (!input.trim() && !attachedFiles.some((f) => f.status === "ready")) return;
                      sendMessage();
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={CHIP_PLACEHOLDERS[intentChip] ?? `Type a topic for ${INTENT_LABELS[intentChip] ?? intentChip}...`}
                  rows={1}
                  className="w-full bg-transparent text-foreground placeholder:text-muted-foreground text-sm px-4 pt-3 pb-1 resize-none outline-none min-h-[44px] overflow-hidden"
                />
                {/* Row 2: + | chip badge | spacer | mic | send */}
                <div className="flex items-center gap-1 px-1 pb-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 w-8 rounded-xl">
                        <Plus className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" className="bg-card border-border w-56 mb-1">
                      <DropdownMenuItem
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-3 text-foreground cursor-pointer"
                        disabled={attachedFiles.length >= 5 || !isOnline}
                      >
                        <Paperclip className={`w-4 h-4 text-primary ${attachedFiles.some((f) => f.status === "uploading") ? "animate-pulse" : ""}`} />
                        {!isOnline ? "Upload requires internet" : "Add photos & files"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-border/50 my-1" />
                      {TOOLS.map((tool) => {
                        const Icon = tool.icon;
                        return (
                          <DropdownMenuItem key={tool.label} onClick={() => handleToolClick(tool)} className="gap-3 text-foreground cursor-pointer">
                            <Icon className="w-4 h-4 text-primary" />
                            {tool.label}
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuSeparator className="bg-border/50 my-1" />
                      <DropdownMenuItem
                        onSelect={(e) => e.preventDefault()}
                        className="cursor-default"
                      >
                        <div className="w-full flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-foreground">
                            <GraduationCap className="w-4 h-4 text-primary" />
                            <span className="text-sm">Curriculum context</span>
                          </div>
                          <Switch
                            checked={curriculumContextActive}
                            disabled={!curriculumReady}
                            onCheckedChange={(checked) => updateCurriculumToggle(Boolean(checked))}
                            onClick={(e) => e.stopPropagation()}
                            className="data-[state=checked]:bg-primary"
                          />
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {/* Chip badge inline */}
                  <div className="flex items-center gap-1.5 bg-primary/15 border border-primary/30 rounded-lg px-2.5 py-1 text-xs text-primary font-medium">
                    <span>{INTENT_LABELS[intentChip] ?? intentChip}</span>
                    <button onClick={() => setIntentChip(null)} className="text-primary/60 hover:text-primary" aria-label="Remove intent">✕</button>
                  </div>
                  <div className="flex-1" />
                  {/* Model selector — sits between the spacer and the mic */}
                  <ModelSelector
                    value={modelProvider}
                    onChange={setModelProvider}
                    disabled={!isOnline}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleListening}
                    className={`h-8 w-8 rounded-xl transition-all duration-200 ${isListening ? "bg-red-500 text-white hover:bg-red-600 scale-110" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                    title={isListening ? "Stop listening" : "Start voice input"}
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={sendMessage}
                    disabled={(!input.trim() && !attachedFiles.some((f) => f.status === "ready")) || isTyping || attachedFiles.some((f) => f.status === "uploading") || !isOnline}
                    size="icon"
                    className="h-8 w-8 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-30 shrink-0"
                    title={!isOnline ? "Chat requires internet" : undefined}
                  >
                    {!isOnline ? <WifiOff className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </>
            ) : (
              /* ── SINGLE-ROW layout when no chip (default) ── */
              <div className="flex items-end">
                <div className="flex items-end pb-1 shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 h-9 w-9 rounded-xl"
                      >
                        <Plus className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      className="bg-card border-border w-56 mb-1"
                    >
                      <DropdownMenuItem
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-3 text-foreground cursor-pointer"
                        disabled={attachedFiles.length >= 5 || !isOnline}
                      >
                        <Paperclip
                          className={`w-4 h-4 text-primary ${
                            attachedFiles.some((f) => f.status === "uploading")
                              ? "animate-pulse"
                              : ""
                          }`}
                        />
                        {!isOnline ? "Upload requires internet" : "Add photos & files"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-border/50 my-1" />
                      {TOOLS.map((tool) => {
                        const Icon = tool.icon;
                        return (
                          <DropdownMenuItem
                            key={tool.label}
                            onClick={() => handleToolClick(tool)}
                            className="gap-3 text-foreground cursor-pointer"
                          >
                            <Icon className="w-4 h-4 text-primary" />
                            {tool.label}
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuSeparator className="bg-border/50 my-1" />
                      <DropdownMenuItem
                        onSelect={(e) => e.preventDefault()}
                        className="cursor-default"
                      >
                        <div className="w-full flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-foreground">
                            <GraduationCap className="w-4 h-4 text-primary" />
                            <span className="text-sm">Curriculum context</span>
                          </div>
                          <Switch
                            checked={curriculumContextActive}
                            disabled={!curriculumReady}
                            onCheckedChange={(checked) => updateCurriculumToggle(Boolean(checked))}
                            onClick={(e) => e.stopPropagation()}
                            className="data-[state=checked]:bg-primary"
                          />
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!isOnline) return;
                      if (!input.trim() && !attachedFiles.some((f) => f.status === "ready")) return;
                      sendMessage();
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder="Ask anything..."
                  rows={1}
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm px-3 py-2.5 resize-none outline-none min-h-[40px] overflow-hidden"
                />

                <div className="flex items-end gap-1 pr-1 pb-1 shrink-0">
                  {/* Model selector — sits between the textarea and the mic */}
                  <ModelSelector
                    value={modelProvider}
                    onChange={setModelProvider}
                    disabled={!isOnline}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleListening}
                    className={`h-9 w-9 rounded-xl transition-all duration-200 ${
                      isListening
                        ? "bg-red-500 text-white hover:bg-red-600 scale-110"
                        : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                    }`}
                    title={isListening ? "Stop listening" : "Start voice input"}
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={sendMessage}
                    disabled={
                      (!input.trim() &&
                        !attachedFiles.some((f) => f.status === "ready")) ||
                      isTyping ||
                      attachedFiles.some((f) => f.status === "uploading") ||
                      !isOnline
                    }
                    size="icon"
                    className="h-9 w-9 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-30 shrink-0"
                    title={!isOnline ? "Chat requires internet" : undefined}
                  >
                    {!isOnline ? <WifiOff className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
