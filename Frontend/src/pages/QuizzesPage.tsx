import { useState, useEffect } from "react";
import { ClipboardList, ChevronRight, ArrowLeft, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { API_BASE } from "@/config/api";

const USER_ID = "student-001";

// ── Lightweight summary — used for the list view ───────────────────────────
interface QuizSummary {
  id: string;
  topic: string;
  date: string;
  score: number;
  total: number;
  accuracy: number;
  difficulty: "Easy" | "Medium" | "Hard";
}

// ── Full detail — fetched lazily on card click ─────────────────────────────
interface QuizQuestion {
  question: string;
  options: string[];
  selected: number;
  correct: number;
  explanation: string;
}

interface QuizDetail extends QuizSummary {
  questions: QuizQuestion[];
  weakAreas: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

const mapSummary = (q: any): QuizSummary => {
  const accuracy =
    q.total_questions > 0
      ? Math.round(((q.correct_count ?? 0) / q.total_questions) * 100)
      : 0;
  return {
    id:         q.quiz_id ?? q.id,
    topic:      q.topic,
    date:       q.created_at ? q.created_at.split("T")[0] : "",
    score:      q.correct_count ?? 0,
    total:      q.total_questions,
    accuracy,
    difficulty: difficultyFromAccuracy(accuracy),
  };
};

// ── DeleteButton — self-contained to avoid stopPropagation type issues ─────
// The outer div intercepts the click before it bubbles to the parent Card.

interface DeleteButtonProps {
  label: string;
  onConfirm: () => void;
  className?: string;
  iconSize?: string;
  showLabel?: boolean;
}

const DeleteButton = ({
  label,
  onConfirm,
  className = "",
  iconSize = "w-3.5 h-3.5",
  showLabel = false,
}: DeleteButtonProps) => (
  <div onClick={(e) => e.stopPropagation()}>
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size={showLabel ? "sm" : "icon"}
          className={className}
        >
          <Trash2 className={iconSize} />
          {showLabel && <span className="hidden sm:inline ml-1.5">Delete Quiz</span>}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this quiz?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{label}</strong> will be permanently deleted. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
);

// ── Main component ─────────────────────────────────────────────────────────

const QuizzesPage = () => {
  const [quizzes, setQuizzes]             = useState<QuizSummary[]>([]);
  const [selectedQuiz, setSelectedQuiz]   = useState<QuizDetail | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]     = useState<string | null>(null);

  // ── Fetch lightweight list on mount ───────────────────────────────────────
  useEffect(() => {
    const fetchQuizzes = async () => {
      try {
        const response = await fetch(`${API_BASE}/quiz/history?user_id=${USER_ID}`);
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const data = await response.json();
        setQuizzes(data.quizzes.map(mapSummary));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchQuizzes();
  }, []);

  // ── Lazy fetch full detail when a card is clicked ─────────────────────────
  const handleCardClick = async (summary: QuizSummary) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(`${API_BASE}/quiz/${summary.id}?user_id=${USER_ID}`);
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const q = await response.json();

      const questions: QuizQuestion[] = (q.results ?? []).map((r: any) => ({
        question:    r.question,
        options:     r.options,
        selected:    r.selected_index,
        correct:     r.correct_index,
        explanation: r.explanation,
      }));

      setSelectedQuiz({ ...summary, questions, weakAreas: q.weak_areas ?? [] });
    } catch (err: any) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Optimistic delete ─────────────────────────────────────────────────────
  // 1. Snapshot quiz + open detail for rollback
  // 2. Remove from list instantly and exit detail view if open
  // 3. Fire API in background — on failure, restore everything + toast
  const handleDelete = (quizId: string) => {
    const snapshotQuiz   = quizzes.find((q) => q.id === quizId);
    const snapshotIndex  = quizzes.findIndex((q) => q.id === quizId);
    const snapshotDetail = selectedQuiz?.id === quizId ? selectedQuiz : null;

    // Instant UI removal
    setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
    if (selectedQuiz?.id === quizId) {
      setSelectedQuiz(null);
      setDetailError(null);
    }

    // Fire-and-forget backend call
    fetch(`${API_BASE}/quiz/${quizId}?user_id=${USER_ID}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
      })
      .catch(() => {
        // Rollback — restore quiz to its original list position
        if (snapshotQuiz) {
          setQuizzes((prev) => {
            const next = [...prev];
            next.splice(snapshotIndex, 0, snapshotQuiz);
            return next;
          });
        }
        // Restore detail view if user was inside it
        if (snapshotDetail) setSelectedQuiz(snapshotDetail);
        toast.error("Failed to delete quiz. Please try again.");
      });
  };

  // ── Detail skeleton ────────────────────────────────────────────────────────
  if (detailLoading) {
    return (
      <div className="p-4 md:p-6 overflow-y-auto h-full space-y-4 animate-pulse">
        <div className="h-8 w-32 bg-secondary/50 rounded-lg" />
        <div className="space-y-2">
          <div className="h-6 w-56 bg-secondary/60 rounded-lg" />
          <div className="h-4 w-36 bg-secondary/40 rounded" />
        </div>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-secondary/60 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-full bg-secondary/60 rounded" />
                <div className="h-3.5 w-3/4 bg-secondary/40 rounded" />
              </div>
            </div>
            <div className="grid gap-2 ml-7">
              {[...Array(4)].map((_, oi) => (
                <div key={oi} className="h-9 w-full bg-secondary/30 rounded-lg border border-border" />
              ))}
            </div>
            <div className="ml-7 h-10 w-full bg-secondary/20 rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selectedQuiz) {
    return (
      <div className="p-4 md:p-6 overflow-y-auto h-full space-y-4">

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => { setSelectedQuiz(null); setDetailError(null); }}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Quizzes
          </Button>

          <DeleteButton
            label={selectedQuiz.topic}
            onConfirm={() => handleDelete(selectedQuiz.id)}
            showLabel
            iconSize="w-4 h-4"
            className="gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          />
        </div>

        <div>
          <h2 className="text-xl font-bold text-foreground">{selectedQuiz.topic}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Score: {selectedQuiz.score}/{selectedQuiz.total} · Accuracy: {selectedQuiz.accuracy}%
          </p>
        </div>

        {detailError && (
          <div className="text-sm text-destructive">{detailError}</div>
        )}

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
                        : <XCircle      className="w-5 h-5 text-destructive mt-0.5 shrink-0" />}
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
              onClick={() => handleCardClick(quiz)}
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

                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={difficultyColor(quiz.difficulty)}>
                      {quiz.difficulty}
                    </Badge>
                    <DeleteButton
                      label={quiz.topic}
                      onConfirm={() => handleDelete(quiz.id)}
                      iconSize="w-3.5 h-3.5"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
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

                <Button
                  variant="ghost"
                  className="w-full justify-between text-muted-foreground hover:text-primary hover:bg-primary/10 text-xs h-9"
                >
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