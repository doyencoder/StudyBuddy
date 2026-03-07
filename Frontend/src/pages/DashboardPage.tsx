import { useState, useEffect, useMemo } from "react";
import { BookOpen, Brain, Target, TrendingUp, MessageSquare, ClipboardList, AlertTriangle, CalendarDays, ChevronDown, ChevronUp, Clock, Save, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

const USER_ID = "student-001";
const API_BASE = "http://localhost:8000";

// ── Types for study plan ────────────────────────────────────────────────────

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

interface QuizHistoryItem {
  quiz_id: string;
  topic: string;
  created_at: string;
  submitted: boolean;
  score?: number;
  correct_count?: number;
  total_questions: number;
  weak_areas: string[];
}

// ── Dialog step type ────────────────────────────────────────────────────────
type ImproveStep = "input" | "generating" | "plan" | "saving-goal" | "ask-remove" | "done";

const DashboardPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [quizzes, setQuizzes] = useState<QuizHistoryItem[]>([]);
  const [displayName, setDisplayName] = useState("");

  // ── Improve dialog state ──────────────────────────────────────────────────
  const [improveDialogOpen, setImproveDialogOpen] = useState(false);
  const [improveStep, setImproveStep] = useState<ImproveStep>("input");
  const [improveTopic, setImproveTopic] = useState("");
  const [improveWeeks, setImproveWeeks] = useState(4);
  const [generatedPlan, setGeneratedPlan] = useState<StudyPlanData | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([1]));
  const [goalSaved, setGoalSaved] = useState(false);
  const [dismissedTopics, setDismissedTopics] = useState<string[]>([]);

  // ── Fetch dismissed topics ────────────────────────────────────────────────
  useEffect(() => {
    const fetchDismissed = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings/dismissed-weak-topics?user_id=${USER_ID}`);
        if (res.ok) {
          const data = await res.json();
          setDismissedTopics(data.dismissed_topics || []);
        }
      } catch {
        // silently ignore
      }
    };
    fetchDismissed();
  }, []);

  // ── Improve dialog handlers ───────────────────────────────────────────────
  const openImproveDialog = (topic: string) => {
    setImproveTopic(topic);
    setImproveWeeks(4);
    setImproveStep("input");
    setGeneratedPlan(null);
    setGoalSaved(false);
    setExpandedWeeks(new Set([1]));
    setImproveDialogOpen(true);
  };

  const handleGeneratePlan = async () => {
    if (!improveTopic.trim()) {
      toast.error("Please enter a topic.");
      return;
    }
    if (improveWeeks < 1 || improveWeeks > 52) {
      toast.error("Weeks must be between 1 and 52.");
      return;
    }
    setImproveStep("generating");
    try {
      const res = await fetch(`${API_BASE}/study_plans/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          conversation_id: null,
          topic: improveTopic.trim(),
          timeline_weeks: improveWeeks,
          preferences: { hours_per_week: 8, focus_days: null },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to generate study plan");
      }
      const plan: StudyPlanData = await res.json();
      setGeneratedPlan(plan);
      setImproveStep("plan");
    } catch (err: any) {
      toast.error(`Failed to generate plan: ${err.message}`);
      setImproveStep("input");
    }
  };

  const handleSaveAsGoal = async () => {
    if (!generatedPlan) return;
    setImproveStep("saving-goal");
    try {
      const resp = await fetch(`${API_BASE}/goals/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          title: generatedPlan.title,
          start_date: generatedPlan.start_date,
          end_date: generatedPlan.end_date,
          weekly_plan: generatedPlan.weeks,
          progress: 0,
          reminder: null,
        }),
      });
      if (!resp.ok) throw new Error("Failed to save goal");
      setGoalSaved(true);
      toast.success("Study plan saved as a goal!");
      setImproveStep("ask-remove");
    } catch (err: any) {
      toast.error(`Could not save goal: ${err.message}`);
      setImproveStep("plan");
    }
  };

  const handleSkipSaveGoal = () => {
    setImproveStep("ask-remove");
  };

  const handleRemoveFromWeakTopics = async (shouldRemove: boolean) => {
    if (shouldRemove) {
      try {
        await fetch(`${API_BASE}/settings/dismissed-weak-topics?user_id=${USER_ID}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: improveTopic.trim() }),
        });
        setDismissedTopics((prev) => [...prev, improveTopic.trim()]);
        toast.success("Topic removed from weak topics!");
      } catch {
        toast.error("Failed to dismiss topic.");
      }
    }
    setImproveStep("done");
    setImproveDialogOpen(false);
  };

  const toggleWeek = (weekNum: number) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekNum)) next.delete(weekNum);
      else next.add(weekNum);
      return next;
    });
  };

  // ── Fetch display name from settings ──────────────────────────────────────
  useEffect(() => {
    const fetchDisplayName = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`);
        if (res.ok) {
          const data = await res.json();
          setDisplayName(data.profile?.display_name || "");
        }
      } catch {
        // silently ignore – displayName stays blank
      }
    };
    fetchDisplayName();
  }, []);

  // ── Fetch quiz history on mount ───────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_BASE}/quiz/history?user_id=${USER_ID}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setQuizzes(data.quizzes || []);
      } catch {
        toast.error("Could not load dashboard data. Is the backend running?");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Only quizzes that were actually submitted and have a score
  const submittedQuizzes = useMemo(
    () => quizzes.filter((q) => q.submitted && q.score !== undefined),
    [quizzes]
  );

  const hasData = submittedQuizzes.length > 0;

  // ── Stat: total quizzes ───────────────────────────────────────────────────
  const totalQuizzes = quizzes.length;

  // ── Stat: average score ───────────────────────────────────────────────────
  const avgScore = useMemo(() => {
    if (!submittedQuizzes.length) return 0;
    const sum = submittedQuizzes.reduce((acc, q) => acc + (q.score ?? 0), 0);
    return Math.round(sum / submittedQuizzes.length);
  }, [submittedQuizzes]);

  // ── Stat: unique topics studied ───────────────────────────────────────────
  const uniqueTopics = useMemo(
    () => new Set(quizzes.map((q) => q.topic)).size,
    [quizzes]
  );

  // ── Stat: study streak (consecutive days with quiz activity) ──────────────
  const studyStreak = useMemo(() => {
    if (!quizzes.length) return 0;
    const days = new Set(
      quizzes.map((q) => new Date(q.created_at).toISOString().split("T")[0])
    );
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().split("T")[0];
      if (days.has(key)) {
        streak++;
      } else if (i > 0) {
        break; // gap in days → streak ends
      }
    }
    return streak;
  }, [quizzes]);

  // ── Change labels for stat cards ──────────────────────────────────────────
  const thisWeekCount = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return quizzes.filter((q) => new Date(q.created_at) >= weekAgo).length;
  }, [quizzes]);

  const scoreChangeText = useMemo(() => {
    if (submittedQuizzes.length < 2) return "Keep taking quizzes!";
    const sorted = [...submittedQuizzes].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const half = Math.floor(sorted.length / 2);
    const olderAvg =
      sorted.slice(0, half).reduce((s, q) => s + (q.score ?? 0), 0) / half;
    const newerAvg =
      sorted.slice(half).reduce((s, q) => s + (q.score ?? 0), 0) /
      (sorted.length - half);
    const diff = Math.round(newerAvg - olderAvg);
    if (diff > 0) return `+${diff}% improvement`;
    if (diff < 0) return `${diff}% change`;
    return "Holding steady";
  }, [submittedQuizzes]);

  // ── Stat cards array ──────────────────────────────────────────────────────
  const stats = useMemo(
    () => [
      {
        label: "Quizzes Taken",
        value: totalQuizzes.toString(),
        icon: ClipboardList,
        change:
          thisWeekCount > 0 ? `+${thisWeekCount} this week` : "None this week",
      },
      {
        label: "Avg. Score",
        value: `${avgScore}%`,
        icon: TrendingUp,
        change: scoreChangeText,
      },
      {
        label: "Topics Studied",
        value: uniqueTopics.toString(),
        icon: BookOpen,
        change:
          uniqueTopics > 0 ? `${uniqueTopics} unique topics` : "No topics yet",
      },
      {
        label: "Study Streak",
        value: `${studyStreak} day${studyStreak !== 1 ? "s" : ""}`,
        icon: Target,
        change:
          studyStreak >= 7
            ? "Personal best!"
            : studyStreak > 0
            ? "Keep it up!"
            : "Start today!",
      },
    ],
    [totalQuizzes, avgScore, uniqueTopics, studyStreak, thisWeekCount, scoreChangeText]
  );

  // ── Recent topics: most recent quiz per unique topic ──────────────────────
  const recentTopics = useMemo(() => {
    const sorted = [...submittedQuizzes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const seen = new Map<string, QuizHistoryItem>();
    for (const q of sorted) {
      if (!seen.has(q.topic)) seen.set(q.topic, q);
    }
    return Array.from(seen.values())
      .slice(0, 4)
      .map((q) => ({
        topic: q.topic,
        accuracy: q.score ?? 0,
        status: (q.score ?? 0) >= 70 ? "strong" : "weak",
      }));
  }, [submittedQuizzes]);

  // ── Score over time: last 7 submitted quizzes by date ────────────────────
  const scoreData = useMemo(() => {
    return [...submittedQuizzes]
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      .slice(-7)
      .map((q) => ({
        date: new Date(q.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        score: q.score ?? 0,
      }));
  }, [submittedQuizzes]);

  // ── Topic performance: avg score per topic, top 5 ────────────────────────
  const topicData = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const q of submittedQuizzes) {
      if (!map.has(q.topic)) map.set(q.topic, []);
      map.get(q.topic)!.push(q.score ?? 0);
    }
    return Array.from(map.entries())
      .map(([topic, scores]) => ({
        topic,
        score: Math.round(
          scores.reduce((a, b) => a + b, 0) / scores.length
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [submittedQuizzes]);

  // ── Weak topics: topics with avg score < 70%, worst first ────────────────
  const weakTopics = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const q of submittedQuizzes) {
      if (!map.has(q.topic)) map.set(q.topic, []);
      map.get(q.topic)!.push(q.score ?? 0);
    }
    return Array.from(map.entries())
      .map(([topic, scores]) => ({
        topic,
        accuracy: Math.round(
          scores.reduce((a, b) => a + b, 0) / scores.length
        ),
      }))
      .filter((t) => t.accuracy < 70 && !dismissedTopics.includes(t.topic))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  }, [submittedQuizzes, dismissedTopics]);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 overflow-y-auto h-full">
        {/* Header skeleton */}
        <div className="space-y-2">
          <div className="h-8 w-64 bg-secondary/60 rounded-xl animate-pulse" />
          <div className="h-4 w-48 bg-secondary/40 rounded-lg animate-pulse" />
        </div>
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="h-3 w-24 bg-secondary/60 rounded" />
              <div className="h-8 w-16 bg-secondary/80 rounded-lg" />
              <div className="h-3 w-20 bg-secondary/40 rounded" />
            </div>
          ))}
        </div>
        {/* Quick actions + recent quizzes skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4 animate-pulse">
            <div className="h-5 w-32 bg-secondary/60 rounded-lg" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 w-full bg-secondary/40 rounded-xl" />
            ))}
          </div>
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4 animate-pulse">
            <div className="h-5 w-32 bg-secondary/60 rounded-lg" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="h-4 w-32 bg-secondary/40 rounded" />
                <div className="h-4 w-12 bg-secondary/60 rounded" />
              </div>
            ))}
          </div>
        </div>
        {/* Charts skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="h-5 w-36 bg-secondary/60 rounded-lg" />
              <div className="h-[250px] w-full bg-secondary/30 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  // ── Empty state component for charts ─────────────────────────────────────
  const EmptyChartState = () => (
    <div className="flex flex-col items-center justify-center h-[250px] gap-3 text-center">
      <Brain className="w-10 h-10 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No quiz data yet.</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => navigate("/chat")}
        className="text-primary border-primary/30 hover:bg-primary/10"
      >
        Take your first quiz
      </Button>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Welcome back{displayName ? `, ${displayName}` : ""}! 👋</h1>
        <p className="text-muted-foreground mt-1">
          Here's your learning progress at a glance.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="bg-card border-border hover:border-glow transition-all duration-300"
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">
                    {stat.value}
                  </p>
                  <p className="text-xs text-primary mt-1">{stat.change}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                  <stat.icon className="w-5 h-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions + Recent Topics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base text-foreground">
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Start a Chat", icon: MessageSquare, path: "/chat" },
              { label: "Take a Quiz", icon: ClipboardList, path: "/chat" },
              { label: "Set Goals", icon: Target, path: "/goals" },
            ].map((action) => (
              <Button
                key={action.label}
                variant="ghost"
                onClick={() => {
                  if (action.label === "Take a Quiz") {
                    navigate("/chat", { state: { prefillInput: "Generate Quiz for: " } });
                  } else {
                    navigate(action.path);
                  }
                }}
                className="w-full justify-start gap-3 text-foreground hover:bg-primary/10 hover:text-primary h-11"
              >
                <action.icon className="w-4 h-4" />
                {action.label}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base text-foreground">
              Recent Quizzes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentTopics.length > 0 ? (
              recentTopics.map((topic) => (
                <div
                  key={topic.topic}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50"
                >
                  <div className="flex items-center gap-3">
                    <Brain className="w-4 h-4 text-primary" />
                    <span className="text-sm text-foreground">{topic.topic}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {topic.accuracy}%
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        topic.status === "strong"
                          ? "bg-success/15 text-success"
                          : "bg-warning/15 text-warning"
                      }`}
                    >
                      {topic.status}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <Brain className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No topics studied yet.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("/chat")}
                  className="text-primary hover:bg-primary/10"
                >
                  Start learning →
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base text-foreground">
              Score Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasData ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={scoreData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(230 15% 16%)"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }}
                    stroke="hsl(230 15% 16%)"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }}
                    stroke="hsl(230 15% 16%)"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(230 15% 10%)",
                      border: "1px solid hsl(230 15% 16%)",
                      borderRadius: 8,
                      color: "hsl(220 20% 92%)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(217 91% 60%)"
                    strokeWidth={2}
                    dot={{ fill: "hsl(217 91% 60%)", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState />
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base text-foreground">
              Topic Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasData ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topicData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(230 15% 16%)"
                  />
                  <XAxis
                    dataKey="topic"
                    tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }}
                    stroke="hsl(230 15% 16%)"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }}
                    stroke="hsl(230 15% 16%)"
                  />
                  <Tooltip
                    cursor={false}
                    contentStyle={{
                      background: "hsl(230 15% 10%)",
                      border: "1px solid hsl(230 15% 16%)",
                      borderRadius: 8,
                      color: "hsl(220 20% 92%)",
                    }}
                  />
                  <Bar
                    dataKey="score"
                    fill="hsl(217 91% 60%)"
                    radius={[6, 6, 0, 0]}
                    cursor="default"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weak Topics */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Weak Topics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {weakTopics.length > 0 ? (
            weakTopics.map((topic) => (
              <div
                key={topic.topic}
                className="flex items-center gap-4 p-3 rounded-lg bg-secondary/50"
              >
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">
                      {topic.topic}
                    </span>
                    <span className="text-sm text-warning font-medium">
                      {topic.accuracy}%
                    </span>
                  </div>
                  <Progress
                    value={topic.accuracy}
                    className="h-1.5 bg-secondary [&>div]:bg-warning"
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-primary hover:bg-primary/10 shrink-0"
                  onClick={() => openImproveDialog(topic.topic)}
                >
                  Improve
                </Button>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <Target className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {hasData
                  ? "No weak topics — great job! 🎉"
                  : "Complete quizzes to see your weak areas."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Improve Weak Topic Dialog ──────────────────────────────────────── */}
      <Dialog open={improveDialogOpen} onOpenChange={(open) => {
        if (!open && improveStep !== "generating" && improveStep !== "saving-goal") {
          setImproveDialogOpen(false);
        }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          {/* Step 1: Input topic & weeks */}
          {improveStep === "input" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Create Improvement Plan
                </DialogTitle>
                <DialogDescription>
                  Generate a study plan to strengthen your weak topic. You can edit the topic and choose the duration.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="improve-topic">Topic</Label>
                  <Input
                    id="improve-topic"
                    value={improveTopic}
                    onChange={(e) => setImproveTopic(e.target.value)}
                    placeholder="Enter the topic you want to improve"
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="improve-weeks">Number of weeks</Label>
                  <Input
                    id="improve-weeks"
                    type="number"
                    min={1}
                    max={52}
                    value={improveWeeks === 0 ? "" : improveWeeks}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") { setImproveWeeks(0); return; }
                      const n = parseInt(raw);
                      if (!isNaN(n)) setImproveWeeks(n);
                    }}
                    onBlur={() => {
                      if (improveWeeks < 1) setImproveWeeks(1);
                      else if (improveWeeks > 52) setImproveWeeks(52);
                    }}
                    placeholder="e.g. 4"
                    className="bg-background border-border w-32"
                  />
                  <p className="text-xs text-muted-foreground">
                    How many weeks should the study plan cover? (1–52)
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImproveDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleGeneratePlan} className="gap-2">
                  <CalendarDays className="w-4 h-4" />
                  Generate Study Plan
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Step 2: Generating spinner */}
          {improveStep === "generating" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Generating your study plan...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Creating a {improveWeeks}-week plan for "{improveTopic}"
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Show generated plan */}
          {improveStep === "plan" && generatedPlan && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-primary" />
                  {generatedPlan.title}
                </DialogTitle>
                <DialogDescription>
                  Your improvement plan is ready! Review it below and save it as a goal.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* Overview badges */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary bg-primary/10">
                    {generatedPlan.weeks.length} weeks
                  </Badge>
                  <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                    {generatedPlan.start_date} → {generatedPlan.end_date}
                  </Badge>
                  {(() => {
                    const totalH = generatedPlan.weeks.reduce((s, w) => s + (w.estimate_hours || 0), 0);
                    return totalH > 0 ? (
                      <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                        <Clock className="w-3 h-3 mr-1" />
                        ~{totalH}h total
                      </Badge>
                    ) : null;
                  })()}
                </div>

                {/* Summary */}
                {generatedPlan.summary && (
                  <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3">
                    {generatedPlan.summary}
                  </p>
                )}

                {/* Weekly breakdown */}
                <div className="space-y-2">
                  {generatedPlan.weeks.map((week) => (
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
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={handleSkipSaveGoal} className="gap-2">
                  Skip
                </Button>
                <Button onClick={handleSaveAsGoal} className="gap-2">
                  <Save className="w-4 h-4" />
                  Save as Goal
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Step 4: Saving goal spinner */}
          {improveStep === "saving-goal" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-sm font-medium text-foreground">Saving to your goals...</p>
            </div>
          )}

          {/* Step 5: Ask to remove from weak topics */}
          {improveStep === "ask-remove" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  {goalSaved ? "Study plan saved!" : "Study plan created!"}
                </DialogTitle>
                <DialogDescription>
                  {goalSaved
                    ? `Your improvement plan for "${improveTopic}" has been saved to your Goals.`
                    : `Your improvement plan for "${improveTopic}" is ready.`
                  }
                </DialogDescription>
              </DialogHeader>
              <div className="py-6">
                <div className="bg-secondary/50 rounded-xl p-4 text-center space-y-3">
                  <p className="text-sm text-foreground font-medium">
                    Would you like to remove "{improveTopic}" from your weak topics?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    If you remove it, the next weak topic will take its place.
                  </p>
                </div>
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => handleRemoveFromWeakTopics(false)}>
                  No, keep it
                </Button>
                <Button onClick={() => handleRemoveFromWeakTopics(true)} className="gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Yes, remove it
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;