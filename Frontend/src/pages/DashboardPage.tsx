import { useState, useEffect, useMemo } from "react";
import { BookOpen, Brain, Target, TrendingUp, MessageSquare, ClipboardList, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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

const DashboardPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [quizzes, setQuizzes] = useState<QuizHistoryItem[]>([]);
  const [displayName, setDisplayName] = useState("");

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
      .filter((t) => t.accuracy < 70)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  }, [submittedQuizzes]);

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
                  onClick={() =>
                    toast.info("Improvement plan generation coming soon!")
                  }
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
    </div>
  );
};

export default DashboardPage;