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

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

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

const ChatPage = () => {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Great question! Here's a simplified explanation:\n\n${input.length > 20 ? "This is a complex topic, so let me break it down step by step for you. The key concepts to understand are the fundamentals, which build upon each other to form the complete picture." : "That's straightforward — let me explain it clearly and simply for you."}\n\nWould you like me to generate a quiz or flashcards on this topic?`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsTyping(false);
    }, 1500);
  };

  const handleToolClick = (tool: string) => {
    setInput(`${tool} for: `);
    toast.info(`Selected: ${tool}. Type your topic and send!`);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  return (
    <div className="flex flex-col h-full">
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

              {/* AI Action Bar */}
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

      {/* Input */}
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
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                <Paperclip className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                <Mic className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Button
            onClick={sendMessage}
            disabled={!input.trim()}
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
