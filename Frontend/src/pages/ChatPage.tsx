import { useState, useRef, useEffect } from "react";
import LoadingDots from "../components/LoadingDots";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import mermaid from "mermaid";
import {
  Send, Paperclip, Mic, Plus, Volume2, Globe, Copy, RefreshCw,
  FileText, CalendarDays, GitBranch, Network, Brain, Bot,
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, Code,
  ImageIcon, Download, Square, Sparkles,
  Save,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

// ── Mermaid init ──────────────────────────────────────────────────────────────
mermaid.initialize({
  startOnLoad: false, theme: "dark",
  themeVariables: { darkMode: true, background: "#1a1a2e", primaryColor: "#6366f1", primaryTextColor: "#e2e8f0", lineColor: "#6366f1", edgeLabelBackground: "#1e1e3f" },
  flowchart: { curve: "basis", htmlLabels: true },
  mindmap: { padding: 16 },
});

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
  score?: number;
  correct_count?: number;
  total_questions?: number;
  weak_areas?: string[];
  results?: QuizResult[];
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
}

interface ImageData {
  diagram_id: string;
  type: "image";
  topic: string;
  image_url: string;
  created_at: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "quiz" | "diagram" | "study_plan" | "image";
  content: string;
  quizData?: QuizData;
  diagramData?: DiagramData;
  studyPlanData?: StudyPlanData;
  imageData?: ImageData;
  timestamp: Date;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:8000";
const USER_ID  = "student-001";

const TOOLS = [
  { label: "Generate Quiz",      icon: FileText    },
  { label: "Create Study Plan",  icon: CalendarDays },
  { label: "Generate Diagram",   icon: GitBranch   },
  { label: "Generate Flowchart", icon: Network     },
  { label: "Generate Mindmap",   icon: Brain       },
];

const INITIAL_MESSAGES: Message[] = [{
  id: "1", role: "assistant",
  content: "Hey there! 👋 I'm your Study Buddy. I can help you understand complex topics, generate quizzes, create flashcards, build study plans, and much more. Just type your question or use the ➕ tools menu to get started!",
  timestamp: new Date(),
}];

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16);
  });
}

function detectQuizIntent(message: string): { isQuiz: boolean; topic: string; numQuestions: number } {
  const isNonCreation =
    /^(what is|what are|what was|what were|how do|how to|how can|how would|how does|explain|tell me about|describe|define|can you explain|could you explain)/i.test(message) ||
    /\b(my quiz|the quiz|failed (my|the|a) quiz|passed (my|the|a) quiz|have a quiz|has a quiz|for my quiz|before my quiz|after my quiz|study for|prepare for my quiz|quiz tomorrow|quiz today|quiz (on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|quiz (next|this|last) (week|month|day))\b/i.test(message);
  if (isNonCreation) return { isQuiz: false, topic: "", numQuestions: 5 };

  const hasQuizSignal  = /\bquiz(zes)?\b/i.test(message) || /\b\d+\s*(questions?|qns?|qs?)\b/i.test(message);
  const hasCreationVerb = /\b(make|create|give|generate|build|need|want|get|prepare|design|write|produce|quiz me|test me)\b/i.test(message);
  if (!hasQuizSignal || !hasCreationVerb) return { isQuiz: false, topic: "", numQuestions: 5 };

  const qtyMatch = message.match(/\b(\d+)\s*(?:qns?|questions?|qs?)\b/i) || message.match(/\b(\d+)\s+(?:question|qn)\b/i);
  const numQuestions = qtyMatch ? Math.min(Math.max(parseInt(qtyMatch[1]), 1), 20) : 5;
  const cleanTopic = message
    .replace(/\b(\d+)\s*(?:qns?|questions?|qs?)\b/gi, "").replace(/\b(generate|make|create|give|get|need|want|build|prepare|design|write|produce|test)\b/gi, "")
    .replace(/\b(quiz|quizzes|question|questions|me|us|my|a|an|the)\b/gi, "").replace(/\b(about|on|for|regarding|related to|covering|of)\b/gi, "")
    .replace(/\b(i|can|you|could|please|would|like)\b/gi, "").replace(/[?!.,]/g, "").replace(/\s+/g, " ").trim();
  const finalTopic = cleanTopic.replace(/^[:\s]+/, "").trim();
  return { isQuiz: true, topic: finalTopic, numQuestions };
}

function downloadPNG(svgContent: string, filename: string) {
  const b64 = btoa(unescape(encodeURIComponent(svgContent))); const dataUrl = `data:image/svg+xml;base64,${b64}`;
  const img = new Image();
  img.onload = () => {
    const scale = 2; const w = img.naturalWidth || 1200; const h = img.naturalHeight || 800;
    const canvas = document.createElement("canvas"); canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext("2d")!; ctx.scale(scale, scale); ctx.fillStyle = "#1a1a2e"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = `${filename.replace(/\s+/g, "_")}.png`; a.click();
  };
  img.src = dataUrl;
}

const LANG_TO_BCP47: Record<string, string> = { en: "en-US", hi: "hi-IN", mr: "mr-IN", ta: "ta-IN", te: "te-IN", bn: "bn-IN", gu: "gu-IN", kn: "kn-IN" };

function applyInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part))     return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part))       return <code key={i} className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono text-primary">{part.slice(1, -1)}</code>;
    return part;
  });
}

function renderMarkdown(text: string) {
  const lines = text.split("\n"); const elements: React.ReactNode[] = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const h3 = line.match(/^###\s+(.+)/); const h2 = line.match(/^##\s+(.+)/); const h1 = line.match(/^#\s+(.+)/);
    if (h3) { elements.push(<h3 key={`h3-${i}`} className="text-sm font-bold text-foreground mt-3 mb-1">{applyInline(h3[1])}</h3>); i++; continue; }
    if (h2) { elements.push(<h2 key={`h2-${i}`} className="text-base font-bold text-foreground mt-3 mb-1">{applyInline(h2[1])}</h2>); i++; continue; }
    if (h1) { elements.push(<h1 key={`h1-${i}`} className="text-lg font-bold text-foreground mt-3 mb-1">{applyInline(h1[1])}</h1>); i++; continue; }
    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = []; const startNum = parseInt(lines[i].match(/^\s*(\d+)\./)?.[1] ?? "1", 10);
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s/, ""));
      elements.push(<ol key={`ol-${i}`} start={startNum} className="list-decimal list-inside space-y-1 my-2 ml-2">{items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}</ol>); continue;
    }
    if (/^\s*[\*\-]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[\*\-]\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*[\*\-]\s/, ""));
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-1 my-2 ml-2">{items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}</ul>); continue;
    }
    elements.push(<p key={`p-${i}`} className="text-sm leading-relaxed my-1">{applyInline(line)}</p>); i++;
  }
  return elements;
}

// ── QuizResults ───────────────────────────────────────────────────────────────
const QuizResults = ({ quizData }: { quizData: QuizData }) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const score = quizData.score ?? 0;
  const scoreColor = score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : "text-red-400";
  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <p className={`text-4xl font-bold ${scoreColor}`}>{score}%</p>
        <p className="text-sm text-muted-foreground mt-1">{quizData.correct_count} / {quizData.total_questions} correct</p>
      </div>
      {quizData.weak_areas && quizData.weak_areas.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-yellow-400">⚠️ Weak Areas Identified</p>
          <div className="flex flex-wrap gap-2">{quizData.weak_areas.map((area, i) => <Badge key={i} variant="outline" className="border-yellow-500/30 text-yellow-400 bg-yellow-500/10 text-xs">{area}</Badge>)}</div>
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={() => setShowBreakdown((v) => !v)} className="w-full text-xs text-muted-foreground hover:text-primary">
        {showBreakdown ? "Hide" : "Show"} question breakdown
      </Button>
      {showBreakdown && quizData.results && (
        <div className="space-y-3">
          {quizData.results.map((r, i) => (
            <div key={i} className="bg-secondary/40 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                {r.correct ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                <p className="text-xs font-medium text-foreground">{r.question}</p>
              </div>
              <div className="space-y-1 ml-6">
                {r.options.map((opt, oi) => (
                  <div key={oi} className={`text-xs px-3 py-1.5 rounded-lg border ${oi === r.correct_index ? "border-green-500/40 bg-green-500/10 text-green-400" : oi === r.selected_index && !r.correct ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-border text-muted-foreground"}`}>{opt}</div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground ml-6 bg-secondary/50 p-2 rounded-lg">💡 {r.explanation}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── QuizCard ──────────────────────────────────────────────────────────────────
const QuizCard = ({ messageId, quizData, onQuizComplete }: { messageId: string; quizData: QuizData; onQuizComplete: (id: string, data: QuizData) => void }) => {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(Array(quizData.questions.length).fill(null));
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (quizData.submitted) return <div className="space-y-3"><p className="text-sm font-semibold text-foreground">📊 {quizData.topic} — Results</p><QuizResults quizData={quizData} /></div>;

  const question = quizData.questions[currentQ]; const total = quizData.questions.length;
  const allAnswered = answers.every((a) => a !== null); const answeredCount = answers.filter((a) => a !== null).length;

  const handleSubmit = async () => {
    if (!allAnswered) return; setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/quiz/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: USER_ID, quiz_id: quizData.quiz_id, answers }) });
      if (!response.ok) { const err = await response.json(); throw new Error(err.detail || "Submission failed"); }
      const result = await response.json();
      onQuizComplete(messageId, { ...quizData, submitted: true, score: result.score, correct_count: result.correct_count, total_questions: result.total_questions, weak_areas: result.weak_areas, results: result.results });
    } catch (err: any) { toast.error(`Failed to submit quiz: ${err.message}`); } finally { setIsSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold text-foreground">📝 {quizData.topic}</p><span className="text-xs text-muted-foreground">{currentQ + 1} / {total}</span></div>
      <div className="w-full bg-secondary rounded-full h-1.5"><div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${(answeredCount / total) * 100}%` }} /></div>
      <p className="text-sm font-medium text-foreground">{question.question}</p>
      <div className="space-y-2">
        {question.options.map((opt, i) => (
          <button key={i} onClick={() => setAnswers((prev) => { const u = [...prev]; u[currentQ] = i; return u; })}
            className={`w-full text-left text-sm px-4 py-2.5 rounded-xl border transition-all duration-150 ${answers[currentQ] === i ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5"}`}>{opt}</button>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentQ((q) => q - 1)}
          disabled={currentQ === 0}
          className="gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </Button>

        {currentQ < total - 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentQ((q) => q + 1)}
            className="gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!allAnswered || isSubmitting}
            className="text-xs bg-primary hover:bg-primary/90 disabled:opacity-40"
          >
            {isSubmitting ? "Submitting..." : "Submit Quiz"}
          </Button>
        )}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        {answeredCount} of {total} answered
      </p>
    </div>
  );
};

// ── StudyPlanCard Component ────────────────────────────────────────────────

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

      {!showCode && (
        <div className="rounded-xl bg-secondary/60 border border-border p-4 overflow-x-auto min-h-[120px] flex items-center justify-center">
          {svg ? <div className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          : renderError ? <div className="text-center space-y-2"><p className="text-sm text-destructive">Failed to render diagram.</p><p className="text-xs text-muted-foreground">Click "View code" to see the raw Mermaid syntax.</p></div>
          : <LoadingDots size={65} />
          }
          </div>
      )}
      {showCode && <div className="rounded-xl bg-secondary/80 border border-border p-4 overflow-x-auto"><pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{diagramData.mermaid_code}</pre></div>}
      <p className="text-xs text-muted-foreground">Saved to your <span className="text-primary">Images</span> library ✓</p>
    </div>
  );
};

// ── ImageCard ─────────────────────────────────────────────────────────────────
const ImageCard = ({ imageData }: { imageData: ImageData }) => {
  const [loaded, setLoaded] = useState(false); const [error, setError] = useState(false);
  const handleDownload = () => { const a = document.createElement("a"); a.href = imageData.image_url; a.download = `${imageData.topic.replace(/\s+/g, "_")}.png`; a.target = "_blank"; a.click(); };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /><span className="text-sm font-semibold text-foreground">{imageData.topic}</span><span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">AI Image</span></div>
        {loaded && <Button variant="ghost" size="sm" onClick={handleDownload} className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1.5"><Download className="w-3.5 h-3.5" />Download</Button>}
      </div>
      <div className="rounded-xl overflow-hidden bg-secondary/50 min-h-[200px] flex items-center justify-center">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-xs text-destructive">Failed to load image.</p>
          </div>
        ) : (
          <>
            {!loaded && <LoadingDots size={65} />}
            <img
              src={imageData.image_url}
              alt={imageData.topic}
              className={`w-full rounded-xl object-contain transition-opacity duration-300 ${
                loaded ? "opacity-100" : "opacity-0 absolute"
              }`}
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
            />
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground text-right">Saved to your Images library ✓</p>
    </div>
  );
};

// ── StudyPlanCard Component ────────────────────────────────────────────────

const StudyPlanCard = ({
  studyPlanData,
  conversationId,
}: {
  studyPlanData: StudyPlanData;
  conversationId: string | null;
}) => {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([1]));
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
          user_id: USER_ID,
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
                <span className="text-xs font-semibold text-foreground">Week {week.week_number}</span>
                <span className="text-xs text-muted-foreground">
                  {week.start_date} – {week.end_date}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {week.estimate_hours && (
                  <span className="text-xs text-muted-foreground">{week.estimate_hours}h</span>
                )}
                {expandedWeeks.has(week.week_number)
                  ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
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

// ── Study plan input parser (LLM-backed) ────────────────────────────────

async function parseStudyPlanInput(rawInput: string): Promise<{
  topic: string | null;
  weeks: number | null;
  hoursPerWeek: number | null;
}> {
  try {
    const resp = await fetch(`${API_BASE}/study_plans/parse_intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_input: rawInput }),
    });
    if (!resp.ok) throw new Error("Parse failed");
    const data = await resp.json();
    return {
      topic: data.topic || null,
      weeks: data.timeline_weeks || null,
      hoursPerWeek: data.hours_per_week || null,
    };
  } catch (err) {
    console.error("LLM parsing failed, falling back to regex:", err);
    // Fallback: simple regex
    const weeksMatch = rawInput.match(/(\d+)\s*(?:weeks?)?/i);
    const weeks = weeksMatch ? parseInt(weeksMatch[1]) : null;
    const cleaned = rawInput.replace(/\d+\s*(?:weeks?|months?)?\s*/gi, "").trim();
    return {
      topic: cleaned || null,
      weeks,
      hoursPerWeek: null,
    };
  }
}

// ── Main Component ────────────────────────────────────────────────────────────
const ChatPage = () => {
  const { language } = useLanguage();
  const [messages,          setMessages]          = useState<Message[]>(INITIAL_MESSAGES);
  const [input,             setInput]             = useState("");
  const [isTyping,          setIsTyping]          = useState(false);
  const [isUploading,       setIsUploading]       = useState(false);
  const [conversationId,    setConversationId]    = useState<string | null>(null);
  const [pendingStudyPlan, setPendingStudyPlan] = useState<{
    topic?: string;
    weeks?: number;
    hoursPerWeek?: number;
  } | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // TTS / audio state
  const [speakingMsgId,     setSpeakingMsgId]     = useState<string | null>(null);
  const [loadingAudioMsgId, setLoadingAudioMsgId] = useState<string | null>(null);
  const [isListening,       setIsListening]       = useState(false);

  // Regenerate state — tracks which assistant bubble is being regenerated
  const [regeneratingMsgId, setRegeneratingMsgId] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const baseTextRef    = useRef<string>("");
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const abortRef       = useRef<AbortController | null>(null);
  const scrollRef      = useRef<HTMLDivElement>(null);
  const bottomRef      = useRef<HTMLDivElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const skipHistoryReload = useRef(false);
  const lastLoadedId = useRef<string | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Prefill input from navigation state (e.g. "Take a Quiz" from Dashboard)
  useEffect(() => {
    const state = location.state as { prefillInput?: string } | null;
    if (state?.prefillInput) {
      setInput(state.prefillInput);
      window.history.replaceState({}, document.title);
    }
  }, []);

  // Load conversation from URL param
  useEffect(() => {
    const urlConversationId = searchParams.get("conversationId");

    // No conversationId in URL → new chat, reset everything
    if (!urlConversationId) {
      setMessages(INITIAL_MESSAGES);
      setConversationId(null);
      setInput("");
      lastLoadedId.current = null;
      return;
    }

    // We navigated here ourselves during streaming — skip reload to avoid
    // overwriting the live streamed response
    if (skipHistoryReload.current) {
      skipHistoryReload.current = false;
      return;
    }

    // Same conversation already loaded — don't re-fetch
    if (lastLoadedId.current === urlConversationId) return;

    setConversationId(urlConversationId);
    setIsLoadingHistory(true);
    setMessages([]);

    const loadHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/chat/history/${urlConversationId}`);
        if (!res.ok) return;
        const data = await res.json();

        const loadedMessages: Message[] = data.messages.map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: new Date(m.timestamp),
        }));

        if (loadedMessages.length > 0) {
          setMessages([INITIAL_MESSAGES[0], ...loadedMessages]);
        }
      } catch {
        toast.error("Could not load conversation history.");
      } finally {
        setIsLoadingHistory(false);
        lastLoadedId.current = urlConversationId;
      }
    };

    loadHistory();
  }, [searchParams]);

  // ── Generate Study Plan ────────────────────────────────────────────────

  const generateStudyPlan = async (
    topic: string,
    weeks: number = 4,
    hoursPerWeek: number = 8,
    skipUserMsg: boolean = false
  ) => {
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      activeConversationId = generateUUID();
      setConversationId(activeConversationId);
    }

    if (!skipUserMsg) {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: "user",
        content: topic
          ? `Create Study Plan for: ${topic} (${weeks} weeks, ${hoursPerWeek}h/week)`
          : "Create Study Plan from uploaded material",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
    }
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE}/study_plans/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: activeConversationId,
          topic: topic || null,
          timeline_weeks: weeks,
          preferences: { hours_per_week: hoursPerWeek, focus_days: null },
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Study plan generation failed");
      }

      const data: StudyPlanData = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "study_plan" as const,
          content: "",
          studyPlanData: data,
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      toast.error(`Could not generate study plan: ${err.message}`);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Sorry, I couldn't generate the study plan. ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  const [pendingDiagramType,  setPendingDiagramType]  = useState<"flowchart" | "diagram" | null>(null);
  const [pendingImageRequest, setPendingImageRequest] = useState(false);
  const [translatingMsgId,    setTranslatingMsgId]    = useState<string | null>(null);
  const [translatedContent,   setTranslatedContent]   = useState<Record<string, string>>({});
  const [translatedLang,      setTranslatedLang]      = useState<Record<string, string>>({});
  const [showTranslatePicker, setShowTranslatePicker] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`; }
  };

  // ── Effects ───────────────────────────────────────────────────────────────────
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping]);

  // Stop audio when leaving the page
  useEffect(() => { return () => { abortRef.current?.abort(); audioRef.current?.pause(); }; }, []);

  // Stop audio when switching browser tab
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stopSpeech(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Stop audio when new messages arrive
  useEffect(() => { stopSpeech(); }, [messages.length]);

  // ── stopSpeech helper ─────────────────────────────────────────────────────────
  const stopSpeech = () => {
    abortRef.current?.abort(); abortRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeakingMsgId(null); setLoadingAudioMsgId(null);
  };

// ── Azure Neural TTS ──────────────────────────────────────────────────────────
  const speakText = async (msgId: string, text: string, langOverride?: string) => {
    if (speakingMsgId === msgId || loadingAudioMsgId === msgId) { stopSpeech(); return; }
    stopSpeech();
    const cleanText = text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/`(.*?)`/g, "$1").replace(/#{1,6}\s/g, "").replace(/[-*]\s/g, "").trim();
    if (!cleanText) return;
    const targetLang = langOverride ?? language;
    setLoadingAudioMsgId(msgId);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch(`${API_BASE}/chat/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: cleanText, language: targetLang }), signal: controller.signal });
      if (!response.ok) { const err = await response.json().catch(() => ({ detail: "TTS failed" })); throw new Error(err.detail ?? "TTS request failed"); }
      const blob = await response.blob(); const objectURL = URL.createObjectURL(blob); const audio = new Audio(objectURL);
      audioRef.current = audio;
      audio.onplay  = () => { setLoadingAudioMsgId(null); setSpeakingMsgId(msgId); };
      audio.onended = () => { URL.revokeObjectURL(objectURL); audioRef.current = null; abortRef.current = null; setSpeakingMsgId(null); setLoadingAudioMsgId(null); };
      audio.onerror = () => { URL.revokeObjectURL(objectURL); audioRef.current = null; abortRef.current = null; setSpeakingMsgId(null); setLoadingAudioMsgId(null); toast.error("Audio playback failed."); };
      await audio.play();
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setSpeakingMsgId(null); setLoadingAudioMsgId(null); audioRef.current = null; abortRef.current = null;
      toast.error(`Text-to-speech failed: ${err.message}`);
    }
  };

  // ── STT ───────────────────────────────────────────────────────────────────────
  const toggleListening = () => {
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) { toast.error("Your browser doesn't support speech input. Try Chrome or Edge."); return; }
    const recognition: any = new SpeechRecognitionAPI();
    recognition.lang = LANG_TO_BCP47[language] ?? "en-US"; recognition.continuous = true; recognition.interimResults = true;
    baseTextRef.current = input;
    recognition.onstart  = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      let interim = ""; let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) { const r = event.results[i]; if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; }
      if (final) baseTextRef.current = (baseTextRef.current + " " + final).trim();
      setInput((baseTextRef.current + " " + interim).trim());
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      const msgs: Record<string, string> = { "language-not-supported": "Speech input not supported for this language. Try English.", "not-allowed": "Microphone access denied.", "no-speech": "No speech detected.", "network": "Network error during speech recognition." };
      toast.error(msgs[event.error] ?? "Speech recognition error. Try typing instead.");
    };
    recognition.onend = () => { setIsListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition; recognition.start();
  };

  // ── Translation ───────────────────────────────────────────────────────────────
  const translateMessage = async (msgId: string, text: string, targetLang: string) => {
    stopSpeech(); setShowTranslatePicker(null); setTranslatingMsgId(msgId);
    try {
      const response = await fetch(`${API_BASE}/chat/translate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, target_language: targetLang }) });
      if (!response.ok) { const err = await response.json(); throw new Error(err.detail || "Translation failed"); }
      const data = await response.json();
      setTranslatedContent((prev) => ({ ...prev, [msgId]: data.translated_text }));
      setTranslatedLang((prev)     => ({ ...prev, [msgId]: targetLang }));
    } catch (err: any) { toast.error(`Translation failed: ${err.message}`); }
    finally { setTranslatingMsgId(null); }
  };

  // ── Quiz helpers ──────────────────────────────────────────────────────────────
  const handleQuizComplete = (messageId: string, updatedQuizData: QuizData) => {
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, quizData: updatedQuizData } : m));
  };

  const generateQuiz = async (topic: string, numQuestions: number = 5) => {
    if (!topic && !conversationId) { toast.error("Please provide a topic, e.g. 'make a quiz about cricket'"); return; }
    let cid = conversationId; if (!cid) { cid = generateUUID(); setConversationId(cid); }
    const quizUserMsgId = generateUUID();
    const quizMsgId     = generateUUID();
    setMessages((prev) => [...prev, { id: quizUserMsgId, role: "user", content: topic ? `Generate Quiz for: ${topic}${numQuestions !== 5 ? ` (${numQuestions} questions)` : ""}` : "Generate Quiz from uploaded document", timestamp: new Date() }]);
    setIsTyping(true);
    try {
      const r = await fetch(`${API_BASE}/quiz/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: USER_ID, conversation_id: cid, topic: topic || null, num_questions: numQuestions }) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.detail || "Quiz generation failed"); }
      const data = await r.json();
      setMessages((prev) => [...prev, { id: quizMsgId, role: "quiz", content: "", quizData: { quiz_id: data.quiz_id, topic: data.topic, questions: data.questions, submitted: false }, timestamp: new Date() }]);
    } catch (err: any) { setMessages((prev) => [...prev, { id: generateUUID(), role: "assistant", content: `❌ Could not generate quiz: ${err.message}`, timestamp: new Date() }]); }
    finally { setIsTyping(false); }
  };

  const generateDiagram = async (topic: string, diagramType: "flowchart" | "diagram") => {
    if (!topic.trim()) { toast.error("Please specify a topic for the diagram."); return; }
    const diagUserMsgId = generateUUID();
    const diagMsgId     = generateUUID();
    setMessages((prev) => [...prev, { id: diagUserMsgId, role: "user", content: diagramType === "flowchart" ? `Generate Flowchart for: ${topic.trim()}` : `Generate Mindmap for: ${topic.trim()}`, timestamp: new Date() }]);
    setInput(""); setIsTyping(true);
    try {
      const r = await fetch(`${API_BASE}/diagrams/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: USER_ID, conversation_id: conversationId, topic: topic.trim(), diagram_type: diagramType }) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.detail || "Diagram generation failed"); }
      const data: DiagramData = await r.json();
      setMessages((prev) => [...prev, { id: diagMsgId, role: "diagram", content: "", diagramData: data, timestamp: new Date() }]);
    } catch (err: any) { toast.error(`Could not generate diagram: ${err.message}`); setMessages((prev) => [...prev, { id: generateUUID(), role: "assistant", content: `Sorry, I couldn't generate the diagram. ${err.message}`, timestamp: new Date() }]); }
    finally { setIsTyping(false); }
  };

  const inferTopicFromConversation = async (): Promise<string | null> => {
    const recent = messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 300) }));
    if (recent.length === 0) return null;
    try {
      const r = await fetch(`${API_BASE}/chat/infer-topic`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: recent }) });
      if (!r.ok) return null; const data = await r.json(); return data.topic || null;
    } catch { return null; }
  };

  const handleDiagramRequest = async (rawTopic: string, diagramType: "flowchart" | "diagram", userMessage: string) => {
    const topic = rawTopic.trim();
    if (topic) { await generateDiagram(topic, diagramType); return; }
    const real = messages.filter((m) => (m.role === "user" || m.role === "assistant") && m.id !== "1");
    if (real.length === 0) {
      const tl = diagramType === "flowchart" ? "flowchart" : "mind map diagram";
      setMessages((prev) => [...prev, { id: generateUUID(), role: "user", content: userMessage, timestamp: new Date() }, { id: generateUUID(), role: "assistant", content: `Sure! What topic would you like me to create a ${tl} for? Just type the topic and I'll generate it right away. 🎨`, timestamp: new Date() }]);
      setInput(""); setPendingDiagramType(diagramType); return;
    }
    setMessages((prev) => [...prev, { id: generateUUID(), role: "user", content: userMessage, timestamp: new Date() }]);
    setInput(""); setIsTyping(true);
    const inferred = await inferTopicFromConversation(); setIsTyping(false);
    if (!inferred || inferred === "General Topic") {
      const tl = diagramType === "flowchart" ? "flowchart" : "mind map diagram";
      setMessages((prev) => [...prev, { id: generateUUID(), role: "assistant", content: `I wasn't sure which topic to use. What would you like me to create a ${tl} for? Just type the topic! 🎨`, timestamp: new Date() }]);
      setPendingDiagramType(diagramType); return;
    }
    await generateDiagram(inferred, diagramType);
  };

  const generateImage = async (topic: string) => {
    if (!topic.trim()) { toast.error("Please specify a topic for the image."); return; }
    const imgUserMsgId = generateUUID();
    const imgMsgId     = generateUUID();
    setMessages((prev) => [...prev, { id: imgUserMsgId, role: "user", content: `Generate Diagram for: ${topic.trim()}`, timestamp: new Date() }]);
    setInput(""); setIsTyping(true);
    try {
      const r = await fetch(`${API_BASE}/diagrams/generate-image`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: USER_ID, conversation_id: conversationId, topic: topic.trim() }) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.detail || "Image generation failed"); }
      const data: ImageData = await r.json();
      setMessages((prev) => [...prev, { id: imgMsgId, role: "image", content: "", imageData: data, timestamp: new Date() }]);
    } catch (err: any) { toast.error(`Could not generate image: ${err.message}`); setMessages((prev) => [...prev, { id: generateUUID(), role: "assistant", content: `Sorry, I couldn't generate the image. ${err.message}`, timestamp: new Date() }]); }
    finally { setIsTyping(false); }
  };

  const handleImageRequest = async (rawTopic: string) => {
    const topic = rawTopic.trim();
    if (topic) { await generateImage(topic); return; }
    const real = messages.filter((m) => (m.role === "user" || m.role === "assistant") && m.id !== "1");
    if (real.length === 0) { setMessages((prev) => [...prev, { id: generateUUID(), role: "assistant", content: `Sure! What topic would you like me to generate an AI diagram image for? Just type the topic. 🎨`, timestamp: new Date() }]); setPendingImageRequest(true); return; }
    setIsTyping(true); const inferred = await inferTopicFromConversation(); setIsTyping(false);
    if (!inferred || inferred === "General Topic") { setMessages((prev) => [...prev, { id: generateUUID(), role: "assistant", content: `I wasn't sure which topic to pick. What would you like me to generate an image for? 🎨`, timestamp: new Date() }]); setPendingImageRequest(true); return; }
    await generateImage(inferred);
  };

  // ── Shared SSE stream helper ───────────────────────────────────────────────────
  // Streams a fresh AI response into an existing message bubble (used by regenerate).
  const streamIntoMessage = async (userText: string, targetMsgId: string) => {
    const response = await fetch(`${API_BASE}/chat/message`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, conversation_id: conversationId, message: userText }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let firstChunk = true;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      const lines = decoder.decode(value, { stream: true }).split("\n\n").filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim(); if (dataStr === "[DONE]") { setIsTyping(false); break; }
        let parsed: { type: string; content?: string; conversation_id?: string };
        try { parsed = JSON.parse(dataStr); } catch { continue; }
        if (parsed.type === "meta" && parsed.conversation_id) setConversationId(parsed.conversation_id);
        if (parsed.type === "text" && parsed.content) {
          setMessages((prev) => prev.map((m) => m.id === targetMsgId ? { ...m, content: firstChunk ? parsed.content! : m.content + parsed.content } : m));
          firstChunk = false;
        }
        if (parsed.type === "error") { toast.error(`AI error: ${parsed.content}`); setIsTyping(false); break; }
      }
    }
  };

  // ── Regenerate ────────────────────────────────────────────────────────────────
  // Finds the user message just before this assistant bubble, wipes the bubble,
  // and re-streams a brand-new response into it.
  const regenerateMessage = async (assistantMsgId: string) => {
    stopSpeech();
    const idx = messages.findIndex((m) => m.id === assistantMsgId);
    if (idx === -1) return;

    // Walk backwards to find the closest user message before this one
    const precedingUser = [...messages].slice(0, idx).reverse().find((m) => m.role === "user");
    if (!precedingUser) { toast.error("Could not find the original question to regenerate."); return; }
    if (!conversationId) { toast.error("No active conversation."); return; }

    // Clear translation and empty the bubble content
    setTranslatedContent((prev) => { const n = { ...prev }; delete n[assistantMsgId]; return n; });
    setTranslatedLang((prev)     => { const n = { ...prev }; delete n[assistantMsgId]; return n; });
    setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: "" } : m));

    setRegeneratingMsgId(assistantMsgId);
    setIsTyping(true);
    try {
      await streamIntoMessage(precedingUser.content, assistantMsgId);
    } catch { toast.error("Could not reach the server. Is the backend running?"); }
    finally { setRegeneratingMsgId(null); setIsTyping(false); }
  };

  // ── sendMessage ───────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || isTyping) return;
    const userMessage = input.trim(); setInput("");

    // ── Handle pending study plan clarification ──────────────────────────
    if (pendingStudyPlan) {
      const pending = { ...pendingStudyPlan };

      // Show user reply
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "user" as const, content: userMessage, timestamp: new Date() },
      ]);

      // Parse the reply for missing info via LLM
      const parsed = await parseStudyPlanInput(userMessage);

      if (!pending.topic && parsed.topic) pending.topic = parsed.topic;
      if (!pending.weeks && parsed.weeks) pending.weeks = parsed.weeks;
      if (!pending.hoursPerWeek && parsed.hoursPerWeek) pending.hoursPerWeek = parsed.hoursPerWeek;

      // If still missing topic, use the whole reply as topic
      if (!pending.topic) pending.topic = userMessage.trim();

      // If we still don't have weeks, ask again
      if (!pending.weeks) {
        setPendingStudyPlan(pending);
        setMessages((prev) => [
          ...prev,
          { id: (Date.now() + 1).toString(), role: "assistant" as const, content: "How many weeks should this study plan cover? (e.g. \"6 weeks\")", timestamp: new Date() },
        ]);
        return;
      }

      // Complete! Generate the plan
      setPendingStudyPlan(null);
      await generateStudyPlan(pending.topic, pending.weeks, pending.hoursPerWeek || 8, true);
      return;
    }

    if (pendingDiagramType) {
      const dt = pendingDiagramType; setPendingDiagramType(null);
      const clean = userMessage.replace(/^generate (diagram|mindmap|flowchart|quiz)(\s+for)?:?\s*/i, "").trim();
      if (!clean) { setPendingDiagramType(dt); return; } await generateDiagram(clean, dt); return;
    }
    if (pendingImageRequest) {
      setPendingImageRequest(false);
      const clean = userMessage.replace(/^generate (diagram|mindmap|flowchart|quiz)(\s+for)?:?\s*/i, "").trim();
      if (!clean) { setPendingImageRequest(true); return; } await generateImage(clean); return;
    }
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const { isQuiz, topic, numQuestions } = detectQuizIntent(userMessage);
    if (isQuiz) { await generateQuiz(topic, numQuestions); return; }

    // ── Study plan intent (smart parsing) ────────────────────────────────
    if (/^create study plan/i.test(userMessage)) {
      const rawMatch = userMessage.match(/^create study plan(?:\s+for)?:?\s*(.*)/i);
      const rawInput = rawMatch?.[1]?.trim() || "";
      const parsed = await parseStudyPlanInput(rawInput);

      const hasValidTopic = !!parsed.topic && parsed.topic.length > 2 && !/^\d+$/.test(parsed.topic);
      const hasWeeks = parsed.weeks !== null && parsed.weeks > 0;

      if (hasValidTopic && hasWeeks) {
        await generateStudyPlan(parsed.topic, parsed.weeks!, parsed.hoursPerWeek || 8);
        return;
      }

      // Show user message first
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "user" as const, content: userMessage, timestamp: new Date() },
      ]);

      if (hasValidTopic && !hasWeeks) {
        setPendingStudyPlan({ topic: parsed.topic, hoursPerWeek: parsed.hoursPerWeek || undefined });
        setMessages((prev) => [
          ...prev,
          { id: (Date.now() + 1).toString(), role: "assistant" as const, content: `I'll create a study plan for **${parsed.topic}**. How many weeks should this plan cover?`, timestamp: new Date() },
        ]);
        return;
      }

      if (!hasValidTopic && hasWeeks) {
        setPendingStudyPlan({ weeks: parsed.weeks!, hoursPerWeek: parsed.hoursPerWeek || undefined });
        setMessages((prev) => [
          ...prev,
          { id: (Date.now() + 1).toString(), role: "assistant" as const, content: `Got it — ${parsed.weeks} week plan. What topic or subject would you like to study?`, timestamp: new Date() },
        ]);
        return;
      }

      setPendingStudyPlan({});
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "assistant" as const, content: "I'd love to create a study plan! What topic or subject do you want to study, and how many weeks should the plan cover?", timestamp: new Date() },
      ]);
      return;
    }

    if (/^generate diagram/i.test(userMessage)) { const m = userMessage.match(/^generate diagram(?:\s+for)?:?\s*(.*)/i); await handleImageRequest(m?.[1] ?? ""); return; }
    if (/^generate flowchart/i.test(userMessage)) { const m = userMessage.match(/^generate flowchart(?:\s+for)?:?\s*(.*)/i); await handleDiagramRequest(m?.[1] ?? "", "flowchart", userMessage); return; }
    if (/^Generate Mindmap/i.test(userMessage)) { const m = userMessage.match(/^Generate Mindmap(?:\s+for)?:?\s*(.*)/i); await handleDiagramRequest(m?.[1] ?? "", "diagram", userMessage); return; }

    const userMsgId = generateUUID();
    const aiMsgId   = generateUUID();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: userMessage, timestamp: new Date() }]);
    setIsTyping(true);
    let messageAdded = false;
    try {
      const response = await fetch(`${API_BASE}/chat/message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: USER_ID, conversation_id: conversationId, message: userMessage }) });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const reader = response.body!.getReader(); const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        const lines = decoder.decode(value, { stream: true }).split("\n\n").filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim(); if (dataStr === "[DONE]") { setIsTyping(false); break; }
          let parsed: { type: string; content?: string; conversation_id?: string };
          try { parsed = JSON.parse(dataStr); } catch { continue; }
          if (parsed.type === "meta" && parsed.conversation_id) {
            const isNew = !conversationId; setConversationId(parsed.conversation_id);
            skipHistoryReload.current = true;
            navigate(`/chat?conversationId=${parsed.conversation_id}`, { replace: true });
            if (isNew) {
              window.dispatchEvent(new CustomEvent("conversation-created"));
            }
          }
          if (parsed.type === "text" && parsed.content) {
            if (!messageAdded) { setMessages((prev) => [...prev, { id: aiMsgId, role: "assistant", content: parsed.content!, timestamp: new Date() }]); messageAdded = true; }
            else setMessages((prev) => prev.map((m) => m.id === aiMsgId ? { ...m, content: m.content + parsed.content } : m));
          }
          if (parsed.type === "error") { toast.error(`AI error: ${parsed.content}`); setIsTyping(false); break; }
        }
      }
    } catch { toast.error("Could not reach the server. Is the backend running?"); }
    finally { setIsTyping(false); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    let cid = conversationId; if (!cid) { cid = generateUUID(); setConversationId(cid); }
    setIsUploading(true); toast.info(`Uploading "${file.name}"...`);
    const formData = new FormData(); formData.append("file", file); formData.append("user_id", USER_ID); formData.append("conversation_id", cid);
    try {
      const r = await fetch(`${API_BASE}/upload/file`, { method: "POST", body: formData });
      if (!r.ok) { const err = await r.json(); throw new Error(err.detail || "Upload failed"); }
      const data = await r.json(); toast.success(`"${file.name}" uploaded! ${data.chunks_stored} chunks indexed.`);
      setMessages((prev) => [...prev, { id: generateUUID(), role: "assistant", content: `📎 I've processed **${file.name}** (${data.chunks_stored} chunks indexed). You can now ask me questions about it, or generate a flowchart / diagram from it!`, timestamp: new Date() }]);
    } catch (err: any) { toast.error(`Upload failed: ${err.message}`); }
    finally { setIsUploading(false); }
  };

  const handleToolClick = (tool: string) => {
    if (tool === "Generate Quiz")          setInput("Generate Quiz for: ");
    else if (tool === "Create Study Plan") setInput("Create Study Plan for: ");
    else if (tool === "Generate Flowchart") setInput("Generate Flowchart for: ");
    else if (tool === "Generate Diagram")  setInput("Generate Diagram for: ");
    else if (tool === "Generate Mindmap")  setInput("Generate Mindmap for: ");
    else { setInput(`${tool} for: `); toast.info(`Selected: ${tool}. Type your topic and send!`); }
  };

  const handleCopy = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied to clipboard!"); };

  // ── Loading history spinner ───────────────────────────────────────────────
  if (isLoadingHistory) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-8 h-8 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Loading conversation...</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Hidden file input — PDFs and all image types */}
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff" className="hidden" onChange={handleFileChange} />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 pb-2 space-y-4">
        {messages.map((msg) => {

          if (msg.role === "quiz" && msg.quizData) return (
            <div key={msg.id} className="flex justify-start animate-fade-in">
              <div className="w-full max-w-[90%] md:max-w-[75%]">
                <div className="flex items-center gap-2 mb-1.5"><div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-primary" /></div><span className="text-xs text-muted-foreground font-medium">Study Buddy</span></div>
                <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5"><QuizCard messageId={msg.id} quizData={msg.quizData} onQuizComplete={handleQuizComplete} /></div>
              </div>
            </div>
          );

          if (msg.role === "diagram" && msg.diagramData) return (
            <div key={msg.id} className="flex justify-start animate-fade-in">
              <div className="w-full max-w-[90%] md:max-w-[80%]">
                <div className="flex items-center gap-2 mb-1.5"><div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-primary" /></div><span className="text-xs text-muted-foreground font-medium">Study Buddy</span></div>
                <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5"><DiagramCard diagramData={msg.diagramData} /></div>
              </div>
            </div>
          );

          if (msg.role === "image" && msg.imageData) return (
            <div key={msg.id} className="flex justify-start animate-fade-in">
              <div className="w-full max-w-[90%] md:max-w-[80%]">
                <div className="flex items-center gap-2 mb-1.5"><div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-primary" /></div><span className="text-xs text-muted-foreground font-medium">Study Buddy</span></div>
                <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5"><ImageCard imageData={msg.imageData} /></div>
              </div>
            </div>
          );

          // Study Plan message
          if (msg.role === "study_plan" && msg.studyPlanData) {
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
                    <StudyPlanCard studyPlanData={msg.studyPlanData} conversationId={conversationId} />
                  </div>
                </div>
              </div>
            );
          }

          if (msg.role === "assistant" && msg.content === "" && regeneratingMsgId !== msg.id) return null;
          return (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
              <div className="max-w-[85%] md:max-w-[70%]">
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-1.5"><div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-primary" /></div><span className="text-xs text-muted-foreground font-medium">Study Buddy</span></div>
                )}
                {regeneratingMsgId === msg.id && msg.content.length < 5
                  ? <LoadingDots size={65} />
                  : <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border border-glow text-card-foreground rounded-bl-md"}`}>
                      {msg.role === "user"
                        ? msg.content
                        : renderMarkdown(translatedContent[msg.id] ?? msg.content)
                      }
                      {msg.role === "assistant" && translatedContent[msg.id] && (
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40">
                          <span className="text-xs text-primary/70">🌐 Translated</span>
                          <button onClick={() => { stopSpeech(); setTranslatedContent((prev) => { const n = { ...prev }; delete n[msg.id]; return n; }); setTranslatedLang((prev) => { const n = { ...prev }; delete n[msg.id]; return n; }); }} className="text-xs text-muted-foreground hover:text-primary">Show original</button>
                        </div>
                      )}
                    </div>
                }

                {msg.role === "assistant" && regeneratingMsgId !== msg.id && (
                  <div className="flex items-center gap-1 mt-2 ml-1 flex-wrap relative">
                    {[
                      {
                        icon:     loadingAudioMsgId === msg.id ? RefreshCw : speakingMsgId === msg.id ? Square : Volume2,
                        label:    loadingAudioMsgId === msg.id ? "Loading..." : speakingMsgId === msg.id ? "Stop" : "Audio",
                        action:   () => speakText(msg.id, translatedContent[msg.id] ?? msg.content, translatedLang[msg.id]),
                        spin:     loadingAudioMsgId === msg.id,
                        disabled: !!regeneratingMsgId,
                      },
                      {
                        icon:     Copy,
                        label:    "Copy",
                        action:   () => handleCopy(translatedContent[msg.id] ?? msg.content),
                        spin:     false,
                        disabled: !!regeneratingMsgId,
                      },
                      {
                        icon:     RefreshCw,
                        label:    regeneratingMsgId === msg.id ? "Regenerating..." : "Regenerate",
                        action:   () => regenerateMessage(msg.id),
                        spin:     regeneratingMsgId === msg.id,
                        // Disable while regenerating, typing, or on the welcome message (no preceding user question)
                        disabled: !!regeneratingMsgId || isTyping || msg.id === "1",
                      },
                    ].map((btn) => (
                      <Button key={btn.label} variant="ghost" size="sm" onClick={btn.action} disabled={btn.disabled}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5 disabled:opacity-40">
                        <btn.icon className={`w-3.5 h-3.5 ${btn.spin ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline">{btn.label}</span>
                      </Button>
                    ))}

                    <div className="relative">
                      <Button variant="ghost" size="sm"
                        onClick={() => setShowTranslatePicker(showTranslatePicker === msg.id ? null : msg.id)}
                        disabled={translatingMsgId === msg.id || !!regeneratingMsgId}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5 disabled:opacity-40">
                        <Globe className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{translatingMsgId === msg.id ? "Translating..." : "Translate"}</span>
                      </Button>
                      {showTranslatePicker === msg.id && (
                        <div className="absolute bottom-9 left-0 z-50 bg-card border border-border rounded-xl shadow-xl p-1.5 min-w-[140px]">
                          {[{ code: "en", label: "English" }, { code: "hi", label: "हिन्दी" }, { code: "mr", label: "मराठी" }, { code: "ta", label: "தமிழ்" }, { code: "te", label: "తెలుగు" }, { code: "bn", label: "বাংলা" }, { code: "gu", label: "ગુજરાતી" }, { code: "kn", label: "ಕನ್ನಡ" }].map((lang) => (
                            <button key={lang.code} onClick={() => translateMessage(msg.id, msg.content, lang.code)}
                              className="w-full text-left text-xs px-3 py-2 rounded-lg text-foreground hover:bg-primary/10 hover:text-primary transition-colors">{lang.label}</button>
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

        {/* Typing indicator — hidden while regenerating (the bubble itself shows dots) */}
        {isTyping && !regeneratingMsgId && (
          <div className="flex justify-start animate-fade-in">
            <LoadingDots size={65} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex-none w-full sticky bottom-0 z-20 pb-4 pt-2 px-4 bg-transparent">
        <div className="w-full max-w-4xl mx-auto">
          <div className={`flex items-end bg-secondary/95 backdrop-blur-md border rounded-2xl shadow-2xl px-1 py-1 transition-all duration-200 ${isListening ? "border-red-500/60 shadow-red-500/10" : "border-border/70 focus-within:border-primary/50"}`}>
            <div className="flex items-end pb-1 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 h-9 w-9 rounded-xl"><Plus className="w-5 h-5" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="bg-card border-border w-56 mb-1">
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()} className="gap-3 text-foreground cursor-pointer" disabled={isUploading}>
                    <Paperclip className={`w-4 h-4 text-primary ${isUploading ? "animate-pulse" : ""}`} />
                    Add photos &amp; files
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border/50 my-1" />
                  {TOOLS.map((tool) => (
                    <DropdownMenuItem key={tool.label} onClick={() => handleToolClick(tool.label)} className="gap-3 text-foreground cursor-pointer">
                      <tool.icon className="w-4 h-4 text-primary" />{tool.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <textarea ref={textareaRef} value={input} onChange={handleInputChange}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask anything..." rows={1}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm px-3 py-2.5 resize-none outline-none min-h-[40px] max-h-[120px]" />

            <div className="flex items-end gap-1 pr-1 pb-1 shrink-0">
              <Button variant="ghost" size="icon" onClick={toggleListening}
                className={`h-9 w-9 rounded-xl transition-all duration-200 ${isListening ? "bg-red-500 text-white hover:bg-red-600 scale-110" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                title={isListening ? "Stop listening" : "Start voice input"}><Mic className="w-4 h-4" /></Button>
              <Button onClick={sendMessage} disabled={!input.trim() || isTyping} size="icon" className="h-9 w-9 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-30 shrink-0"><Send className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
