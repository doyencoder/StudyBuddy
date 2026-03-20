import { useState, useEffect, useRef } from "react"
import { FileText, GraduationCap, User, Send, Plus, Mic } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"

type AnimationState =
  | "idle"
  | "file-upload"
  | "user-typing"
  | "user-sent"
  | "thinking"
  | "ai-response"

export function ChatDemo() {
  const navigate = useNavigate()

  // ── Real input the visitor can type in ───────────────────────────────────
  const [liveInput, setLiveInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Demo animation state ─────────────────────────────────────────────────
  const [demoActive, setDemoActive] = useState(true)
  const [state, setState] = useState<AnimationState>("idle")
  const [inputText, setInputText] = useState("")
  const [aiTypingText, setAiTypingText] = useState("")
  const [aiDone, setAiDone] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const userMessage = "Explain the second law of thermodynamics from my notes"
  const aiResponse  = "Based on your Chapter 5 notes, the second law states that entropy in an isolated system always increases over time. This means..."

  // Send real input to chat page
  const handleSend = () => {
    const msg = liveInput.trim()
    if (!msg) return
    // Store in sessionStorage — ChatPage reads this in sendMessage directly,
    // avoiding all stale-closure timing issues with React state.
    sessionStorage.setItem('sb_landing_autosend', msg)
    navigate("/chat", { state: { prefillInput: msg, autoSend: true } })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSend()
  }

  // Stop demo animation when user starts typing
  const handleLiveInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLiveInput(e.target.value)
    if (e.target.value.length > 0) setDemoActive(false)
    else setDemoActive(true)
  }

  // Intersection observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !isVisible) setIsVisible(true) },
      { threshold: 0.3 }
    )
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [isVisible])

  // Demo sequence
  useEffect(() => {
    if (!isVisible || !demoActive) return
    const sequence: { state: AnimationState; delay: number }[] = [
      { state: "file-upload",    delay: 500   },
      { state: "user-typing",    delay: 1400  },
      { state: "user-sent",      delay: 4800  },
      { state: "thinking",       delay: 5200  },
      { state: "ai-response",    delay: 5800  },
    ]
    const timeouts: ReturnType<typeof setTimeout>[] = []
    sequence.forEach(({ state, delay }) => {
      timeouts.push(setTimeout(() => { if (demoActive) setState(state) }, delay))
    })
    return () => timeouts.forEach(clearTimeout)
  }, [isVisible, demoActive])

  // Demo: user typing in input
  useEffect(() => {
    if (state !== "user-typing" || !demoActive) return
    let i = 0
    setInputText("")
    const interval = setInterval(() => {
      if (i <= userMessage.length) { setInputText(userMessage.slice(0, i)); i++ }
      else clearInterval(interval)
    }, 55)
    return () => clearInterval(interval)
  }, [state, demoActive])

  // Demo: clear input on send
  useEffect(() => {
    if (state === "user-sent") setInputText("")
  }, [state])

  // Demo: AI typing
  useEffect(() => {
    if (state !== "ai-response" || !demoActive) return
    let i = 0
    setAiDone(false)
    const interval = setInterval(() => {
      if (i <= aiResponse.length) { setAiTypingText(aiResponse.slice(0, i)); i++ }
      else { clearInterval(interval); setAiDone(true) }
    }, 35)
    return () => clearInterval(interval)
  }, [state, demoActive])

  const showFileUpload    = demoActive && state !== "idle"
  const showUserBubble    = demoActive && ["user-sent","thinking","ai-response","action-buttons","complete"].includes(state)
  const showThinking      = demoActive && state === "thinking"
  const showAiResponse    = demoActive && ["ai-response","action-buttons","complete"].includes(state)
  const isDemoTyping      = demoActive && state === "user-typing"

  // What shows in the input box
  const displayText = liveInput || (demoActive ? inputText : "")
  const showCursor  = isDemoTyping && !liveInput

  return (
    <div ref={containerRef} className="w-full relative">
      {/* Glow */}
      <div
        className="absolute -inset-4 rounded-3xl blur-3xl opacity-60 pointer-events-none dark:block hidden"
        style={{ background: "radial-gradient(ellipse at 50% 80%, #4B6BF5 0%, #3b82f6 30%, #6366f1 55%, transparent 75%)" }}
      />

      <div className="relative rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden shadow-2xl shadow-black/30">

        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border/50 bg-card/90">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-primary" />
            </div>
            <span className="text-lg font-semibold text-foreground">Study Buddy</span>
          </div>
          <User className="w-5 h-5 text-muted-foreground" />
        </div>

        {/* Chat messages */}
        <div className="px-4 pt-4 pb-2 space-y-2 min-h-[220px] bg-background/30">

          {/* PDF bubble */}
          <div className={cn(
            "flex justify-end transition-all duration-500",
            showFileUpload ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          )}>
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-white text-sm font-medium max-w-[75%]"
              style={{ backgroundColor: '#4B6BF5' }}
            >
              <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <FileText className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">Chapter_5_Thermodynamics.pdf</p>
                <p className="text-xs text-white/70">Uploaded • 24 pages analyzed</p>
              </div>
            </div>
          </div>

          {/* User message bubble */}
          <div className={cn(
            "flex justify-end transition-all duration-400",
            showUserBubble ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
          )}>
            <div className="px-4 py-2.5 rounded-2xl text-white text-sm font-medium max-w-[75%]"
              style={{ backgroundColor: '#4B6BF5' }}
            >
              {userMessage}
            </div>
          </div>

          {/* AI thinking dots */}
          {showThinking && (
            <div className="flex items-start">
              <div className="flex gap-1 px-4 py-2.5 bg-card/70 border border-border/50 rounded-2xl rounded-bl-md">
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          {/* AI response */}
          <div className={cn(
            "transition-all duration-500",
            showAiResponse ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          )}>
            <div className="max-w-[85%] px-4 py-2.5 bg-card/70 border border-border/50 rounded-2xl rounded-bl-md">
              <p className="text-sm text-foreground leading-relaxed">
                {aiTypingText}
                {showAiResponse && !aiDone && (
                  <span className="inline-block w-0.5 h-4 ml-0.5 animate-pulse align-middle" style={{ backgroundColor: '#4B6BF5' }} />
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Input box — real + functional */}
        <div className="px-4 py-3 bg-card/90">
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-primary/30 cursor-text"
            style={{ backgroundColor: 'hsl(var(--card))' }}
            onClick={() => inputRef.current?.focus()}
          >
            <Plus className="w-4 h-4 text-muted-foreground shrink-0" />

            <div className="flex-1 relative min-w-0">
              <input
                ref={inputRef}
                type="text"
                value={liveInput}
                onChange={handleLiveInput}
                onKeyDown={handleKeyDown}
                placeholder=""
                className="w-full bg-transparent outline-none text-sm text-foreground caret-blue-400"
              />
              {/* Show demo typing text OR placeholder when input is empty */}
              {!liveInput && (
                <span className="absolute inset-0 flex items-center pointer-events-none text-sm select-none">
                  {displayText
                    ? <span className="text-foreground">{displayText}</span>
                    : <span className="text-muted-foreground">Ask anything...</span>
                  }
                  {showCursor && (
                    <span className="inline-block w-0.5 h-4 ml-0.5 animate-pulse align-middle" style={{ backgroundColor: '#4B6BF5' }} />
                  )}
                </span>
              )}
            </div>

            <Mic className="w-4 h-4 text-muted-foreground shrink-0" />
            <button
              onClick={handleSend}
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300"
              style={{ backgroundColor: liveInput ? '#4B6BF5' : 'hsl(var(--muted))' }}
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}