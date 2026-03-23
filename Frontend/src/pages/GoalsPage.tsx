import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Check, Bell, Trash2, ChevronDown, ChevronUp, Clock, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/config/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import CelebrationOverlay, { CelebrationVariant } from "@/components/CelebrationOverlay";

const USER_ID = "student-001";

// ── Daily goals localStorage helpers ─────────────────────────────────────────

const DAILY_GOALS_KEY = "studybuddy_daily_goals";

interface StoredDailyGoals {
  date: string; // YYYY-MM-DD
  goals: DailyGoal[];
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadDailyGoals(): DailyGoal[] {
  try {
    const raw = localStorage.getItem(DAILY_GOALS_KEY);
    if (!raw) return [];
    const stored: StoredDailyGoals = JSON.parse(raw);
    if (stored.date !== getTodayStr()) {
      // New day → clear all goals (fresh start)
      saveDailyGoals([]);
      return [];
    }
    return stored.goals;
  } catch {
    return [];
  }
}

function saveDailyGoals(goals: DailyGoal[]) {
  const data: StoredDailyGoals = { date: getTodayStr(), goals };
  localStorage.setItem(DAILY_GOALS_KEY, JSON.stringify(data));
}


// ── Types ────────────────────────────────────────────────────────────────────

interface DailyGoal {
  id: string;
  text: string;
  completed: boolean;
}

interface WeekPlan {
  week_number: number;
  start_date: string;
  end_date: string;
  tasks: string[];
  estimate_hours?: number;
}

interface Reminder {
  enabled: boolean;
  type: "daily" | "weekly" | "custom";
  time?: string;
  days?: string[];
  interval_days?: number;
}

interface GoalItem {
  goal_id: string;
  user_id: string;
  title: string;
  start_date: string;
  end_date: string;
  weekly_plan: WeekPlan[];
  progress: number;
  reminder?: Reminder | null;
  completed_tasks?: Record<string, boolean>;
  created_at: string;
}

// ── Helper: compute progress from completed tasks ────────────────────────────

function computeProgress(
  weeklyPlan: WeekPlan[],
  completedTasks: Record<string, boolean>
): number {
  const total = weeklyPlan.reduce((s, w) => s + w.tasks.length, 0);
  if (total === 0) return 0;
  const done = Object.values(completedTasks).filter(Boolean).length;
  return Math.round((done / total) * 100);
}

// ── Long-term Goal Card ──────────────────────────────────────────────────────

const GoalCard = ({
  goal,
  onDelete,
  onToggleReminder,
  onToggleTask,
}: {
  goal: GoalItem;
  onDelete: (goalId: string) => void;
  onToggleReminder: (goalId: string, enabled: boolean) => void;
  onToggleTask: (goalId: string, taskKey: string, done: boolean) => void;
}) => {
  const [expanded, setExpanded] = useState(false);

  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(goal.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    )
  );

  const totalTasks = goal.weekly_plan.reduce((s, w) => s + w.tasks.length, 0);
  const totalHours = goal.weekly_plan.reduce(
    (s, w) => s + (w.estimate_hours || 0),
    0
  );
  const completedTasks = goal.completed_tasks || {};
  const completedCount = Object.values(completedTasks).filter(Boolean).length;

  const progressColor =
    goal.progress >= 80
      ? "text-green-400"
      : goal.progress >= 50
      ? "text-yellow-400"
      : "text-primary";

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <h3 className="text-sm font-semibold text-foreground">
              {goal.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="text-xs border-border text-muted-foreground"
              >
                <CalendarDays className="w-3 h-3 mr-1" />
                {goal.start_date} → {goal.end_date}
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs ${
                  daysLeft <= 7
                    ? "border-red-500/30 text-red-400 bg-red-500/10"
                    : "border-border text-muted-foreground"
                }`}
              >
                <Clock className="w-3 h-3 mr-1" />
                {daysLeft} days left
              </Badge>
              {totalHours > 0 && (
                <Badge
                  variant="outline"
                  className="text-xs border-border text-muted-foreground"
                >
                  ~{totalHours}h total
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
              onClick={() => onToggleReminder(goal.goal_id, true)}
              title="Send reminder email"
            >
              <Bell className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
              onClick={() => onDelete(goal.goal_id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">
              Progress ({completedCount}/{totalTasks} tasks)
            </span>
            <span className={`text-xs font-medium ${progressColor}`}>
              {goal.progress}%
            </span>
          </div>
          <Progress
            value={goal.progress}
            className="h-2 bg-secondary [&>div]:bg-primary"
          />
        </div>

        {/* Expandable weekly plan with checkboxes */}
        {goal.weekly_plan.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              className="w-full text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" /> Hide weekly plan
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" /> Show weekly plan (
                  {goal.weekly_plan.length} weeks, {totalTasks} tasks)
                </>
              )}
            </Button>

            {expanded && (
              <div className="space-y-2">
                {goal.weekly_plan.map((week) => (
                  <div
                    key={week.week_number}
                    className="border border-border rounded-xl p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Week {week.week_number}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {week.start_date} – {week.end_date}
                        {week.estimate_hours
                          ? ` · ${week.estimate_hours}h`
                          : ""}
                      </span>
                    </div>
                    {week.tasks.map((task, i) => {
                      const taskKey = `${week.week_number}-${i}`;
                      const isDone = !!completedTasks[taskKey];
                      return (
                        <div key={i} className="flex items-start gap-2">
                          <Checkbox
                            checked={isDone}
                            onCheckedChange={(checked) =>
                              onToggleTask(
                                goal.goal_id,
                                taskKey,
                                !!checked
                              )
                            }
                            className="mt-0.5 border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                          <span
                            className={`text-xs ${
                              isDone
                                ? "line-through text-muted-foreground"
                                : "text-foreground"
                            }`}
                          >
                            {task}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

// ── Main Page ────────────────────────────────────────────────────────────────

const GoalsPage = () => {
  // Daily goals (localStorage-backed)
  const [dailyGoals, setDailyGoals] = useState<DailyGoal[]>(loadDailyGoals);
  const [newGoal, setNewGoal] = useState("");

  // Long-term goals (from backend)
  const [longTermGoals, setLongTermGoals] = useState<GoalItem[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(false);

  // Celebration overlay state
  const [celebrationVariant, setCelebrationVariant] = useState<CelebrationVariant>("daily_goal");
  const [showCelebration, setShowCelebration] = useState(false);
  const longTermCelebFiredRef = useRef<Set<string>>(new Set());

  // Manual goal creation dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    start_date: getTodayStr(),
    end_date: "",
    numWeeks: 1,
    weeklyTasks: [[""]] as string[][],  // array of weeks, each an array of task strings
  });
  const [isCreating, setIsCreating] = useState(false);

  // Persist daily goals to localStorage whenever they change
  useEffect(() => {
    saveDailyGoals(dailyGoals);
    // Tell the backend the user is active and their daily goal status
    // (used by the 9 PM notification scheduler)
    const total = dailyGoals.length;
    const done  = dailyGoals.filter((g) => g.completed).length;
    fetch(`${API_BASE}/notifications/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, daily_goals_total: total, daily_goals_done: done }),
    }).catch(() => {/* non-critical, ignore errors */});
  }, [dailyGoals]);

  // Midnight reset check — runs every minute
  // At midnight: all previous day's goals are cleared (empty slate for the new day)
  useEffect(() => {
    const interval = setInterval(() => {
      const stored = localStorage.getItem(DAILY_GOALS_KEY);
      if (stored) {
        try {
          const data: StoredDailyGoals = JSON.parse(stored);
          if (data.date !== getTodayStr()) {
            // New day — wipe the list entirely so the user starts fresh
            const empty: DailyGoal[] = [];
            saveDailyGoals(empty);
            setDailyGoals(empty);
            toast.info("It's a new day! Your daily goals have been cleared. Add new ones for today 🌅");
          }
        } catch {
          /* ignore */
        }
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // ── Fetch long-term goals ─────────────────────────────────────────────────

  const fetchGoals = useCallback(async () => {
    setLoadingGoals(true);
    try {
      const resp = await fetch(`${API_BASE}/goals/?user_id=${USER_ID}`);
      if (!resp.ok) throw new Error("Failed to fetch goals");
      const data = await resp.json();
      setLongTermGoals(data.goals || []);
    } catch (err: any) {
      console.error("Failed to fetch goals:", err);
    } finally {
      setLoadingGoals(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  // ── Daily goal handlers ───────────────────────────────────────────────────

  const toggleDaily = (id: string) => {
    setDailyGoals((prev) => {
      const updated = prev.map((g) => (g.id === id ? { ...g, completed: !g.completed } : g));
      // Fire celebration if this toggle just completed the last remaining goal
      const justCompleted = updated.find(g => g.id === id)?.completed;
      const allDone = updated.length > 0 && updated.every(g => g.completed);
      if (justCompleted && allDone) {
        setTimeout(() => {
          setCelebrationVariant("daily_goal");
          setShowCelebration(true);
        }, 350);
      }
      return updated;
    });
  };

  const addDailyGoal = () => {
    if (!newGoal.trim()) return;
    setDailyGoals((prev) => [
      ...prev,
      { id: Date.now().toString(), text: newGoal, completed: false },
    ]);
    setNewGoal("");
    toast.success("Goal added!");
  };

  // ── Long-term goal handlers (optimistic UI) ──────────────────────────────

  const handleDeleteGoal = async (goalId: string) => {
    // Optimistic: remove immediately
    const prev = longTermGoals;
    setLongTermGoals((g) => g.filter((goal) => goal.goal_id !== goalId));

    try {
      const resp = await fetch(
        `${API_BASE}/goals/${goalId}?user_id=${USER_ID}`,
        { method: "DELETE" }
      );
      if (!resp.ok && resp.status !== 204) {
        throw new Error("Delete failed");
      }
      toast.success("Goal deleted");
    } catch (err: any) {
      // Revert on failure
      setLongTermGoals(prev);
      toast.error(`Could not delete goal: ${err.message}`);
    }
  };

  const handleToggleReminder = async (goalId: string, enabled: boolean) => {
    if (!enabled) return; // only act on unchecked → checked

    // Show sending state
    toast.info("Sending reminder email...");

    try {
      const resp = await fetch(
        `${API_BASE}/goals/${goalId}/send_reminder?user_id=${USER_ID}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "student@studybuddy.demo" }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Send failed");
      }

      toast.success("Reminder email sent!");
    } catch (err: any) {
      toast.error(`Could not send reminder: ${err.message}`);
    }
    // Reminder stays unchecked (we don't toggle state — it's a one-shot action)
  };

  const handleToggleTask = async (
    goalId: string,
    taskKey: string,
    done: boolean
  ) => {
    // Optimistic update: toggle task, recompute progress
    setLongTermGoals((prev) =>
      prev.map((g) => {
        if (g.goal_id !== goalId) return g;
        const newCompleted = { ...(g.completed_tasks || {}), [taskKey]: done };
        if (!done) delete newCompleted[taskKey];
        const newProgress = computeProgress(g.weekly_plan, newCompleted);

        // Fire celebration exactly once when this goal first reaches 100%
        if (newProgress === 100 && !longTermCelebFiredRef.current.has(goalId)) {
          longTermCelebFiredRef.current.add(goalId);
          setTimeout(() => {
            setCelebrationVariant("long_term_goal");
            setShowCelebration(true);
          }, 350);
        }

        return { ...g, completed_tasks: newCompleted, progress: newProgress };
      })
    );

    // Sync to backend in background
    const goal = longTermGoals.find((g) => g.goal_id === goalId);
    if (!goal) return;

    const newCompleted = { ...(goal.completed_tasks || {}), [taskKey]: done };
    if (!done) delete newCompleted[taskKey];
    const newProgress = computeProgress(goal.weekly_plan, newCompleted);

    try {
      await fetch(`${API_BASE}/goals/${goalId}?user_id=${USER_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed_tasks: newCompleted,
          progress: newProgress,
        }),
      });
    } catch {
      console.error("Failed to sync task completion to backend");
    }
  };

  // ── Manual goal creation ──────────────────────────────────────────────────

  const handleCreateGoal = async () => {
    if (!createForm.title.trim() || !createForm.end_date.trim()) {
      toast.error("Please provide a title and end date.");
      return;
    }

    setIsCreating(true);
    try {
      // Build weekly_plan from per-week tasks
      const startDate = new Date(createForm.start_date);
      const weeklyPlan = createForm.weeklyTasks.map((tasks, idx) => {
        const weekStart = new Date(startDate);
        weekStart.setDate(weekStart.getDate() + idx * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const filteredTasks = tasks.map((t) => t.trim()).filter(Boolean);
        return {
          week_number: idx + 1,
          start_date: weekStart.toISOString().slice(0, 10),
          end_date: weekEnd.toISOString().slice(0, 10),
          tasks: filteredTasks.length > 0 ? filteredTasks : ["No tasks defined"],
          estimate_hours: null,
        };
      });

      const resp = await fetch(`${API_BASE}/goals/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          title: createForm.title.trim(),
          start_date: createForm.start_date,
          end_date: createForm.end_date,
          weekly_plan: weeklyPlan,
          progress: 0,
          reminder: null,
        }),
      });

      if (!resp.ok) throw new Error("Failed to create goal");
      const newGoalData = await resp.json();
      setLongTermGoals((prev) => [...prev, newGoalData]);
      setShowCreateDialog(false);
      setCreateForm({
        title: "",
        start_date: getTodayStr(),
        end_date: "",
        numWeeks: 1,
        weeklyTasks: [[""]],
      });
      toast.success("Goal created!");
    } catch (err: any) {
      toast.error(`Could not create goal: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const completedCount = dailyGoals.filter((g) => g.completed).length;

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">
      {/* Celebration overlay — fires on daily all-done or long-term 100% */}
      <CelebrationOverlay
        show={showCelebration}
        variant={celebrationVariant}
        onClose={() => setShowCelebration(false)}
      />

      <div>
        <h1 className="text-2xl font-bold text-foreground">Goals</h1>
        <p className="text-muted-foreground mt-1">
          Stay on track with daily and long-term learning goals.
        </p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger
            value="daily"
            className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
          >
            Daily Goals
          </TabsTrigger>
          <TabsTrigger
            value="longterm"
            className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
          >
            Long Term Goals
            {longTermGoals.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">
                {longTermGoals.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Daily tab ──────────────────────────────────────────────────────── */}
        <TabsContent value="daily" className="mt-4 space-y-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  Today's Progress
                </span>
                <span className="text-sm font-medium text-primary">
                  {completedCount}/{dailyGoals.length} completed
                </span>
              </div>
              <Progress
                value={
                  (completedCount / Math.max(dailyGoals.length, 1)) * 100
                }
                className="h-2 bg-secondary [&>div]:bg-primary"
              />
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Input
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDailyGoal()}
              placeholder="Add a new daily goal..."
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
            <Button
              onClick={addDailyGoal}
              size="icon"
              className="shrink-0 bg-primary hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {dailyGoals.map((goal) => (
              <Card
                key={goal.id}
                className={`bg-card border-border transition-all ${
                  goal.completed ? "opacity-60" : ""
                }`}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <Checkbox
                    checked={goal.completed}
                    onCheckedChange={() => toggleDaily(goal.id)}
                    className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span
                    className={`text-sm flex-1 ${
                      goal.completed
                        ? "line-through text-muted-foreground"
                        : "text-foreground"
                    }`}
                  >
                    {goal.text}
                  </span>
                  {goal.completed && (
                    <Check className="w-4 h-4 text-success" />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Long Term tab ──────────────────────────────────────────────────── */}
        <TabsContent value="longterm" className="mt-4 space-y-4">
          {/* Add goal button */}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setShowCreateDialog(true)}
              className="gap-1.5 bg-primary hover:bg-primary/90 text-xs"
            >
              <Plus className="w-3.5 h-3.5" /> Add Goal
            </Button>
          </div>

          {loadingGoals ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-4 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="h-5 w-48 bg-secondary/60 rounded-lg" />
                    <div className="flex gap-2">
                      <div className="h-7 w-7 bg-secondary/40 rounded-lg" />
                      <div className="h-7 w-7 bg-secondary/40 rounded-lg" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-5 w-32 bg-secondary/40 rounded-full" />
                    <div className="h-5 w-24 bg-secondary/40 rounded-full" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <div className="h-3 w-28 bg-secondary/40 rounded" />
                      <div className="h-3 w-8 bg-secondary/60 rounded" />
                    </div>
                    <div className="h-2 w-full bg-secondary/40 rounded-full" />
                  </div>
                  <div className="h-8 w-48 bg-secondary/30 rounded-xl mx-auto" />
                </div>
              ))}
            </div>
          ) : longTermGoals.length === 0 ? (
            <Card className="bg-card border-border border-dashed">
              <CardContent className="p-8 text-center space-y-3">
                <CalendarDays className="w-10 h-10 text-muted-foreground mx-auto" />
                <h3 className="text-sm font-semibold text-foreground">
                  No long-term goals yet
                </h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Click "Add Goal" above to create one manually, or generate a
                  study plan from the Chat page and save it as a goal.
                </p>
              </CardContent>
            </Card>
          ) : (
            longTermGoals.map((goal) => (
              <GoalCard
                key={goal.goal_id}
                goal={goal}
                onDelete={handleDeleteGoal}
                onToggleReminder={handleToggleReminder}
                onToggleTask={handleToggleTask}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* ── Create Goal Dialog ────────────────────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Create Long Term Goal
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a goal with weekly tasks to track your progress.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Title *
              </label>
              <Input
                value={createForm.title}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. Learn React fundamentals"
                className="bg-secondary border-border text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={createForm.start_date}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      start_date: e.target.value,
                    }))
                  }
                  className="bg-secondary border-border text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  End Date *
                </label>
                <Input
                  type="date"
                  value={createForm.end_date}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      end_date: e.target.value,
                    }))
                  }
                  className="bg-secondary border-border text-foreground"
                />
              </div>
            </div>

            {/* Number of weeks */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Number of Weeks
              </label>
              <Input
                type="number"
                min={1}
                max={52}
                value={createForm.numWeeks === 0 ? "" : createForm.numWeeks}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setCreateForm((f) => ({ ...f, numWeeks: 0 }));
                    return;
                  }
                  const n = parseInt(raw);
                  if (isNaN(n)) return;
                  setCreateForm((f) => {
                    const newWeeklyTasks = [...f.weeklyTasks];
                    const clamped = Math.max(0, Math.min(52, n));
                    while (newWeeklyTasks.length < clamped) newWeeklyTasks.push([""]);
                    while (newWeeklyTasks.length > clamped) newWeeklyTasks.pop();
                    return { ...f, numWeeks: clamped, weeklyTasks: newWeeklyTasks };
                  });
                }}
                onBlur={() => {
                  setCreateForm((f) => {
                    const n = f.numWeeks < 1 ? 1 : f.numWeeks > 52 ? 52 : f.numWeeks;
                    const newWeeklyTasks = [...f.weeklyTasks];
                    while (newWeeklyTasks.length < n) newWeeklyTasks.push([""]);
                    while (newWeeklyTasks.length > n) newWeeklyTasks.pop();
                    return { ...f, numWeeks: n, weeklyTasks: newWeeklyTasks };
                  });
                }}
                className="bg-secondary border-border text-foreground w-24"
              />
            </div>

            {/* Per-week task entry */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-foreground">
                Weekly Tasks
              </label>
              {createForm.weeklyTasks.map((tasks, weekIdx) => (
                <div
                  key={weekIdx}
                  className="border border-border rounded-lg p-3 space-y-2"
                >
                  <span className="text-xs font-semibold text-foreground">
                    Week {weekIdx + 1}
                  </span>
                  {tasks.map((task, taskIdx) => (
                    <div key={taskIdx} className="flex gap-2 items-center">
                      <Input
                        value={task}
                        onChange={(e) => {
                          setCreateForm((f) => {
                            const updated = f.weeklyTasks.map((w, wi) =>
                              wi === weekIdx
                                ? w.map((t, ti) =>
                                    ti === taskIdx ? e.target.value : t
                                  )
                                : w
                            );
                            return { ...f, weeklyTasks: updated };
                          });
                        }}
                        placeholder={`Task ${taskIdx + 1}`}
                        className="bg-secondary border-border text-foreground text-xs"
                      />
                      {tasks.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                          onClick={() => {
                            setCreateForm((f) => {
                              const updated = f.weeklyTasks.map((w, wi) =>
                                wi === weekIdx
                                  ? w.filter((_, ti) => ti !== taskIdx)
                                  : w
                              );
                              return { ...f, weeklyTasks: updated };
                            });
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1"
                    onClick={() => {
                      setCreateForm((f) => {
                        const updated = f.weeklyTasks.map((w, wi) =>
                          wi === weekIdx ? [...w, ""] : w
                        );
                        return { ...f, weeklyTasks: updated };
                      });
                    }}
                  >
                    <Plus className="w-3 h-3" /> Add task
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateGoal}
              disabled={isCreating}
              className="bg-primary hover:bg-primary/90"
            >
              {isCreating ? "Creating..." : "Create Goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GoalsPage;