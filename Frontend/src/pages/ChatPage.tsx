// import { useState, useRef, useEffect } from "react";
// import {
//   Send,
//   Paperclip,
//   Mic,
//   Plus,
//   Volume2,
//   Globe,
//   Copy,
//   RefreshCw,
//   FileText,
//   Layers,
//   CalendarDays,
//   GitBranch,
//   Network,
//   Brain,
//   Bot,
//   ChevronLeft,
//   ChevronRight,
//   CheckCircle2,
//   XCircle,
// } from "lucide-react";
// import { Button } from "@/components/ui/button";
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuTrigger,
// } from "@/components/ui/dropdown-menu";
// import { Badge } from "@/components/ui/badge";
// import { toast } from "sonner";

// // ── Types ─────────────────────────────────────────────────────────────────────

// interface QuizQuestion {
//   id: string;
//   question: string;
//   options: string[];
// }

// interface QuizResult {
//   question_id: string;
//   correct: boolean;
//   selected_index: number;
//   correct_index: number;
//   explanation: string;
//   question: string;
//   options: string[];
// }

// interface QuizData {
//   quiz_id: string;
//   topic: string;
//   questions: QuizQuestion[];
//   submitted: boolean;
//   score?: number;
//   correct_count?: number;
//   total_questions?: number;
//   weak_areas?: string[];
//   results?: QuizResult[];
// }

// interface Message {
//   id: string;
//   role: "user" | "assistant" | "quiz";
//   content: string;
//   quizData?: QuizData;
//   timestamp: Date;
// }

// // ── Constants ─────────────────────────────────────────────────────────────────

// const API_BASE = "http://localhost:8000";
// const USER_ID = "student-001";

// const TOOLS = [
//   { label: "Generate Quiz",       icon: FileText },
//   { label: "Generate Flashcards", icon: Layers },
//   { label: "Create Study Plan",   icon: CalendarDays },
//   { label: "Generate Mindmap",    icon: GitBranch },
//   { label: "Generate Flowchart",  icon: Network },
//   { label: "Generate Mindmap",    icon: Brain },
// ];

// const INITIAL_MESSAGES: Message[] = [
//   {
//     id: "1",
//     role: "assistant",
//     content:
//       "Hey there! 👋 I'm your Study Buddy. I can help you understand complex topics, generate quizzes, create flashcards, build study plans, and much more. Just type your question or use the ➕ tools menu to get started!",
//     timestamp: new Date(),
//   },
// ];

// // ── Helpers ───────────────────────────────────────────────────────────────────

// function generateUUID(): string {
//   return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
//     const r = (Math.random() * 16) | 0;
//     const v = c === "x" ? r : (r & 0x3) | 0x8;
//     return v.toString(16);
//   });
// }

// // ── Markdown Renderer ─────────────────────────────────────────────────────────

// function applyInline(text: string): React.ReactNode[] {
//   const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
//   return parts.map((part, i) => {
//     if (/^\*\*[^*]+\*\*$/.test(part))
//       return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
//     if (/^\*[^*]+\*$/.test(part))
//       return <em key={i} className="italic">{part.slice(1, -1)}</em>;
//     if (/^`[^`]+`$/.test(part))
//       return <code key={i} className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono text-primary">{part.slice(1, -1)}</code>;
//     return part;
//   });
// }

// function renderMarkdown(text: string) {
//   const lines = text.split("\n");
//   const elements: React.ReactNode[] = [];
//   let i = 0;
//   while (i < lines.length) {
//     const line = lines[i];
//     if (line.trim() === "") { i++; continue; }
//     if (/^\s*\d+\.\s/.test(line)) {
//       const items: string[] = [];
//       while (i < lines.length && /^\s*\d+\.\s/.test(lines[i]))
//         items.push(lines[i++].replace(/^\s*\d+\.\s/, ""));
//       elements.push(
//         <ol key={`ol-${i}`} className="list-decimal list-inside space-y-1 my-2 ml-2">
//           {items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}
//         </ol>
//       );
//       continue;
//     }
//     if (/^\s*[\*\-]\s/.test(line)) {
//       const items: string[] = [];
//       while (i < lines.length && /^\s*[\*\-]\s/.test(lines[i]))
//         items.push(lines[i++].replace(/^\s*[\*\-]\s/, ""));
//       elements.push(
//         <ul key={`ul-${i}`} className="list-disc list-inside space-y-1 my-2 ml-2">
//           {items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}
//         </ul>
//       );
//       continue;
//     }
//     elements.push(<p key={`p-${i}`} className="text-sm leading-relaxed my-1">{applyInline(line)}</p>);
//     i++;
//   }
//   return elements;
// }

// // ── QuizResults Component ─────────────────────────────────────────────────────

// const QuizResults = ({ quizData }: { quizData: QuizData }) => {
//   const [showBreakdown, setShowBreakdown] = useState(false);
//   const score = quizData.score ?? 0;
//   const scoreColor = score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : "text-red-400";

//   return (
//     <div className="space-y-4">
//       {/* Score header */}
//       <div className="text-center py-2">
//         <p className={`text-4xl font-bold ${scoreColor}`}>{score}%</p>
//         <p className="text-sm text-muted-foreground mt-1">
//           {quizData.correct_count} / {quizData.total_questions} correct
//         </p>
//       </div>

//       {/* Weak areas */}
//       {quizData.weak_areas && quizData.weak_areas.length > 0 && (
//         <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 space-y-2">
//           <p className="text-xs font-semibold text-yellow-400">⚠️ Weak Areas Identified</p>
//           <div className="flex flex-wrap gap-2">
//             {quizData.weak_areas.map((area, i) => (
//               <Badge key={i} variant="outline" className="border-yellow-500/30 text-yellow-400 bg-yellow-500/10 text-xs">
//                 {area}
//               </Badge>
//             ))}
//           </div>
//         </div>
//       )}

//       {/* Breakdown toggle */}
//       <Button
//         variant="ghost"
//         size="sm"
//         onClick={() => setShowBreakdown((v) => !v)}
//         className="w-full text-xs text-muted-foreground hover:text-primary"
//       >
//         {showBreakdown ? "Hide" : "Show"} question breakdown
//       </Button>

//       {/* Per-question breakdown */}
//       {showBreakdown && quizData.results && (
//         <div className="space-y-3">
//           {quizData.results.map((r, i) => (
//             <div key={i} className="bg-secondary/40 rounded-xl p-3 space-y-2">
//               <div className="flex items-start gap-2">
//                 {r.correct
//                   ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
//                   : <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
//                 <p className="text-xs font-medium text-foreground">{r.question}</p>
//               </div>
//               <div className="space-y-1 ml-6">
//                 {r.options.map((opt, oi) => (
//                   <div
//                     key={oi}
//                     className={`text-xs px-3 py-1.5 rounded-lg border ${
//                       oi === r.correct_index
//                         ? "border-green-500/40 bg-green-500/10 text-green-400"
//                         : oi === r.selected_index && !r.correct
//                         ? "border-red-500/40 bg-red-500/10 text-red-400"
//                         : "border-border text-muted-foreground"
//                     }`}
//                   >
//                     {opt}
//                   </div>
//                 ))}
//               </div>
//               <p className="text-xs text-muted-foreground ml-6 bg-secondary/50 p-2 rounded-lg">
//                 💡 {r.explanation}
//               </p>
//             </div>
//           ))}
//         </div>
//       )}
//     </div>
//   );
// };

// // ── QuizCard Component ────────────────────────────────────────────────────────

// const QuizCard = ({
//   messageId,
//   quizData,
//   onQuizComplete,
// }: {
//   messageId: string;
//   quizData: QuizData;
//   onQuizComplete: (messageId: string, updatedQuizData: QuizData) => void;
// }) => {
//   const [currentQ, setCurrentQ] = useState(0);
//   const [answers, setAnswers] = useState<(number | null)[]>(
//     Array(quizData.questions.length).fill(null)
//   );
//   const [isSubmitting, setIsSubmitting] = useState(false);

//   // If already submitted, show results
//   if (quizData.submitted) {
//     return (
//       <div className="space-y-3">
//         <p className="text-sm font-semibold text-foreground">📊 {quizData.topic} — Results</p>
//         <QuizResults quizData={quizData} />
//       </div>
//     );
//   }

//   const question = quizData.questions[currentQ];
//   const total = quizData.questions.length;
//   const allAnswered = answers.every((a) => a !== null);

//   const handleSelect = (optionIndex: number) => {
//     setAnswers((prev) => {
//       const updated = [...prev];
//       updated[currentQ] = optionIndex;
//       return updated;
//     });
//   };

//   const handleSubmit = async () => {
//     if (!allAnswered) return;
//     setIsSubmitting(true);
//     try {
//       const response = await fetch(`${API_BASE}/quiz/submit`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           user_id: USER_ID,
//           quiz_id: quizData.quiz_id,
//           answers: answers,
//         }),
//       });
//       if (!response.ok) {
//         const err = await response.json();
//         throw new Error(err.detail || "Submission failed");
//       }
//       const result = await response.json();
//       onQuizComplete(messageId, {
//         ...quizData,
//         submitted: true,
//         score: result.score,
//         correct_count: result.correct_count,
//         total_questions: result.total_questions,
//         weak_areas: result.weak_areas,
//         results: result.results,
//       });
//     } catch (err: any) {
//       toast.error(`Failed to submit quiz: ${err.message}`);
//     } finally {
//       setIsSubmitting(false);
//     }
//   };

//   return (
//     <div className="space-y-4">
//       {/* Header */}
//       <div className="flex items-center justify-between">
//         <p className="text-sm font-semibold text-foreground">📝 {quizData.topic}</p>
//         <span className="text-xs text-muted-foreground">{currentQ + 1} / {total}</span>
//       </div>

//       {/* Progress bar */}
//       <div className="w-full bg-secondary rounded-full h-1.5">
//         <div
//           className="bg-primary h-1.5 rounded-full transition-all duration-300"
//           style={{ width: `${((currentQ + 1) / total) * 100}%` }}
//         />
//       </div>

//       {/* Question */}
//       <p className="text-sm font-medium text-foreground">{question.question}</p>

//       {/* Options */}
//       <div className="space-y-2">
//         {question.options.map((opt, i) => (
//           <button
//             key={i}
//             onClick={() => handleSelect(i)}
//             className={`w-full text-left text-sm px-4 py-2.5 rounded-xl border transition-all duration-150 ${
//               answers[currentQ] === i
//                 ? "border-primary bg-primary/15 text-primary"
//                 : "border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5"
//             }`}
//           >
//             {opt}
//           </button>
//         ))}
//       </div>

//       {/* Navigation */}
//       <div className="flex items-center justify-between pt-1">
//         <Button
//           variant="ghost"
//           size="sm"
//           onClick={() => setCurrentQ((q) => q - 1)}
//           disabled={currentQ === 0}
//           className="gap-1 text-xs text-muted-foreground hover:text-primary"
//         >
//           <ChevronLeft className="w-4 h-4" /> Previous
//         </Button>

//         {currentQ < total - 1 ? (
//           <Button
//             variant="ghost"
//             size="sm"
//             onClick={() => setCurrentQ((q) => q + 1)}
//             className="gap-1 text-xs text-muted-foreground hover:text-primary"
//           >
//             Next <ChevronRight className="w-4 h-4" />
//           </Button>
//         ) : (
//           <Button
//             size="sm"
//             onClick={handleSubmit}
//             disabled={!allAnswered || isSubmitting}
//             className="text-xs bg-primary hover:bg-primary/90 disabled:opacity-40"
//           >
//             {isSubmitting ? "Submitting..." : "Submit Quiz"}
//           </Button>
//         )}
//       </div>

//       {/* Answered count */}
//       <p className="text-xs text-center text-muted-foreground">
//         {answers.filter((a) => a !== null).length} of {total} answered
//       </p>
//     </div>
//   );
// };

// // ── Main Component ────────────────────────────────────────────────────────────

// const ChatPage = () => {
//   const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
//   const [input, setInput] = useState("");
//   const [isTyping, setIsTyping] = useState(false);
//   const [isUploading, setIsUploading] = useState(false);
//   const [conversationId, setConversationId] = useState<string | null>(null);

//   const scrollRef = useRef<HTMLDivElement>(null);
//   const fileInputRef = useRef<HTMLInputElement>(null);

//   useEffect(() => {
//     scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
//   }, [messages, isTyping]);

//   // ── Quiz Complete Callback ────────────────────────────────────────────────

//   const handleQuizComplete = (messageId: string, updatedQuizData: QuizData) => {
//     setMessages((prev) =>
//       prev.map((m) => m.id === messageId ? { ...m, quizData: updatedQuizData } : m)
//     );
//   };

//   // ── Generate Quiz ─────────────────────────────────────────────────────────

//   const generateQuiz = async (topic: string, numQuestions: number = 5) => {
//     if (!topic && !conversationId) {
//       toast.error("Please provide a topic, e.g. 'Generate Quiz for: cricket'");
//       return;
//     }

//     // Auto-generate a conversationId if none exists yet.
//     // This allows general knowledge quizzes with no document upload.
//     let activeConversationId = conversationId;
//     if (!activeConversationId) {
//       activeConversationId = generateUUID();
//       setConversationId(activeConversationId);
//     }

//     // Add user message to chat
//     const userMsg: Message = {
//       id: Date.now().toString(),
//       role: "user",
//       content: `Generate Quiz for: ${topic}`,
//       timestamp: new Date(),
//     };
//     setMessages((prev) => [...prev, userMsg]);
//     setIsTyping(true);

//     try {
//       const response = await fetch(`${API_BASE}/quiz/generate`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           user_id: USER_ID,
//           conversation_id: activeConversationId,
//           topic: topic,
//           num_questions: numQuestions,
//         }),
//       });

//       if (!response.ok) {
//         const err = await response.json();
//         throw new Error(err.detail || "Quiz generation failed");
//       }

//       const data = await response.json();

//       // Add quiz message to chat
//       const quizMsg: Message = {
//         id: (Date.now() + 1).toString(),
//         role: "quiz",
//         content: "",
//         quizData: {
//           quiz_id: data.quiz_id,
//           topic: data.topic,
//           questions: data.questions,
//           submitted: false,
//         },
//         timestamp: new Date(),
//       };
//       setMessages((prev) => [...prev, quizMsg]);

//     } catch (err: any) {
//       setMessages((prev) => [
//         ...prev,
//         {
//           id: (Date.now() + 1).toString(),
//           role: "assistant",
//           content: `❌ Could not generate quiz: ${err.message}`,
//           timestamp: new Date(),
//         },
//       ]);
//     } finally {
//       setIsTyping(false);
//     }
//   };

//   // ── Send Message ──────────────────────────────────────────────────────────

//   const sendMessage = async () => {
//     if (!input.trim() || isTyping) return;

//     const userMessage = input.trim();
//     setInput("");

//     // ── Detect quiz trigger ───────────────────────────────────────────────────
//     // Catches both structured and natural language quiz requests:
//     // "Generate Quiz for: cricket"
//     // "give me a quiz on football"
//     // "make a 10 question quiz about photosynthesis"
//     // "quiz me on newton's laws"
//     // "create a quiz for chapter 3"
//     const quizTriggerPattern = /^(?:generate(?:\s+a)?\s+quiz|give(?:\s+me)?\s+a\s+(?:\d+\s*(?:qns?|questions?|qs?)\s+)?quiz|make(?:\s+me)?\s+a\s+(?:\d+\s*(?:qns?|questions?|qs?)\s+)?quiz|create\s+a\s+(?:\d+\s*(?:qns?|questions?|qs?)\s+)?quiz|quiz\s+me\s+on)/i;
//     const isQuizRequest = quizTriggerPattern.test(userMessage);

//     if (isQuizRequest) {
//       // Extract everything after the trigger phrase as the raw topic
//       const rawTopic = userMessage
//         .replace(/^(?:generate quiz(?:\s+for)?|give me a(?:\s+\d+\s*(?:qns?|questions?|qs?))?\s+quiz(?:\s+on)?|make a(?:\s+\d+\s*(?:qns?|questions?|qs?))?\s+quiz(?:\s+(?:about|on|for))?|create a(?:\s+\d+\s*(?:qns?|questions?|qs?))?\s+quiz(?:\s+(?:about|on|for))?|quiz me on|make me a(?:\s+\d+\s*(?:qns?|questions?|qs?))?\s+quiz(?:\s+(?:about|on|for))?|give a(?:\s+\d+\s*(?:qns?|questions?|qs?))?\s+quiz(?:\s+(?:about|on|for))?|generate a(?:\s+\d+\s*(?:qns?|questions?|qs?))?\s+quiz(?:\s+(?:about|on|for))?)/i, "")
//         .replace(/^:?\s*/, "")
//         .trim();

//       // Parse optional quantity anywhere in the message
//       // Handles: "10 questions", "10qns", "10qs", "10q"
//       const qtyMatch = userMessage.match(/\b(\d+)\s*(?:qns?|questions?|qs?)\b/i);
//       const numQuestions = qtyMatch ? parseInt(qtyMatch[1]) : 5;

//       // Clean leftover connective words from topic
//       const cleanTopic = rawTopic
//         .replace(/\s*\b\d+\s*(?:qns?|questions?|qs?)\b/i, "")
//         .replace(/\s*\b(and|with|about|for|on)\s*$/i, "")
//         .trim();

//       await generateQuiz(cleanTopic, numQuestions);
//       return;
//     }

//     const userMsg: Message = {
//       id: Date.now().toString(),
//       role: "user",
//       content: userMessage,
//       timestamp: new Date(),
//     };
//     setMessages((prev) => [...prev, userMsg]);
//     setIsTyping(true);

//     const aiMsgId = (Date.now() + 1).toString();
//     setMessages((prev) => [...prev, { id: aiMsgId, role: "assistant", content: "", timestamp: new Date() }]);

//     try {
//       const response = await fetch(`${API_BASE}/chat/message`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           user_id: USER_ID,
//           conversation_id: conversationId,
//           message: userMessage,
//         }),
//       });

//       if (!response.ok) throw new Error(`Server error: ${response.status}`);

//       const reader = response.body!.getReader();
//       const decoder = new TextDecoder();

//       while (true) {
//         const { done, value } = await reader.read();
//         if (done) break;

//         const raw = decoder.decode(value, { stream: true });
//         const lines = raw.split("\n\n").filter(Boolean);

//         for (const line of lines) {
//           if (!line.startsWith("data: ")) continue;
//           const dataStr = line.slice(6).trim();
//           if (dataStr === "[DONE]") { setIsTyping(false); break; }

//           let parsed: { type: string; content?: string; conversation_id?: string };
//           try { parsed = JSON.parse(dataStr); } catch { continue; }

//           if (parsed.type === "meta" && parsed.conversation_id)
//             setConversationId(parsed.conversation_id);
//           if (parsed.type === "text" && parsed.content)
//             setMessages((prev) =>
//               prev.map((m) => m.id === aiMsgId ? { ...m, content: m.content + parsed.content } : m)
//             );
//           if (parsed.type === "error") {
//             toast.error(`AI error: ${parsed.content}`);
//             setIsTyping(false);
//             break;
//           }
//         }
//       }
//     } catch (err) {
//       toast.error("Could not reach the server. Is the backend running?");
//       setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
//     } finally {
//       setIsTyping(false);
//     }
//   };

//   // ── File Upload ───────────────────────────────────────────────────────────

//   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
//     const file = e.target.files?.[0];
//     if (!file) return;
//     e.target.value = "";

//     let activeConversationId = conversationId;
//     if (!activeConversationId) {
//       activeConversationId = generateUUID();
//       setConversationId(activeConversationId);
//     }

//     setIsUploading(true);
//     toast.info(`Uploading "${file.name}"...`);

//     const formData = new FormData();
//     formData.append("file", file);
//     formData.append("user_id", USER_ID);
//     formData.append("conversation_id", activeConversationId);

//     try {
//       const response = await fetch(`${API_BASE}/upload/file`, { method: "POST", body: formData });
//       if (!response.ok) {
//         const err = await response.json();
//         throw new Error(err.detail || "Upload failed");
//       }
//       const data = await response.json();
//       toast.success(`"${file.name}" uploaded! ${data.chunks_stored} chunks indexed.`);
//       setMessages((prev) => [
//         ...prev,
//         {
//           id: Date.now().toString(),
//           role: "assistant",
//           content: `📎 I've processed **${file.name}** (${data.chunks_stored} chunks indexed). You can now ask me questions about it!`,
//           timestamp: new Date(),
//         },
//       ]);
//     } catch (err: any) {
//       toast.error(`Upload failed: ${err.message}`);
//     } finally {
//       setIsUploading(false);
//     }
//   };

//   // ── Tool Click ────────────────────────────────────────────────────────────

//   const handleToolClick = (tool: string) => {
//     if (tool === "Generate Quiz") {
//       setInput("Generate Quiz for: ");
//     } else {
//       setInput(`${tool} for: `);
//       toast.info(`Selected: ${tool}. Type your topic and send!`);
//     }
//   };

//   const handleCopy = (text: string) => {
//     navigator.clipboard.writeText(text);
//     toast.success("Copied to clipboard!");
//   };

//   // ── Render ────────────────────────────────────────────────────────────────

//   return (
//     <div className="flex flex-col h-full">
//       <input
//         ref={fileInputRef}
//         type="file"
//         accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
//         className="hidden"
//         onChange={handleFileChange}
//       />

//       {/* Messages */}
//       <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
//         {messages.map((msg) => {

//           // ── Quiz message ──────────────────────────────────────────────────
//           if (msg.role === "quiz" && msg.quizData) {
//             return (
//               <div key={msg.id} className="flex justify-start animate-fade-in">
//                 <div className="w-full max-w-[90%] md:max-w-[75%]">
//                   <div className="flex items-center gap-2 mb-1.5">
//                     <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
//                       <Bot className="w-3.5 h-3.5 text-primary" />
//                     </div>
//                     <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
//                   </div>
//                   <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5">
//                     <QuizCard
//                       messageId={msg.id}
//                       quizData={msg.quizData}
//                       onQuizComplete={handleQuizComplete}
//                     />
//                   </div>
//                 </div>
//               </div>
//             );
//           }

//           // ── Regular user / assistant message ──────────────────────────────
//           return (
//             <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
//               <div className="max-w-[85%] md:max-w-[70%]">
//                 {msg.role === "assistant" && (
//                   <div className="flex items-center gap-2 mb-1.5">
//                     <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
//                       <Bot className="w-3.5 h-3.5 text-primary" />
//                     </div>
//                     <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
//                   </div>
//                 )}
//                 <div
//                   className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
//                     msg.role === "user"
//                       ? "bg-primary text-primary-foreground rounded-br-md"
//                       : "bg-card border border-glow text-card-foreground rounded-bl-md"
//                   }`}
//                 >
//                   {msg.role === "user" ? msg.content : renderMarkdown(msg.content)}
//                 </div>
//                 {msg.role === "assistant" && (
//                   <div className="flex items-center gap-1 mt-2 ml-1">
//                     {[
//                       { icon: Volume2,   label: "Audio",      action: () => toast.info("Text-to-speech coming soon!") },
//                       { icon: Globe,     label: "Translate",  action: () => toast.info("Translation coming soon!") },
//                       { icon: Copy,      label: "Copy",       action: () => handleCopy(msg.content) },
//                       { icon: RefreshCw, label: "Regenerate", action: () => toast.info("Regeneration coming soon!") },
//                     ].map((btn) => (
//                       <Button
//                         key={btn.label}
//                         variant="ghost"
//                         size="sm"
//                         onClick={btn.action}
//                         className="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1.5"
//                       >
//                         <btn.icon className="w-3.5 h-3.5" />
//                         <span className="hidden sm:inline">{btn.label}</span>
//                       </Button>
//                     ))}
//                   </div>
//                 )}
//               </div>
//             </div>
//           );
//         })}

//         {isTyping && (
//           <div className="flex justify-start animate-fade-in">
//             <div className="bg-card border border-glow rounded-2xl rounded-bl-md px-4 py-3">
//               <div className="flex gap-1.5">
//                 <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
//                 <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
//                 <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
//               </div>
//             </div>
//           </div>
//         )}
//       </div>

//       {/* Input */}
//       <div className="border-t border-border p-3 md:p-4 bg-card">
//         <div className="flex items-end gap-2 max-w-4xl mx-auto">
//           <DropdownMenu>
//             <DropdownMenuTrigger asChild>
//               <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 h-10 w-10">
//                 <Plus className="w-5 h-5" />
//               </Button>
//             </DropdownMenuTrigger>
//             <DropdownMenuContent align="start" side="top" className="bg-card border-border w-56">
//               {TOOLS.map((tool) => (
//                 <DropdownMenuItem key={tool.label} onClick={() => handleToolClick(tool.label)} className="gap-3 text-foreground">
//                   <tool.icon className="w-4 h-4 text-primary" />
//                   {tool.label}
//                 </DropdownMenuItem>
//               ))}
//             </DropdownMenuContent>
//           </DropdownMenu>

//           <div className="flex-1 flex items-end bg-secondary rounded-xl border border-border focus-within:border-primary/50 focus-within:glow-blue-sm transition-all">
//             <textarea
//               value={input}
//               onChange={(e) => setInput(e.target.value)}
//               onKeyDown={(e) => {
//                 if (e.key === "Enter" && !e.shiftKey) {
//                   e.preventDefault();
//                   sendMessage();
//                 }
//               }}
//               placeholder="Ask anything..."
//               rows={1}
//               className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm px-4 py-2.5 resize-none outline-none min-h-[40px] max-h-[120px]"
//             />
//             <div className="flex items-center gap-1 pr-2 pb-1.5">
//               <Button
//                 variant="ghost"
//                 size="icon"
//                 className="h-8 w-8 text-muted-foreground hover:text-primary"
//                 disabled={isUploading}
//                 onClick={() => fileInputRef.current?.click()}
//               >
//                 <Paperclip className={`w-4 h-4 ${isUploading ? "animate-pulse" : ""}`} />
//               </Button>
//               <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
//                 <Mic className="w-4 h-4" />
//               </Button>
//             </div>
//           </div>

//           <Button
//             onClick={sendMessage}
//             disabled={!input.trim() || isTyping}
//             size="icon"
//             className="shrink-0 h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-30"
//           >
//             <Send className="w-4 h-4" />
//           </Button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ChatPage;



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
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Code,
  ImageIcon,
  Download,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
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

interface ImageData {
  diagram_id: string;
  type: "image";
  topic: string;
  image_url: string;
  created_at: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "quiz" | "diagram" | "image";
  content: string;
  quizData?: QuizData;
  diagramData?: DiagramData;
  imageData?: ImageData;
  timestamp: Date;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8000";
const USER_ID = "student-001";

const TOOLS = [
  { label: "Generate Quiz",       icon: FileText    },
  { label: "Generate Flashcards", icon: Layers      },
  { label: "Create Study Plan",   icon: CalendarDays },
  { label: "Generate Diagram",    icon: Sparkles    },
  { label: "Generate Mindmap",    icon: GitBranch   },
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

// ── Quiz Intent Detection ─────────────────────────────────────────────────────

function detectQuizIntent(message: string): {
  isQuiz: boolean;
  topic: string;
  numQuestions: number;
} {
  const isNonCreationMessage =
    /^(what is|what are|what was|what were|how do|how to|how can|how would|how does|explain|tell me about|describe|define|can you explain|could you explain)/i.test(message) ||
    /\b(my quiz|the quiz|failed (my|the|a) quiz|passed (my|the|a) quiz|have a quiz|has a quiz|for my quiz|before my quiz|after my quiz|study for|prepare for my quiz|quiz tomorrow|quiz today|quiz (on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|quiz (next|this|last) (week|month|day))\b/i.test(message);

  if (isNonCreationMessage) {
    return { isQuiz: false, topic: "", numQuestions: 5 };
  }

  const hasQuizSignal =
    /\bquiz(zes)?\b/i.test(message) ||
    /\b\d+\s*(questions?|qns?|qs?)\b/i.test(message);

  const hasCreationVerb =
    /\b(make|create|give|generate|build|need|want|get|prepare|design|write|produce|quiz me|test me)\b/i.test(message);

  if (!hasQuizSignal || !hasCreationVerb) {
    return { isQuiz: false, topic: "", numQuestions: 5 };
  }

  const qtyMatch =
    message.match(/\b(\d+)\s*(?:qns?|questions?|qs?)\b/i) ||
    message.match(/\b(\d+)\s+(?:question|qn)\b/i);
  const numQuestions = qtyMatch
    ? Math.min(Math.max(parseInt(qtyMatch[1]), 1), 20)
    : 5;

  const cleanTopic = message
    .replace(/\b(\d+)\s*(?:qns?|questions?|qs?)\b/gi, "")
    .replace(/\b(generate|make|create|give|get|need|want|build|prepare|design|write|produce|test)\b/gi, "")
    .replace(/\b(quiz|quizzes|question|questions|me|us|my|a|an|the)\b/gi, "")
    .replace(/\b(about|on|for|regarding|related to|covering|of)\b/gi, "")
    .replace(/\b(i|can|you|could|please|would|like)\b/gi, "")
    .replace(/[?!.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { isQuiz: true, topic: cleanTopic, numQuestions };
}

// ── Download helper ───────────────────────────────────────────────────────────

function downloadPNG(svgContent: string, filename: string) {
  const b64 = btoa(unescape(encodeURIComponent(svgContent)));
  const dataUrl = `data:image/svg+xml;base64,${b64}`;
  const img = new Image();
  img.onload = () => {
    const scale = 2;
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
    if (/^`[^`]+`$/.test(part))
      return <code key={i} className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono text-primary">{part.slice(1, -1)}</code>;
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
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*\d+\.\s/, ""));
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-1 my-2 ml-2">
          {items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}
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
          {items.map((item, j) => <li key={j} className="text-sm">{applyInline(item)}</li>)}
        </ul>
      );
      continue;
    }
    elements.push(<p key={`p-${i}`} className="text-sm leading-relaxed my-1">{applyInline(line)}</p>);
    i++;
  }
  return elements;
}

// ── QuizResults Component ─────────────────────────────────────────────────────

const QuizResults = ({ quizData }: { quizData: QuizData }) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const score = quizData.score ?? 0;
  const scoreColor = score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <p className={`text-4xl font-bold ${scoreColor}`}>{score}%</p>
        <p className="text-sm text-muted-foreground mt-1">
          {quizData.correct_count} / {quizData.total_questions} correct
        </p>
      </div>

      {quizData.weak_areas && quizData.weak_areas.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-yellow-400">⚠️ Weak Areas Identified</p>
          <div className="flex flex-wrap gap-2">
            {quizData.weak_areas.map((area, i) => (
              <Badge key={i} variant="outline" className="border-yellow-500/30 text-yellow-400 bg-yellow-500/10 text-xs">
                {area}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowBreakdown((v) => !v)}
        className="w-full text-xs text-muted-foreground hover:text-primary"
      >
        {showBreakdown ? "Hide" : "Show"} question breakdown
      </Button>

      {showBreakdown && quizData.results && (
        <div className="space-y-3">
          {quizData.results.map((r, i) => (
            <div key={i} className="bg-secondary/40 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                {r.correct
                  ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                  : <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                <p className="text-xs font-medium text-foreground">{r.question}</p>
              </div>
              <div className="space-y-1 ml-6">
                {r.options.map((opt, oi) => (
                  <div
                    key={oi}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${
                      oi === r.correct_index
                        ? "border-green-500/40 bg-green-500/10 text-green-400"
                        : oi === r.selected_index && !r.correct
                        ? "border-red-500/40 bg-red-500/10 text-red-400"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {opt}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground ml-6 bg-secondary/50 p-2 rounded-lg">
                💡 {r.explanation}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── QuizCard Component ────────────────────────────────────────────────────────

const QuizCard = ({
  messageId,
  quizData,
  onQuizComplete,
}: {
  messageId: string;
  quizData: QuizData;
  onQuizComplete: (messageId: string, updatedQuizData: QuizData) => void;
}) => {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(quizData.questions.length).fill(null)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (quizData.submitted) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">📊 {quizData.topic} — Results</p>
        <QuizResults quizData={quizData} />
      </div>
    );
  }

  const question = quizData.questions[currentQ];
  const total = quizData.questions.length;
  const allAnswered = answers.every((a) => a !== null);
  const answeredCount = answers.filter((a) => a !== null).length;

  const handleSelect = (optionIndex: number) => {
    setAnswers((prev) => {
      const updated = [...prev];
      updated[currentQ] = optionIndex;
      return updated;
    });
  };

  const handleSubmit = async () => {
    if (!allAnswered) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/quiz/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          quiz_id: quizData.quiz_id,
          answers: answers,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Submission failed");
      }
      const result = await response.json();
      onQuizComplete(messageId, {
        ...quizData,
        submitted: true,
        score: result.score,
        correct_count: result.correct_count,
        total_questions: result.total_questions,
        weak_areas: result.weak_areas,
        results: result.results,
      });
    } catch (err: any) {
      toast.error(`Failed to submit quiz: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">📝 {quizData.topic}</p>
        <span className="text-xs text-muted-foreground">{currentQ + 1} / {total}</span>
      </div>

      <div className="w-full bg-secondary rounded-full h-1.5">
        <div
          className="bg-primary h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${(answeredCount / total) * 100}%` }}
        />
      </div>

      <p className="text-sm font-medium text-foreground">{question.question}</p>

      <div className="space-y-2">
        {question.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i)}
            className={`w-full text-left text-sm px-4 py-2.5 rounded-xl border transition-all duration-150 ${
              answers[currentQ] === i
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5"
            }`}
          >
            {opt}
          </button>
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

// ── DiagramCard ─────────────────────────────────────────────────────────────

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

// ── ImageCard ─────────────────────────────────────────────────────────────────

const ImageCard = ({ imageData }: { imageData: ImageData }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imageData.image_url;
    a.download = `${imageData.topic.replace(/\s+/g, "_")}.png`;
    a.target = "_blank";
    a.click();
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{imageData.topic}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
            AI Image
          </span>
        </div>
        {loaded && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-primary gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </Button>
        )}
      </div>

      {/* Image */}
      <div className="rounded-xl overflow-hidden bg-secondary/50 min-h-[200px] flex items-center justify-center">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-xs text-destructive">Failed to load image.</p>
          </div>
        ) : (
          <>
            {!loaded && (
              <div className="flex gap-1.5 py-10">
                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            )}
            <img
              src={imageData.image_url}
              alt={imageData.topic}
              className={`w-full rounded-xl object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0 absolute"}`}
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
            />
          </>
        )}
      </div>

      {/* Footer */}
      <p className="text-xs text-muted-foreground text-right">
        Saved to your Images library ✓
      </p>
    </div>
  );
};

// ── Main Component ───────────────────────────────────────────────────────

const ChatPage = () => {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Holds the pending diagram type when the bot asked "what topic?" and is
  // waiting for the user's next plain-text reply to use as the topic.
  const [pendingDiagramType, setPendingDiagramType] = useState<"flowchart" | "diagram" | null>(null);
  const [pendingImageRequest, setPendingImageRequest] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  const handleQuizComplete = (messageId: string, updatedQuizData: QuizData) => {
    setMessages((prev) =>
      prev.map((m) => m.id === messageId ? { ...m, quizData: updatedQuizData } : m)
    );
  };

  const generateQuiz = async (topic: string, numQuestions: number = 5) => {
    if (!topic && !conversationId) {
      toast.error("Please provide a topic, e.g. 'make a quiz about cricket'");
      return;
    }

    let activeConversationId = conversationId;
    if (!activeConversationId) {
      activeConversationId = generateUUID();
      setConversationId(activeConversationId);
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: topic
        ? `Generate Quiz for: ${topic}${numQuestions !== 5 ? ` (${numQuestions} questions)` : ""}`
        : "Generate Quiz from uploaded document",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE}/quiz/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: activeConversationId,
          topic: topic || null,
          num_questions: numQuestions,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Quiz generation failed");
      }

      const data = await response.json();

      const quizMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "quiz",
        content: "",
        quizData: {
          quiz_id: data.quiz_id,
          topic: data.topic,
          questions: data.questions,
          submitted: false,
        },
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, quizMsg]);

    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `❌ Could not generate quiz: ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // NOTE: user message formatting now matches quiz's format.
  const generateDiagram = async (topic: string, diagramType: "flowchart" | "diagram") => {
    if (!topic.trim()) {
      toast.error("Please specify a topic for the diagram.");
      return;
    }

    const formattedContent =
      diagramType === "flowchart"
        ? `Generate Flowchart for: ${topic.trim()}`
        : `Generate Mindmap for: ${topic.trim()}`;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: formattedContent,
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
      toast.error(`Could not Generate Mindmap: ${err.message}`);
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

  // ── Smart topic inference from conversation history ───────────────────────
  // Calls the backend /chat/infer-topic which uses Gemini to extract a clean
  // 3-5 word topic from the recent messages. Used when user triggers diagram
  // generation without specifying a topic mid-conversation.
  const inferTopicFromConversation = async (): Promise<string | null> => {
    const recentMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 300) }));

    if (recentMessages.length === 0) return null;

    try {
      const res = await fetch(`${API_BASE}/chat/infer-topic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: recentMessages }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.topic || null;
    } catch {
      return null;
    }
  };

  // ── Handles a diagram request with full scenario logic ────────────────────
  //
  // Scenario A — topic given explicitly → generate immediately
  // Scenario B — no topic, no chat history → ask the user what topic they want
  // Scenario C — no topic, active conversation → infer topic via Gemini and generate
  const handleDiagramRequest = async (
    rawTopic: string,
    diagramType: "flowchart" | "diagram",
    userMessage: string
  ) => {
    const topic = rawTopic.trim();

    // ── Scenario A: explicit topic given ─────────────────────────────────────
    if (topic) {
      await generateDiagram(topic, diagramType);
      return;
    }

    // Real conversation messages (excluding the initial greeting and command/tool messages)
    const realMessages = messages.filter(
      (m) => (m.role === "user" || m.role === "assistant") && m.id !== "1"
    );

    // ── Scenario B: no topic + no prior conversation ──────────────────────────
    if (realMessages.length === 0) {
      const typeLabel = diagramType === "flowchart" ? "flowchart" : "mind map diagram";
      // Show the user's trigger message in chat
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "user",
          content: userMessage,
          timestamp: new Date(),
        },
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Sure! What topic would you like me to create a ${typeLabel} for? Just type the topic and I'll generate it right away. 🎨`,
          timestamp: new Date(),
        },
      ]);
      setInput("");
      // Remember we're waiting for a topic reply
      setPendingDiagramType(diagramType);
      return;
    }

    // ── Scenario C: no topic + active conversation → infer via Gemini ────────
    // Show the user's trigger message, then a "thinking" indicator while we infer
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content: userMessage,
        timestamp: new Date(),
      },
    ]);
    setInput("");
    setIsTyping(true);

    const inferredTopic = await inferTopicFromConversation();
    setIsTyping(false);

    if (!inferredTopic || inferredTopic === "General Topic") {
      // Inference unclear — ask the user explicitly
      const typeLabel = diagramType === "flowchart" ? "flowchart" : "mind map diagram";
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `I wasn't sure which topic to use from our conversation. What would you like me to create a ${typeLabel} for? Just type the topic! 🎨`,
          timestamp: new Date(),
        },
      ]);
      setPendingDiagramType(diagramType);
      return;
    }

    // We have a good inferred topic — generate directly
    await generateDiagram(inferredTopic, diagramType);
  };

  // ── Generate real AI image via Imagen 4 ──────────────────────────────────
  const generateImage = async (topic: string) => {
    if (!topic.trim()) {
      toast.error("Please specify a topic for the image.");
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `Generate Diagram for: ${topic.trim()}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE}/diagrams/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: conversationId,
          topic: topic.trim(),
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Image generation failed");
      }

      const data: ImageData = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "image",
          content: "",
          imageData: data,
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      toast.error(`Could not generate image: ${err.message}`);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Sorry, I couldn't generate the image. ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Smart handler for image requests (same 3-scenario logic as diagrams) ──
  const handleImageRequest = async (rawTopic: string) => {
    const topic = rawTopic.trim();

    // Scenario A — explicit topic given
    if (topic) {
      await generateImage(topic);
      return;
    }

    const realMessages = messages.filter(
      (m) => (m.role === "user" || m.role === "assistant") && m.id !== "1"
    );

    // Scenario B — fresh chat, no history
    if (realMessages.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: `Sure! What topic would you like me to generate an AI diagram image for? Just type the topic. 🎨`,
          timestamp: new Date(),
        },
      ]);
      setPendingImageRequest(true);
      return;
    }

    // Scenario C — active conversation, infer topic via Gemini
    setIsTyping(true);
    const inferredTopic = await inferTopicFromConversation();
    setIsTyping(false);

    if (!inferredTopic || inferredTopic === "General Topic") {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: `I wasn't sure which topic to pick from our conversation. What would you like me to generate an image for? 🎨`,
          timestamp: new Date(),
        },
      ]);
      setPendingImageRequest(true);
      return;
    }

    await generateImage(inferredTopic);
  };

  const sendMessage = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();
    setInput("");

    // ── Pending diagram topic reply ───────────────────────────────────────────
    // The bot previously asked "what topic?" — this reply IS the topic.
    if (pendingDiagramType) {
      const diagramType = pendingDiagramType;
      setPendingDiagramType(null);
      // Strip any accidental tool prefix (e.g. if user clicked a tool button)
      const cleanTopic = userMessage
        .replace(/^generate (diagram|mindmap|flowchart|quiz)(\s+for)?:?\s*/i, "")
        .trim();
      if (!cleanTopic) {
        // Still empty after stripping — ask again
        setPendingDiagramType(diagramType);
        return;
      }
      await generateDiagram(cleanTopic, diagramType);
      return;
    }

    // ── Pending image topic reply ─────────────────────────────────────────────
    if (pendingImageRequest) {
      setPendingImageRequest(false);
      const cleanTopic = userMessage
        .replace(/^generate (diagram|mindmap|flowchart|quiz)(\s+for)?:?\s*/i, "")
        .trim();
      if (!cleanTopic) {
        setPendingImageRequest(true);
        return;
      }
      await generateImage(cleanTopic);
      return;
    }

    const { isQuiz, topic, numQuestions } = detectQuizIntent(userMessage);

    if (isQuiz) {
      await generateQuiz(topic, numQuestions);
      return;
    }

    if (/^generate diagram/i.test(userMessage)) {
      const match = userMessage.match(/^generate diagram(?:\s+for)?:?\s*(.*)/i);
      await handleImageRequest(match?.[1] ?? "");
      return;
    }

    if (/^generate flowchart/i.test(userMessage)) {
      const match = userMessage.match(/^generate flowchart(?:\s+for)?:?\s*(.*)/i);
      await handleDiagramRequest(match?.[1] ?? "", "flowchart", userMessage);
      return;
    }

    if (/^Generate Mindmap/i.test(userMessage)) {
      const match = userMessage.match(/^Generate Mindmap(?:\s+for)?:?\s*(.*)/i);
      await handleDiagramRequest(match?.[1] ?? "", "diagram", userMessage);
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
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

          if (parsed.type === "meta" && parsed.conversation_id)
            setConversationId(parsed.conversation_id);
          if (parsed.type === "text" && parsed.content)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, content: m.content + parsed.content } : m
              )
            );
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

      // FIX: remove stray commas / undefined entries (was producing corrupted messages)
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

  const handleToolClick = (tool: string) => {
    if (tool === "Generate Quiz") {
      setInput("Generate Quiz for: ");
    } else if (tool === "Generate Diagram") {
      setInput("Generate Diagram for: ");
    } else if (tool === "Generate Flowchart") {
      setInput("Generate Flowchart for: ");
    } else if (tool === "Generate Mindmap") {
      setInput("Generate Mindmap for: ");
    } else {
      setInput(`${tool} for: `);
      toast.info(`Selected: ${tool}. Type your topic and send!`);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

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
        {/* single pass through messages (handles quiz, diagram, assistant, user) */}
        {messages.map((msg) => {
          // Quiz message
          if (msg.role === "quiz" && msg.quizData) {
            return (
              <div key={msg.id} className="flex justify-start animate-fade-in">
                <div className="w-full max-w-[90%] md:max-w-[75%]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">Study Buddy</span>
                  </div>
                  <div className="bg-card border border-glow rounded-2xl rounded-bl-md p-5">
                    <QuizCard
                      messageId={msg.id}
                      quizData={msg.quizData}
                      onQuizComplete={handleQuizComplete}
                    />
                  </div>
                </div>
              </div>
            );
          }

          // Diagram message
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

          // AI-generated image message
          if (msg.role === "image" && msg.imageData) {
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
                    <ImageCard imageData={msg.imageData} />
                  </div>
                </div>
              </div>
            );
          }

          // Regular user / assistant message
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