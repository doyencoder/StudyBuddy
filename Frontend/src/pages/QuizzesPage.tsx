import { useState, useEffect } from "react";
import { ClipboardList, ChevronRight, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/config/api";

const USER_ID = "student-001";

interface QuizQuestion {
  question: string;
  options: string[];
  selected: number;
  correct: number;
  explanation: string;
}

interface Quiz {
  id: string;
  topic: string;
  date: string;
  score: number;
  total: number;
  accuracy: number;
  difficulty: "Easy" | "Medium" | "Hard";
  questions: QuizQuestion[];
  weakAreas: string[];
}

const difficultyFromAccuracy = (accuracy: number): "Easy" | "Medium" | "Hard" => {
  if (accuracy >= 80) return "Easy";
  if (accuracy >= 60) return "Medium";
  return "Hard";
};

const difficultyColor = (d: string) => {
  if (d === "Easy")   return "bg-success/15 text-success border-success/30";
  if (d === "Medium") return "bg-warning/15 text-warning border-warning/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
};

const QuizzesPage = () => {
  const [quizzes, setQuizzes]           = useState<Quiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  useEffect(() => {
    const fetchQuizzes = async () => {
      try {
        const response = await fetch(`${API_BASE}/quiz/history?user_id=${USER_ID}`);
        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const data = await response.json();

        const mapped: Quiz[] = data.quizzes.map((q: any) => {
          const accuracy = q.total_questions > 0
            ? Math.round(((q.correct_count ?? 0) / q.total_questions) * 100)
            : 0;

          // Map results array into the shape the UI expects
          const questions: QuizQuestion[] = (q.results ?? []).map((r: any) => ({
            question:    r.question,
            options:     r.options,
            selected:    r.selected_index,
            correct:     r.correct_index,
            explanation: r.explanation,
          }));

          return {
            id:         q.quiz_id,
            topic:      q.topic,
            date:       q.created_at ? q.created_at.split("T")[0] : "",
            score:      q.correct_count ?? 0,
            total:      q.total_questions,
            accuracy,
            difficulty: difficultyFromAccuracy(accuracy),
            questions,
            weakAreas:  q.weak_areas ?? [],
          };
        });

        setQuizzes(mapped);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchQuizzes();
  }, []);

  // ── Detail view ────────────────────────────────────────────────────────────

  if (selectedQuiz) {
    return (
      <div className="p-4 md:p-6 overflow-y-auto h-full space-y-4">
        <Button variant="ghost" onClick={() => setSelectedQuiz(null)} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Quizzes
        </Button>

        <div>
          <h2 className="text-xl font-bold text-foreground">{selectedQuiz.topic}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Score: {selectedQuiz.score}/{selectedQuiz.total} • Accuracy: {selectedQuiz.accuracy}%
          </p>
        </div>

        {selectedQuiz.questions.length > 0 ? (
          <div className="space-y-4">
            {selectedQuiz.questions.map((q, i) => {
              const isCorrect = q.selected === q.correct;
              return (
                <Card key={i} className="bg-card border-border">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start gap-2">
                      {isCorrect
                        ? <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                        : <XCircle     className="w-5 h-5 text-destructive mt-0.5 shrink-0" />}
                      <p className="text-sm font-medium text-foreground">{q.question}</p>
                    </div>
                    <div className="grid gap-2 ml-7">
                      {q.options.map((opt, oi) => (
                        <div
                          key={oi}
                          className={`text-sm px-3 py-2 rounded-lg border ${
                            oi === q.correct
                              ? "border-success/40 bg-success/10 text-success"
                              : oi === q.selected && !isCorrect
                              ? "border-destructive/40 bg-destructive/10 text-destructive"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {opt}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground ml-7 bg-secondary/50 p-3 rounded-lg">
                      💡 {q.explanation}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="bg-card border-border">
            <CardContent className="p-8 text-center text-muted-foreground">
              No question breakdown available for this quiz.
            </CardContent>
          </Card>
        )}

        {selectedQuiz.weakAreas.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Weak Areas Identified</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {selectedQuiz.weakAreas.map((area) => (
                <Badge key={area} variant="outline" className="border-warning/30 text-warning bg-warning/10">
                  {area}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Quizzes</h1>
        <p className="text-muted-foreground mt-1">Review your quiz history and performance.</p>
      </div>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary/60" />
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-24 bg-secondary/60 rounded" />
                    <div className="h-3 w-16 bg-secondary/40 rounded" />
                  </div>
                </div>
                <div className="h-5 w-14 bg-secondary/40 rounded-full" />
              </div>
              <div className="flex justify-between">
                <div className="space-y-1">
                  <div className="h-3 w-10 bg-secondary/40 rounded" />
                  <div className="h-6 w-14 bg-secondary/60 rounded-lg" />
                </div>
                <div className="space-y-1 text-right">
                  <div className="h-3 w-14 bg-secondary/40 rounded" />
                  <div className="h-6 w-12 bg-secondary/60 rounded-lg" />
                </div>
              </div>
              <div className="h-9 w-full bg-secondary/30 rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center h-40 text-destructive text-sm">
          Failed to load quizzes: {error}
        </div>
      )}

      {!loading && !error && quizzes.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <ClipboardList className="w-8 h-8 opacity-40" />
          <p>No quizzes yet. Generate one from the Chat page!</p>
        </div>
      )}

      {!loading && !error && quizzes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quizzes.map((quiz) => (
            <Card
              key={quiz.id}
              className="bg-card border-border hover:border-glow transition-all duration-300 group cursor-pointer"
              onClick={() => setSelectedQuiz(quiz)}
            >
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                      <ClipboardList className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{quiz.topic}</h3>
                      <p className="text-xs text-muted-foreground">{quiz.date}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={difficultyColor(quiz.difficulty)}>
                    {quiz.difficulty}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Score</p>
                    <p className="text-lg font-bold text-foreground">{quiz.score}/{quiz.total}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs text-muted-foreground">Accuracy</p>
                    <p className={`text-lg font-bold ${quiz.accuracy >= 70 ? "text-success" : "text-warning"}`}>
                      {quiz.accuracy}%
                    </p>
                  </div>
                </div>

                <Button variant="ghost" className="w-full justify-between text-muted-foreground hover:text-primary hover:bg-primary/10 text-xs h-9">
                  View Details
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuizzesPage;