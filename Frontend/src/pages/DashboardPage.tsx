import { useState, useEffect, useMemo } from "react";
import {
  BookOpen, Target, ClipboardList, TrendingUp, TrendingDown, Flame,
  ChevronRight, Zap, AlertTriangle,
  Brain, Sparkles, CalendarDays, ChevronDown, ChevronUp, Clock,
  Save, Loader2, CheckCircle2, Gauge,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { API_BASE } from "@/config/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

// ─── colour aliases — V0 uses --chart-1/2/3, this project uses --primary/--accent
// We resolve them here as inline-style strings so nothing else needs changing.
const C1 = "hsl(var(--primary))";        // chart-1 → primary blue
const C2 = "hsl(var(--accent))";         // chart-2 → accent teal
const C3 = "hsl(var(--muted-foreground))"; // chart-3 → muted grey

const USER_ID = "student-001";

// ─── Types ────────────────────────────────────────────────────────────────────
interface WeekPlanData {
  week_number: number; start_date: string; end_date: string;
  tasks: string[]; estimate_hours?: number;
}
interface StudyPlanData {
  plan_id: string; title: string; start_date: string; end_date: string;
  weeks: WeekPlanData[]; summary: string;
}
interface QuizHistoryItem {
  quiz_id: string; topic: string; created_at: string; submitted: boolean;
  score?: number; total_questions: number; weak_areas: string[];
}
interface GoalItem { goal_id: string; title: string; progress: number; }
type ImproveStep = "input" | "generating" | "plan" | "saving-goal" | "ask-remove" | "done";

// ─── AnimatedWrapper ──────────────────────────────────────────────────────────
function AnimatedWrapper({
  children, delay = 0, className = "",
}: { children: React.ReactNode; delay?: number; className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), delay); return () => clearTimeout(t); }, [delay]);
  return (
    <div className={`transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"} ${className}`}>
      {children}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string; value: string; suffix?: string; change: string;
  trend: "up" | "down" | "neutral"; icon: React.ElementType; index: number;
}
function StatCard({ label, value, suffix, change, trend, icon: Icon, index }: StatCardProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <AnimatedWrapper delay={index * 100}>
      <div
        className="relative overflow-hidden rounded-2xl border p-6 cursor-default"
        style={{
          background: "linear-gradient(145deg, hsl(var(--card)) 0%, hsl(var(--muted)) 100%)",
          borderColor: hovered ? "hsl(var(--primary) / 0.45)" : "hsl(var(--border))",
          transform: hovered ? "translateY(-3px) scale(1.015)" : "translateY(0) scale(1)",
          boxShadow: hovered
            ? "0 8px 32px -8px hsl(var(--primary) / 0.25), 0 0 0 1px hsl(var(--primary) / 0.1)"
            : "0 1px 8px -4px hsl(0 0% 0% / 0.4)",
          transition: "transform 250ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 250ms ease, border-color 200ms ease",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Subtle blue tint — always on */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at top left, hsl(var(--primary) / 0.10) 0%, transparent 65%)" }}
        />
        {/* Stronger glow on hover */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at top left, hsl(var(--primary) / 0.20) 0%, transparent 60%)",
            opacity: hovered ? 1 : 0,
            transition: "opacity 250ms ease",
          }}
        />

        <div className="relative flex items-start justify-between">
          <div
            className="rounded-xl p-2.5"
            style={{
              background: hovered ? "hsl(var(--primary) / 0.18)" : "hsl(var(--secondary))",
              transition: "background 200ms ease",
            }}
          >
            <Icon
              className="h-5 w-5"
              style={{
                color: hovered ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                transition: "color 200ms ease",
              }}
            />
          </div>
          {trend === "up"   && <TrendingUp   className="h-4 w-4 text-primary" />}
          {trend === "down" && <TrendingDown className="h-4 w-4 text-muted-foreground" />}
        </div>

        <div className="relative mt-4">
          <div className="flex items-baseline gap-1">
            <span
              className="text-4xl font-bold tracking-tight"
              style={{
                color: hovered ? "hsl(var(--primary) / 0.9)" : "hsl(var(--foreground))",
                transition: "color 200ms ease",
              }}
            >
              {value}
            </span>
            {suffix && <span className="text-lg text-muted-foreground">{suffix}</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-xs" style={{ color: "hsl(var(--primary) / 0.8)" }}>{change}</p>
        </div>
      </div>
    </AnimatedWrapper>
  );
}

// ─── ScoreChart ───────────────────────────────────────────────────────────────
function ScoreChart({ data }: { data: { date: string; score: number }[] }) {
  const navigate = useNavigate();
  return (
    <AnimatedWrapper delay={400} className="h-full">
      <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">Quiz Score Over Time</h3>
          <p className="text-sm text-muted-foreground">Last 15 quizzes</p>
        </div>
        {data.length > 0 ? (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C1} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={C1} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" axisLine={false} tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} dy={10} />
                <YAxis domain={[0, 100]} axisLine={false} tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  dx={-10} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", boxShadow: "none" }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  itemStyle={{ color: C1 }}
                  formatter={(v: number) => [`${v}%`, "Score"]}
                />
                <Area type="monotone" dataKey="score" stroke={C1} strokeWidth={2} fill="url(#scoreGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
            <Brain className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No quiz data yet.</p>
            <button onClick={() => navigate("/chat")} className="text-xs text-primary hover:underline">Take your first quiz →</button>
          </div>
        )}
      </div>
    </AnimatedWrapper>
  );
}

// ─── ScoreDistribution ────────────────────────────────────────────────────────
function ScoreDistribution({ data }: { data: { name: string; value: number; fill: string }[] }) {
  return (
    <AnimatedWrapper delay={500} className="h-full">
      <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">Quiz Score Distribution</h3>
          <p className="text-sm text-muted-foreground">Performance breakdown</p>
        </div>
        {data.length > 0 ? (
          <div className="flex flex-1 items-center justify-center gap-6">
            <div className="h-[160px] w-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2} dataKey="value" strokeWidth={0}>
                    {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", boxShadow: "none", color: "hsl(var(--foreground))" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    formatter={(v: number) => [`${v}%`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-3">
              {data.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="text-sm text-muted-foreground">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <Brain className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No quiz data yet.</p>
          </div>
        )}
      </div>
    </AnimatedWrapper>
  );
}

// ─── HeatmapGrid ──────────────────────────────────────────────────────────────
const WEEK_COUNT = 16;
// Map intensity 0-1 to 4 discrete levels: 0=none, 1=low, 2=mid, 3=high, 4=max
function intensityLevel(v: number): 0 | 1 | 2 | 3 | 4 {
  if (!v || v <= 0) return 0;
  if (v < 0.3) return 1;
  if (v < 0.6) return 2;
  if (v < 0.85) return 3;
  return 4;
}
const LEVEL_OPACITY: Record<number, number> = { 0: 0.15, 1: 0.35, 2: 0.55, 3: 0.75, 4: 1 };

function HeatmapGrid({ data }: { data: { week: number; day: number; intensity: number }[] }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <AnimatedWrapper delay={600} className="h-full">
      <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
        
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">Quiz Frequency</h3>
          <p className="text-sm text-muted-foreground">Last {WEEK_COUNT} weeks</p>
        </div>

        <div className="flex flex-1 items-start gap-3">
          
          {/* Day labels */}
          <div className="flex flex-col gap-[10px] pt-1 shrink-0">
            {days.map((d, i) => (
              <div
                key={i}
                className="h-[18px] flex items-center text-xs text-muted-foreground w-7"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div className="flex gap-[12px]">
            {Array.from({ length: WEEK_COUNT }).map((_, wi) => (
              <div key={wi} className="flex flex-col gap-[10px]">
                {Array.from({ length: 7 }).map((_, di) => {
                  const cell = data.find((c) => c.week === wi && c.day === di);
                  const level = intensityLevel(cell?.intensity ?? 0);

                  return (
                    <div
                      key={di}
                      className="h-[18px] w-[18px] rounded-[4px] transition-all hover:ring-1 hover:ring-primary/50"
                      style={{
                        backgroundColor:
                          level === 0
                            ? "hsl(var(--muted))"
                            : C1,

                        border:
                          level === 0
                            ? "1px solid hsl(var(--border))"
                            : "none",

                        opacity:
                          level === 0
                            ? 0.7
                            : LEVEL_OPACITY[level],
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">Less</span>
          {[1, 2, 3, 4].map((l) => (
            <div
              key={l}
              className="h-[18px] w-[18px] rounded-[4px]"
              style={{
                backgroundColor: C1,
                opacity: LEVEL_OPACITY[l],
              }}
            />
          ))}
          <span className="text-xs text-muted-foreground">More</span>
        </div>
      </div>
    </AnimatedWrapper>
  );
}

// ─── GoalsProgress ────────────────────────────────────────────────────────────
function GoalsProgress({ goals }: { goals: GoalItem[] }) {
  const navigate = useNavigate();
  return (
    <AnimatedWrapper delay={700} className="h-full">
      <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Goals Progress</h3>
            <p className="text-sm text-muted-foreground">Your learning objectives</p>
          </div>
          {goals.length > 0 && (
            <button onClick={() => navigate("/goals")} className="text-xs text-primary hover:underline">View all</button>
          )}
        </div>
        {goals.length > 0 ? (
          <div className="flex flex-col gap-5">
            {goals.slice(0, 4).map((goal, i) => (
              <div key={goal.goal_id || i}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-foreground line-clamp-1">{goal.title}</span>
                  <span className="ml-2 shrink-0 text-sm font-medium text-muted-foreground">{goal.progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${goal.progress}%`, background: `linear-gradient(to right, ${C1}, ${C2})` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Target className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No goals set yet.</p>
            <button onClick={() => navigate("/goals")} className="text-xs text-primary hover:underline">Create your first goal →</button>
          </div>
        )}
      </div>
    </AnimatedWrapper>
  );
}

// ─── ImprovementAreas ─────────────────────────────────────────────────────────
function ImprovementAreas({ areas, onImprove }: { areas: { topic: string; accuracy: number }[]; onImprove: (t: string) => void }) {
  return (
    <AnimatedWrapper delay={800} className="h-full">
      <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground">Improvement Areas</h3>
          <p className="text-sm text-muted-foreground">Topics below 70%</p>
        </div>
        {areas.length > 0 ? (
          <div className="flex flex-col gap-4">
            {areas.map((area, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-secondary/50 p-4 transition-colors hover:border-muted-foreground/30">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium text-foreground">{area.topic}</p>
                    <p className="text-sm text-muted-foreground">{area.accuracy}%</p>
                  </div>
                </div>
                <button
                  onClick={() => onImprove(area.topic)}
                  className="flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                >
                  Improve <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-primary/40" />
            <p className="text-sm text-muted-foreground">No weak areas — great job! 🎉</p>
          </div>
        )}
      </div>
    </AnimatedWrapper>
  );
}

// ─── RecentQuizzes ────────────────────────────────────────────────────────────
function RecentQuizzes({ quizzes }: { quizzes: { quiz_id: string; topic: string; score: number; date: string }[] }) {
  const navigate = useNavigate();
  return (
    <AnimatedWrapper delay={900} className="h-full">
      <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Recent Quizzes</h3>
            <p className="text-sm text-muted-foreground">Your last 5 attempts</p>
          </div>
          <button onClick={() => navigate("/quizzes")} className="text-xs text-primary hover:underline">View all</button>
        </div>
        {quizzes.length > 0 ? (
          <div className="flex flex-col">
            {quizzes.map((q, i) => (
              <div key={i}
                className="group flex cursor-pointer items-center justify-between border-b border-border py-3 last:border-b-0 rounded-lg px-2 transition-colors hover:bg-secondary/50"
                onClick={() => navigate("/quizzes")}
              >
                <div>
                  <p className="font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">{q.topic}</p>
                  <p className="text-sm text-muted-foreground">{q.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-foreground">{q.score}%</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Brain className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No quizzes yet.</p>
            <button onClick={() => navigate("/chat")} className="text-xs text-primary hover:underline">Take your first quiz →</button>
          </div>
        )}
      </div>
    </AnimatedWrapper>
  );
}

// QuickActions removed — replaced by 50/50 ImprovementAreas + RecentQuizzes

// ─── DashboardPage ────────────────────────────────────────────────────────────
const DashboardPage = () => {
  const [loading, setLoading]               = useState(true);
  const [quizzes, setQuizzes]               = useState<QuizHistoryItem[]>([]);
  const [goals, setGoals]                   = useState<GoalItem[]>([]);
  const [displayName, setDisplayName]       = useState("");
  const [dismissedTopics, setDismissedTopics] = useState<string[]>([]);
  const [weeklyMinutes, setWeeklyMinutes] = useState<number | null>(null);

  // Improve dialog
  const [improveDialogOpen, setImproveDialogOpen] = useState(false);
  const [improveStep, setImproveStep]   = useState<ImproveStep>("input");
  const [improveTopic, setImproveTopic] = useState("");
  const [originalTopic, setOriginalTopic] = useState("");
  const [improveWeeks, setImproveWeeks] = useState(4);
  const [generatedPlan, setGeneratedPlan] = useState<StudyPlanData | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([1]));
  const [goalSaved, setGoalSaved]       = useState(false);

  // ── Fetches ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/settings/dismissed-weak-topics?user_id=${USER_ID}`)
      .then(r => r.ok ? r.json() : null).then(d => d && setDismissedTopics(d.dismissed_topics || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/settings/?user_id=${USER_ID}`)
      .then(r => r.ok ? r.json() : null).then(d => d && setDisplayName(d.profile?.display_name || "")).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/quiz/history?user_id=${USER_ID}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => setQuizzes(d.quizzes || []))
      .catch(() => toast.error("Could not load dashboard data. Is the backend running?"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/sessions/weekly?user_id=${USER_ID}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setWeeklyMinutes(d.total_minutes))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/goals/?user_id=${USER_ID}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          const items = Array.isArray(d) ? d : d.goals || [];
          setGoals(items.map((g: any) => ({ goal_id: g.goal_id || g.id || "", title: g.title || "", progress: g.progress ?? 0 })));
        }
      }).catch(() => {});
  }, []);

  // ── Improve dialog handlers ──────────────────────────────────────────────────
  const openImproveDialog = (topic: string) => {
    setImproveTopic(topic); setOriginalTopic(topic); setImproveWeeks(4);
    setImproveStep("input"); setGeneratedPlan(null); setGoalSaved(false);
    setExpandedWeeks(new Set([1])); setImproveDialogOpen(true);
  };

  const handleGeneratePlan = async () => {
    if (!improveTopic.trim()) { toast.error("Please enter a topic."); return; }
    if (improveWeeks < 1 || improveWeeks > 52) { toast.error("Weeks must be between 1 and 52."); return; }
    setImproveStep("generating");
    try {
      const res = await fetch(`${API_BASE}/study_plans/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, conversation_id: null, topic: improveTopic.trim(), timeline_weeks: improveWeeks, preferences: { hours_per_week: 8, focus_days: null } }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "Failed"); }
      setGeneratedPlan(await res.json()); setImproveStep("plan");
    } catch (err: any) { toast.error(`Failed: ${err.message}`); setImproveStep("input"); }
  };

  const handleSaveAsGoal = async () => {
    if (!generatedPlan) return;
    setImproveStep("saving-goal");
    try {
      const r = await fetch(`${API_BASE}/goals/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, title: generatedPlan.title, start_date: generatedPlan.start_date, end_date: generatedPlan.end_date, weekly_plan: generatedPlan.weeks, progress: 0, reminder: null }),
      });
      if (!r.ok) throw new Error("Failed to save goal");
      setGoalSaved(true); toast.success("Study plan saved as a goal!"); setImproveStep("ask-remove");
    } catch (err: any) { toast.error(`Could not save: ${err.message}`); setImproveStep("plan"); }
  };

  const handleRemoveFromWeakTopics = async (shouldRemove: boolean) => {
    if (shouldRemove) {
      try {
        await fetch(`${API_BASE}/settings/dismissed-weak-topics?user_id=${USER_ID}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: originalTopic.trim() }),
        });
        setDismissedTopics(p => [...p, originalTopic.trim()]); toast.success("Topic removed!");
      } catch { toast.error("Failed to dismiss topic."); }
    }
    setImproveDialogOpen(false);
  };

  const toggleWeek = (n: number) => setExpandedWeeks(p => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; });

  // ── Derived data ─────────────────────────────────────────────────────────────
  const submittedQuizzes = useMemo(() => quizzes.filter(q => q.submitted && q.score !== undefined), [quizzes]);
  const totalQuizzes  = quizzes.length;
  const avgScore      = useMemo(() => !submittedQuizzes.length ? 0 : Math.round(submittedQuizzes.reduce((a, q) => a + (q.score ?? 0), 0) / submittedQuizzes.length), [submittedQuizzes]);
  const uniqueTopics  = useMemo(() => new Set(quizzes.map(q => q.topic)).size, [quizzes]);
  const studyStreak   = useMemo(() => {
    if (!quizzes.length) return 0;
    const days = new Set(quizzes.map(q => new Date(q.created_at).toISOString().split("T")[0]));
    let streak = 0; const today = new Date();
    for (let i = 0; i < 365; i++) { const d = new Date(today); d.setDate(today.getDate() - i); if (days.has(d.toISOString().split("T")[0])) streak++; else if (i > 0) break; }
    return streak;
  }, [quizzes]);
  const thisWeekCount = useMemo(() => { const w = new Date(); w.setDate(w.getDate() - 7); return quizzes.filter(q => new Date(q.created_at) >= w).length; }, [quizzes]);
  const scoreChangeText = useMemo(() => {
    if (submittedQuizzes.length < 2) return "Keep taking quizzes!";
    const sorted = [...submittedQuizzes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const h = Math.floor(sorted.length / 2);
    const diff = Math.round((sorted.slice(h).reduce((s, q) => s + (q.score ?? 0), 0) / (sorted.length - h)) - (sorted.slice(0, h).reduce((s, q) => s + (q.score ?? 0), 0) / h));
    return diff > 0 ? `+${diff}% improvement` : diff < 0 ? `${diff}% change` : "Holding steady";
  }, [submittedQuizzes]);

  const statsCards: StatCardProps[] = useMemo(() => [
    { label: "Quizzes Taken",  value: totalQuizzes.toString(), change: thisWeekCount > 0 ? `+${thisWeekCount} this week` : "None this week", trend: thisWeekCount > 0 ? "up" : "neutral", icon: ClipboardList, index: 0 },
    { label: "Average Score",  value: `${avgScore}`, suffix: "%", change: scoreChangeText, trend: scoreChangeText.startsWith("+") ? "up" : "neutral", icon: Gauge, index: 1 },
    { label: "Topics Studied", value: uniqueTopics.toString(), change: uniqueTopics > 0 ? `${uniqueTopics} unique topics` : "No topics yet", trend: uniqueTopics > 0 ? "up" : "neutral", icon: BookOpen, index: 2 },
    { label: "Study Streak",   value: studyStreak.toString(), suffix: studyStreak !== 1 ? "days" : "day", change: studyStreak >= 7 ? "Personal best!" : studyStreak > 0 ? "Keep it up!" : "Start today!", trend: studyStreak > 0 ? "up" : "neutral", icon: Flame, index: 3 },
  ], [totalQuizzes, avgScore, uniqueTopics, studyStreak, thisWeekCount, scoreChangeText]);

  const scoreData = useMemo(() =>
    [...submittedQuizzes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).slice(-15)
      .map(q => ({ date: new Date(q.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }), score: q.score ?? 0 })),
    [submittedQuizzes]);

  const scoreDistributionData = useMemo(() => {
    if (!submittedQuizzes.length) return [];
    const t = submittedQuizzes.length;
    return [
      { name: "Strong (70–100%)",      value: Math.round((submittedQuizzes.filter(q => (q.score ?? 0) >= 70).length / t) * 100), fill: C1 },
      { name: "Getting There (40–70%)", value: Math.round((submittedQuizzes.filter(q => (q.score ?? 0) >= 40 && (q.score ?? 0) < 70).length / t) * 100), fill: C2 },
      { name: "Needs Work (0–40%)",     value: Math.round((submittedQuizzes.filter(q => (q.score ?? 0) < 40).length / t) * 100), fill: C3 },
    ].filter(d => d.value > 0);
  }, [submittedQuizzes]);

  const heatmapData = useMemo(() => {
  const today = new Date();
  const weeks = WEEK_COUNT;

  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      // FIX: correct reverse indexing so latest week is rightmost
      const d = new Date(today);
      d.setDate(today.getDate() - ((weeks - 1 - week) * 7 + (6 - day)));

      const key = d.toISOString().split("T")[0];

      const count = quizzes.filter(
        (q) =>
          new Date(q.created_at).toISOString().split("T")[0] === key
      ).length;

      return {
        week,
        day,
        intensity: count > 0 ? Math.min(1, count / 3) : 0,
      };
    })
  ).flat();
}, [quizzes]);

  const weakTopics = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const q of submittedQuizzes) { if (!map.has(q.topic)) map.set(q.topic, []); map.get(q.topic)!.push(q.score ?? 0); }
    return Array.from(map.entries())
      .map(([topic, scores]) => ({ topic, accuracy: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) }))
      .filter(t => t.accuracy < 70 && !dismissedTopics.includes(t.topic))
      .sort((a, b) => a.accuracy - b.accuracy).slice(0, 4);
  }, [submittedQuizzes, dismissedTopics]);

  const recentQuizzesList = useMemo(() =>
    [...submittedQuizzes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5)
      .map(q => ({ quiz_id: q.quiz_id, topic: q.topic, score: q.score ?? 0, date: new Date(q.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) })),
    [submittedQuizzes]);

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 md:p-8 overflow-y-auto h-full space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-secondary/60 rounded-xl animate-pulse" />
          <div className="h-4 w-48 bg-secondary/40 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-6 space-y-4 animate-pulse">
              <div className="h-9 w-9 bg-secondary/60 rounded-xl" />
              <div className="h-10 w-20 bg-secondary/80 rounded-lg" />
              <div className="h-3 w-24 bg-secondary/40 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-6 space-y-4 animate-pulse">
              <div className="h-5 w-36 bg-secondary/60 rounded-lg" />
              <div className="h-[200px] w-full bg-secondary/30 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="dashboard-font p-4 md:p-8 overflow-y-auto h-full">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* Header */}
        <AnimatedWrapper delay={0}>
          <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                <span className="text-sm font-semibold text-muted-foreground">StudyBuddy</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                Welcome back{displayName ? `, ${displayName}` : ""}!
              </h1>
              <p className="mt-1 text-muted-foreground">Track your learning journey and improve every day.</p>
            </div>
            {weeklyMinutes !== null && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none"
                    stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span className="text-3xl font-bold tracking-tight md:text-4xl" style={{ color: "hsl(var(--primary))" }}>
                    {weeklyMinutes < 60
                      ? `${weeklyMinutes}m`
                      : `${Math.floor(weeklyMinutes / 60)}h ${weeklyMinutes % 60}m`}
                  </span>
                </div>
                <p className="text-muted-foreground">studied this week</p>
              </div>
            )}
          </header>
        </AnimatedWrapper>

        {/* Stat Cards */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statsCards.map(s => <StatCard key={s.label} {...s} />)}
        </section>

        {/* Charts */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 auto-rows-fr">
          <ScoreChart data={scoreData} />
          <ScoreDistribution data={scoreDistributionData} />
        </section>

        {/* Heatmap & Goals */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 auto-rows-fr">
          <HeatmapGrid data={heatmapData} />
          <GoalsProgress goals={goals} />
        </section>

        {/* Bottom row */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 auto-rows-fr">
          <ImprovementAreas areas={weakTopics} onImprove={openImproveDialog} />
          <RecentQuizzes quizzes={recentQuizzesList} />
        </section>

      </div>

      {/* ── Improve Weak Topic Dialog ─────────────────────────────────────────── */}
      <Dialog open={improveDialogOpen} onOpenChange={open => { if (!open && improveStep !== "generating" && improveStep !== "saving-goal") setImproveDialogOpen(false); }}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">

          {improveStep === "input" && (<>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />Create Improvement Plan</DialogTitle>
              <DialogDescription>Generate a study plan to strengthen your weak topic.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="improve-topic">Topic</Label>
                <Input id="improve-topic" value={improveTopic} onChange={e => setImproveTopic(e.target.value)} placeholder="Enter the topic you want to improve" className="bg-background border-border" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="improve-weeks">Number of weeks</Label>
                <Input id="improve-weeks" type="number" min={1} max={52} value={improveWeeks === 0 ? "" : improveWeeks}
                  onChange={e => { const raw = e.target.value; if (raw === "") { setImproveWeeks(0); return; } const n = parseInt(raw); if (!isNaN(n)) setImproveWeeks(n); }}
                  onBlur={() => { if (improveWeeks < 1) setImproveWeeks(1); else if (improveWeeks > 52) setImproveWeeks(52); }}
                  placeholder="e.g. 4" className="bg-background border-border w-32" />
                <p className="text-xs text-muted-foreground">How many weeks? (1–52)</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setImproveDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleGeneratePlan} className="gap-2"><CalendarDays className="w-4 h-4" />Generate Study Plan</Button>
            </DialogFooter>
          </>)}

          {improveStep === "generating" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Generating your study plan...</p>
                <p className="text-xs text-muted-foreground mt-1">Creating a {improveWeeks}-week plan for "{improveTopic}"</p>
              </div>
            </div>
          )}

          {improveStep === "plan" && generatedPlan && (<>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CalendarDays className="w-5 h-5 text-primary" />{generatedPlan.title}</DialogTitle>
              <DialogDescription>Your improvement plan is ready! Review and save it as a goal.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs border-primary/30 text-primary bg-primary/10">{generatedPlan.weeks.length} weeks</Badge>
                <Badge variant="outline" className="text-xs border-border text-muted-foreground">{generatedPlan.start_date} → {generatedPlan.end_date}</Badge>
                {(() => { const h = generatedPlan.weeks.reduce((s, w) => s + (w.estimate_hours || 0), 0); return h > 0 ? <Badge variant="outline" className="text-xs border-border text-muted-foreground"><Clock className="w-3 h-3 mr-1" />~{h}h total</Badge> : null; })()}
              </div>
              {generatedPlan.summary && <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3">{generatedPlan.summary}</p>}
              <div className="space-y-2">
                {generatedPlan.weeks.map(week => (
                  <div key={week.week_number} className="border border-border rounded-xl overflow-hidden">
                    <button onClick={() => toggleWeek(week.week_number)} className="w-full flex items-center justify-between px-4 py-2.5 bg-secondary/30 hover:bg-secondary/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">Week {week.week_number}</span>
                        <span className="text-xs text-muted-foreground">{week.start_date} – {week.end_date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {week.estimate_hours && <span className="text-xs text-muted-foreground">{week.estimate_hours}h</span>}
                        {expandedWeeks.has(week.week_number) ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
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
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setImproveStep("ask-remove")}>Skip</Button>
              <Button onClick={handleSaveAsGoal} className="gap-2"><Save className="w-4 h-4" />Save as Goal</Button>
            </DialogFooter>
          </>)}

          {improveStep === "saving-goal" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-sm font-medium text-foreground">Saving to your goals...</p>
            </div>
          )}

          {improveStep === "ask-remove" && (<>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-500" />{goalSaved ? "Study plan saved!" : "Study plan created!"}</DialogTitle>
              <DialogDescription>{goalSaved ? `Your plan for "${improveTopic}" has been saved to Goals.` : `Your improvement plan for "${improveTopic}" is ready.`}</DialogDescription>
            </DialogHeader>
            <div className="py-6">
              <div className="bg-secondary/50 rounded-xl p-4 text-center space-y-3">
                <p className="text-sm text-foreground font-medium">Remove "{improveTopic}" from your weak topics?</p>
                <p className="text-xs text-muted-foreground">If you remove it, the next weak topic will take its place.</p>
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => handleRemoveFromWeakTopics(false)}>No, keep it</Button>
              <Button onClick={() => handleRemoveFromWeakTopics(true)} className="gap-2"><CheckCircle2 className="w-4 h-4" />Yes, remove it</Button>
            </DialogFooter>
          </>)}

        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;