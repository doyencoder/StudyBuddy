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

const stats = [
  { label: "Quizzes Taken", value: "24", icon: ClipboardList, change: "+3 this week" },
  { label: "Avg. Score", value: "78%", icon: TrendingUp, change: "+5% improvement" },
  { label: "Topics Studied", value: "12", icon: BookOpen, change: "2 new this week" },
  { label: "Study Streak", value: "7 days", icon: Target, change: "Personal best!" },
];

const recentTopics = [
  { topic: "Photosynthesis", accuracy: 85, status: "strong" },
  { topic: "Newton's Laws", accuracy: 62, status: "weak" },
  { topic: "Cell Division", accuracy: 91, status: "strong" },
  { topic: "Thermodynamics", accuracy: 45, status: "weak" },
];

const scoreData = [
  { date: "Week 1", score: 55 },
  { date: "Week 2", score: 62 },
  { date: "Week 3", score: 58 },
  { date: "Week 4", score: 71 },
  { date: "Week 5", score: 75 },
  { date: "Week 6", score: 78 },
  { date: "Week 7", score: 82 },
];

const topicData = [
  { topic: "Biology", score: 85 },
  { topic: "Physics", score: 62 },
  { topic: "Chemistry", score: 74 },
  { topic: "Math", score: 70 },
  { topic: "History", score: 88 },
];

const weakTopics = [
  { topic: "Newton's Laws", accuracy: 45 },
  { topic: "Thermodynamics", accuracy: 50 },
  { topic: "Organic Chemistry", accuracy: 55 },
];

const DashboardPage = () => {
  const navigate = useNavigate();

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Welcome back! 👋</h1>
        <p className="text-muted-foreground mt-1">Here's your learning progress at a glance.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-card border-border hover:border-glow transition-all duration-300">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
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
            <CardTitle className="text-base text-foreground">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Start a Chat", icon: MessageSquare, path: "/chat" },
              { label: "Take a Quiz", icon: ClipboardList, path: "/quizzes" },
              { label: "Set Goals", icon: Target, path: "/goals" },
            ].map((action) => (
              <Button
                key={action.label}
                variant="ghost"
                onClick={() => navigate(action.path)}
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
            <CardTitle className="text-base text-foreground">Recent Topics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentTopics.map((topic) => (
              <div key={topic.topic} className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-3">
                  <Brain className="w-4 h-4 text-primary" />
                  <span className="text-sm text-foreground">{topic.topic}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{topic.accuracy}%</span>
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
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Score Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={scoreData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(230 15% 16%)" />
                <XAxis dataKey="date" tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }} stroke="hsl(230 15% 16%)" />
                <YAxis tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }} stroke="hsl(230 15% 16%)" />
                <Tooltip contentStyle={{ background: "hsl(230 15% 10%)", border: "1px solid hsl(230 15% 16%)", borderRadius: 8, color: "hsl(220 20% 92%)" }} />
                <Line type="monotone" dataKey="score" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={{ fill: "hsl(217 91% 60%)", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Topic Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={topicData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(230 15% 16%)" />
                <XAxis dataKey="topic" tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }} stroke="hsl(230 15% 16%)" />
                <YAxis tick={{ fill: "hsl(220 10% 55%)", fontSize: 12 }} stroke="hsl(230 15% 16%)" />
                <Tooltip contentStyle={{ background: "hsl(230 15% 10%)", border: "1px solid hsl(230 15% 16%)", borderRadius: 8, color: "hsl(220 20% 92%)" }} />
                <Bar dataKey="score" fill="hsl(217 91% 60%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Weak Topics */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Weak Topics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {weakTopics.map((topic) => (
            <div key={topic.topic} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/50">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">{topic.topic}</span>
                  <span className="text-sm text-warning font-medium">{topic.accuracy}%</span>
                </div>
                <Progress value={topic.accuracy} className="h-1.5 bg-secondary [&>div]:bg-warning" />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-primary hover:bg-primary/10 shrink-0"
                onClick={() => toast.info("Improvement plan generation coming soon!")}
              >
                Improve
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardPage;
