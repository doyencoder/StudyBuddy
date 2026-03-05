import { useState, useRef, useEffect } from "react";
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
  Brain,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8000";

// Temporary hardcoded user ID until authentication is added.
// Replace this with a real user ID from your auth system when ready.
const USER_ID = "student-001";

const TOOLS = [
  { label: "Generate Quiz", icon: FileText },
  { label: "Generate Flashcards", icon: Layers },
  { label: "Create Study Plan", icon: CalendarDays },
  { label: "Generate Diagram", icon: GitBranch },
  { label: "Generate Flowchart", icon: Network },
  { label: "Generate Mindmap", icon: Brain },
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

// ── Component ─────────────────────────────────────────────────────────────────

const ChatPage = () => {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Persists across messages within the same session.
  // Once the backend returns a conversation_id on the first message,
  // we store it here and send it with every subsequent message.
  const [conversationId, setConversationId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Hidden file input — triggered when the Paperclip button is clicked.
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  // ── Send Message (Real SSE Streaming) ───────────────────────────────────────

  const sendMessage = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();

    // Add user message to UI immediately.
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Placeholder for the AI reply that we'll build up word-by-word.
    const aiMsgId = (Date.now() + 1).toString();
    const aiMsg: Message = {
      id: aiMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, aiMsg]);

    try {
      const response = await fetch(`${API_BASE}/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: conversationId,   // null on first message → backend creates one
          message: userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Read the SSE stream chunk by chunk.
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });

        // Each SSE event looks like:  data: {...}\n\n
        // Split on double-newlines to handle multiple events in one chunk.
        const lines = raw.split("\n\n").filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();   // strip "data: " prefix

          // Stream is finished.
          if (dataStr === "[DONE]") {
            setIsTyping(false);
            break;
          }

          let parsed: { type: string; content?: string; conversation_id?: string };
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;  // skip malformed events
          }

          if (parsed.type === "meta" && parsed.conversation_id) {
            // Store the conversation_id returned by the backend.
            setConversationId(parsed.conversation_id);
          }

          if (parsed.type === "text" && parsed.content) {
            // Append each streamed chunk to the AI message in real time.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId
                  ? { ...m, content: m.content + parsed.content }
                  : m
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
      // Remove the empty AI placeholder on failure.
      setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
    } finally {
      setIsTyping(false);
    }
  };

  // ── File Upload (Paperclip Button) ───────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected if needed.
    e.target.value = "";

    setIsUploading(true);
    toast.info(`Uploading "${file.name}"...`);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("user_id", USER_ID);

    try {
      const response = await fetch(`${API_BASE}/upload/file`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Upload failed");
      }

      const data = await response.json();
      toast.success(`"${file.name}" uploaded! ${data.chunks_stored} chunks indexed.`);

      // Add a system-style message in the chat confirming the upload.
      const confirmMsg: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `📎 I've processed **${file.name}** (${data.chunks_stored} chunks indexed). You can now ask me questions about it!`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, confirmMsg]);

    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // ── Tool Click ────────────────────────────────────────────────────────────────

  const handleToolClick = (tool: string) => {
    setInput(`${tool} for: `);
    toast.info(`Selected: ${tool}. Type your topic and send!`);
  };

  // ── Copy ──────────────────────────────────────────────────────────────────────

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Hidden file input triggered by Paperclip button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
            <div className={`max-w-[85%] md:max-w-[70%] ${msg.role === "user" ? "" : ""}`}>
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
                {msg.content.split("\n").map((line, i) => (
                  <p key={i} className={i > 0 ? "mt-2" : ""}>
                    {line}
                  </p>
                ))}
              </div>

              {/* AI Action Bar — unchanged */}
              {msg.role === "assistant" && (
                <div className="flex items-center gap-1 mt-2 ml-1">
                  {[
                    { icon: Volume2, label: "Audio", action: () => toast.info("Text-to-speech coming soon!") },
                    { icon: Globe, label: "Translate", action: () => toast.info("Translation coming soon!") },
                    { icon: Copy, label: "Copy", action: () => handleCopy(msg.content) },
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
        ))}

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

      {/* Input — identical layout, Paperclip now wired */}
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
              {/* Paperclip — now triggers hidden file input */}
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