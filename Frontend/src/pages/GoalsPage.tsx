import { useState } from "react";
import { Plus, Check, Bell, BellOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface DailyGoal {
  id: string;
  text: string;
  completed: boolean;
}

interface MonthlyGoal {
  id: string;
  text: string;
  progress: number;
  reminder: boolean;
}

const GoalsPage = () => {
  const [dailyGoals, setDailyGoals] = useState<DailyGoal[]>([
    { id: "1", text: "Complete 2 quizzes on Biology", completed: true },
    { id: "2", text: "Review flashcards for Chemistry", completed: false },
    { id: "3", text: "Read chapter 5 of Physics textbook", completed: false },
    { id: "4", text: "Practice 10 Math problems", completed: true },
  ]);

  const [monthlyGoals, setMonthlyGoals] = useState<MonthlyGoal[]>([
    { id: "1", text: "Complete all Biology chapters", progress: 65, reminder: true },
    { id: "2", text: "Score 80%+ on all Physics quizzes", progress: 40, reminder: false },
    { id: "3", text: "Master Organic Chemistry basics", progress: 25, reminder: true },
  ]);

  const [newGoal, setNewGoal] = useState("");

  const toggleDaily = (id: string) => {
    setDailyGoals((prev) => prev.map((g) => (g.id === id ? { ...g, completed: !g.completed } : g)));
  };

  const addDailyGoal = () => {
    if (!newGoal.trim()) return;
    setDailyGoals((prev) => [...prev, { id: Date.now().toString(), text: newGoal, completed: false }]);
    setNewGoal("");
    toast.success("Goal added!");
  };

  const toggleReminder = (id: string) => {
    setMonthlyGoals((prev) =>
      prev.map((g) => {
        if (g.id === id) {
          toast.info(g.reminder ? "Reminder disabled" : "Reminder enabled");
          return { ...g, reminder: !g.reminder };
        }
        return g;
      })
    );
  };

  const completedCount = dailyGoals.filter((g) => g.completed).length;

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Goals</h1>
        <p className="text-muted-foreground mt-1">Stay on track with daily and monthly learning goals.</p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="daily" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            Daily Goals
          </TabsTrigger>
          <TabsTrigger value="monthly" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            Monthly Goals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-4 space-y-4">
          {/* Progress summary */}
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Today's Progress</span>
                <span className="text-sm font-medium text-primary">
                  {completedCount}/{dailyGoals.length} completed
                </span>
              </div>
              <Progress value={(completedCount / dailyGoals.length) * 100} className="h-2 bg-secondary [&>div]:bg-primary" />
            </CardContent>
          </Card>

          {/* Add goal */}
          <div className="flex gap-2">
            <Input
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDailyGoal()}
              placeholder="Add a new daily goal..."
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
            <Button onClick={addDailyGoal} size="icon" className="shrink-0 bg-primary hover:bg-primary/90">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Goals list */}
          <div className="space-y-2">
            {dailyGoals.map((goal) => (
              <Card key={goal.id} className={`bg-card border-border transition-all ${goal.completed ? "opacity-60" : ""}`}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Checkbox
                    checked={goal.completed}
                    onCheckedChange={() => toggleDaily(goal.id)}
                    className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className={`text-sm flex-1 ${goal.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                    {goal.text}
                  </span>
                  {goal.completed && <Check className="w-4 h-4 text-success" />}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="monthly" className="mt-4 space-y-4">
          {monthlyGoals.map((goal) => (
            <Card key={goal.id} className="bg-card border-border">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-foreground">{goal.text}</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={() => toggleReminder(goal.id)}
                  >
                    {goal.reminder ? <Bell className="w-4 h-4 text-primary" /> : <BellOff className="w-4 h-4" />}
                  </Button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Progress</span>
                    <span className="text-xs font-medium text-primary">{goal.progress}%</span>
                  </div>
                  <Progress value={goal.progress} className="h-2 bg-secondary [&>div]:bg-primary" />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GoalsPage;
