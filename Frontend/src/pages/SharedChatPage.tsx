import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { API_BASE } from "@/config/api";
import { Bot, GraduationCap, ArrowRight, LinkIcon, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SharedMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
}

interface SharedConversation {
  conversation_id: string;
  title: string;
  messages: SharedMessage[];
}

// ── Simple markdown renderer (text + bold + code only — no heavy deps) ────────
function renderSimple(text: string) {
  if (!text || text === "__welcome__") return null;

  // Strip special sentinel content
  if (text.startsWith('{"__type":')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.__type === "quiz") return <em className="text-muted-foreground text-xs">[ Quiz — view in app ]</em>;
      if (parsed.__type === "diagram") return <em className="text-muted-foreground text-xs">[ Diagram — view in app ]</em>;
      if (parsed.__type === "image") return <em className="text-muted-foreground text-xs">[ AI Image — view in app ]</em>;
      if (parsed.__type === "study_plan") return <em className="text-muted-foreground text-xs">[ Study Plan — view in app ]</em>;
      if (parsed.__type === "web_search_answer") return <span>{parsed.answer ?? ""}</span>;
    } catch { /* fall through */ }
  }

  return (
    <span>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g).map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part))
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        if (/^`[^`]+`$/.test(part))
          return <code key={i} className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono text-primary">{part.slice(1, -1)}</code>;
        if (part === "\n")
          return <br key={i} />;
        return part;
      })}
    </span>
  );
}

// ── SharedChatPage ─────────────────────────────────────────────────────────────

const SharedChatPage = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();

  const [conversation, setConversation] = useState<SharedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setError("No conversation ID provided.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/chat/shared/${conversationId}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error("This conversation doesn't exist or has been deleted.");
          throw new Error("Failed to load shared conversation.");
        }
        const data: SharedConversation = await res.json();
        setConversation(data);
      } catch (e: any) {
        setError(e.message ?? "Something went wrong.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [conversationId]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading shared conversation…</p>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error || !conversation) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground mb-1">Conversation not found</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <Button size="sm" onClick={() => navigate("/chat")} className="gap-2">
            <ArrowRight className="w-4 h-4" />
            Start your own chat
          </Button>
        </div>
      </div>
    );
  }

  // ── Filter out the welcome sentinel ──────────────────────────────────────
  const messages = conversation.messages.filter(
    (m) => m.content !== "__welcome__" && m.role !== "system"
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── Top bar ── */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-md px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">Study Buddy</span>
          <span className="text-muted-foreground/40 text-sm">·</span>
          <span className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-sm">
            {conversation.title}
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => navigate("/chat")}
          className="gap-1.5 text-xs h-8"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Start your own chat</span>
          <span className="sm:hidden">Open app</span>
        </Button>
      </header>

      {/* ── Shared banner ── */}
      <div className="bg-primary/8 border-b border-primary/15 px-4 py-2.5 flex items-center gap-2">
        <LinkIcon className="w-3.5 h-3.5 text-primary shrink-0" />
        <p className="text-xs text-primary/80">
          You're viewing a shared conversation — read only
        </p>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">No messages in this conversation.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
              >
                <div className={`max-w-[85%] md:max-w-[72%] min-w-0 ${isUser ? "" : ""}`}>
                  {/* Assistant label */}
                  {!isUser && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                        <Bot className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed break-words ${
                      isUser
                        ? "bg-primary text-primary-foreground rounded-br-md w-fit ml-auto"
                        : "bg-card border border-border text-card-foreground rounded-bl-md"
                    }`}
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {renderSimple(msg.content)}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Bottom CTA */}
        <div className="pt-6 pb-4 flex flex-col items-center gap-3 border-t border-border/40 mt-6">
          <p className="text-xs text-muted-foreground text-center">
            Want to chat with your own documents and notes?
          </p>
          <Button onClick={() => navigate("/chat")} className="gap-2">
            <GraduationCap className="w-4 h-4" />
            Try Study Buddy
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SharedChatPage;