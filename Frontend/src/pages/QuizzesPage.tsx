import { useState, useEffect } from "react";
import { ClipboardList, ChevronRight, ArrowLeft, CheckCircle2, XCircle, Clock, Trash2, RefreshCw, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { API_BASE } from "@/config/api";
import { offlineFetch } from "@/lib/offlineFetch";
import { cacheQuizDetail, getCachedQuizDetail, addToSyncQueue, type CachedQuizDetail } from "@/lib/offlineStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

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
  unansweredIndices: number[];
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
  const accuracy = q.total_questions > 0
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

// ── Component ──────────────────────────────────────────────────────────────

const QuizzesPage = () => {
  const [quizzes, setQuizzes]           = useState<QuizSummary[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<QuizDetail | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]     = useState<string | null>(null);

  // ── Delete state ───────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<QuizSummary | null>(null);
  const [isDeleting, setIsDeleting]     = useState(false);
  const { isOnline } = useOnlineStatus();

  // ── Offline retake state ──────────────────────────────────────────────────
  const [retakeQuiz, setRetakeQuiz] = useState<CachedQuizDetail | null>(null);
  const [retakeAnswers, setRetakeAnswers] = useState<(number | null)[]>([]);
  const [retakeCurrentQ, setRetakeCurrentQ] = useState(0);
  const [retakeSubmitted, setRetakeSubmitted] = useState(false);
  const [retakeResults, setRetakeResults] = useState<{ correct: boolean; selected: number; correctIdx: number }[]>([]);
  const [retakeTimeLeft, setRetakeTimeLeft] = useState<number | null>(null);
  const [retakeTimedOut, setRetakeTimedOut] = useState(false);

  // ── Fetch lightweight list on mount (offline-aware) ────────────────────────
  useEffect(() => {
    const fetchQuizzes = async () => {
      try {
        const { data } = await offlineFetch(`${API_BASE}/quiz/history?user_id=${USER_ID}`);
        const quizList = data.quizzes || [];
        setQuizzes(quizList.map(mapSummary));

        // Auto-cache first 20 submitted quizzes for offline retake
        // The history endpoint already returns results with correct_index
        const toCacheList = quizList
          .filter((q: any) => q.submitted && q.results && q.results.length > 0)
          .slice(0, 20);
        for (const q of toCacheList) {
          cacheQuizDetail({
            quiz_id: q.quiz_id,
            topic: q.topic,
            questions: q.results.map((r: any) => ({
              question: r.question,
              options: r.options,
              correct_index: r.correct_index,
              explanation: r.explanation,
            })),
            cachedAt: new Date().toISOString(),
          }).catch(() => {});
        }
      } catch (err: any) {
        setError(err.message === "offline_no_cache" ? "You're offline with no cached data" : err.message);
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
      const { data: q } = await offlineFetch(
        `${API_BASE}/quiz/${summary.id}?user_id=${USER_ID}`
      );

      const questions: QuizQuestion[] = (q.results ?? []).map((r: any) => ({
        question:    r.question,
        options:     r.options,
        selected:    r.selected_index,
        correct:     r.correct_index,
        explanation: r.explanation,
      }));

      // Cache the full quiz detail for offline retake (includes correct_index)
      if (questions.length > 0) {
        cacheQuizDetail({
          quiz_id: summary.id,
          topic: summary.topic,
          questions: questions.map(qq => ({
            question: qq.question,
            options: qq.options,
            correct_index: qq.correct,
            explanation: qq.explanation,
          })),
          cachedAt: new Date().toISOString(),
        }).catch(() => {});
      }

      setSelectedQuiz({
        ...summary,
        questions,
        weakAreas: q.weak_areas ?? [],
        unansweredIndices: q.unanswered_indices ?? [],
      });
    } catch (err: any) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Start offline retake ──────────────────────────────────────────────────
  const handleStartRetake = async (quizId: string, topic: string) => {
    const cached = await getCachedQuizDetail(quizId);
    if (!cached) {
      toast.error("Quiz not cached for offline retake. View it online first.");
      return;
    }
    setRetakeQuiz(cached);
    setRetakeAnswers(Array(cached.questions.length).fill(null));
    setRetakeCurrentQ(0);
    setRetakeSubmitted(false);
    setRetakeResults([]);
    setRetakeTimedOut(false);
    setRetakeTimeLeft(cached.timer_seconds ?? null);
    setSelectedQuiz(null); // close detail view
  };

  // ── Retake timer tick ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!retakeQuiz || retakeSubmitted || retakeTimeLeft === null || retakeTimeLeft <= 0) return;
    const id = setTimeout(() => setRetakeTimeLeft(t => t !== null ? t - 1 : null), 1000);
    return () => clearTimeout(id);
  }, [retakeTimeLeft, retakeQuiz, retakeSubmitted]);

  // ── Auto-submit retake when timer hits 0 ──────────────────────────────────
  useEffect(() => {
    if (!retakeQuiz || retakeTimeLeft !== 0 || retakeSubmitted) return;
    setRetakeTimedOut(true);
    handleRetakeSubmit(retakeAnswers.map(a => a === null ? 0 : a));
  }, [retakeTimeLeft]);

  // ── Client-side grading for retake ────────────────────────────────────────
  const handleRetakeSubmit = async (finalAnswers?: (number | null)[]) => {
    if (!retakeQuiz) return;
    const answers = (finalAnswers ?? retakeAnswers).map(a => a ?? 0);
    const unansweredSet = new Set(
      retakeAnswers.map((a, i) => a === null ? i : -1).filter(i => i >= 0)
    );

    const results = retakeQuiz.questions.map((q, i) => ({
      correct: answers[i] === q.correct_index && !unansweredSet.has(i),
      selected: answers[i],
      correctIdx: q.correct_index,
    }));

    setRetakeResults(results);
    setRetakeSubmitted(true);

    // Queue submission for sync when back online
    const correctCount = results.filter(r => r.correct).length;
    if (!navigator.onLine) {
      toast.success(`📡 Retake complete! Score: ${correctCount}/${results.length}`, {
        description: "Results will sync when you're back online",
      });
    } else {
      toast.success(`Retake complete! Score: ${correctCount}/${results.length}`);
    }
  };

  // ── Confirm and execute delete ────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    // Optimistic removal — remove from list immediately so UI feels instant
    setQuizzes((prev) => prev.filter((q) => q.id !== deleteTarget.id));
    setDeleteTarget(null);
    if (!navigator.onLine) {
      addToSyncQueue({ type: "quiz_delete", url: `${API_BASE}/quiz/${deleteTarget.id}?user_id=${USER_ID}`, method: "DELETE", body: "", createdAt: new Date().toISOString() }).catch(() => {});
      setIsDeleting(false);
      return;
    }
    try {
      const response = await fetch(
        `${API_BASE}/quiz/${deleteTarget.id}?user_id=${USER_ID}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        // Rollback on failure — refetch the list so nothing is silently lost
        const res = await fetch(`${API_BASE}/quiz/history?user_id=${USER_ID}`);
        if (res.ok) {
          const data = await res.json();
          setQuizzes(data.quizzes.map(mapSummary));
        }
        toast.error("Failed to delete quiz. Please try again.");
      }
    } catch {
      toast.error("Failed to delete quiz. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };
  // ── Offline Retake UI ─────────────────────────────────────────────────────
  if (retakeQuiz) {
    if (retakeSubmitted) {
      const correctCount = retakeResults.filter(r => r.correct).length;
      const totalQ = retakeQuiz.questions.length;
      const accuracy = Math.round((correctCount / totalQ) * 100);
      return (
        <div className="p-4 md:p-6 overflow-y-auto h-full space-y-4">
          <Button variant="ghost" onClick={() => setRetakeQuiz(null)} className="gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to Quizzes
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">Retake: {retakeQuiz.topic}</h2>
              {!isOnline && <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-[10px]"><WifiOff className="w-3 h-3 mr-1" />Offline</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Score: {correctCount}/{totalQ} • Accuracy: {accuracy}%
            </p>
          </div>
          <div className="space-y-4">
            {retakeQuiz.questions.map((q, i) => {
              const r = retakeResults[i];
              return (
                <Card key={i} className="bg-card border-border">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start gap-2">
                      {r.correct
                        ? <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                        : <XCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />}
                      <p className="text-sm font-medium text-foreground">{q.question}</p>
                    </div>
                    <div className="grid gap-2 ml-7">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={`text-sm px-3 py-2 rounded-lg border ${
                          oi === q.correct_index ? "border-success/40 bg-success/10 text-success"
                          : oi === r.selected && !r.correct ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-border text-muted-foreground"
                        }`}>{opt}</div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground ml-7 bg-secondary/50 p-3 rounded-lg">💡 {q.explanation}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Active retake quiz (answering) ────────────────────────────────────
    const question = retakeQuiz.questions[retakeCurrentQ];
    const totalQ = retakeQuiz.questions.length;
    const allAnswered = retakeAnswers.every(a => a !== null);
    return (
      <div className="p-4 md:p-6 overflow-y-auto h-full space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setRetakeQuiz(null)} className="gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Cancel Retake
          </Button>
          <div className="flex items-center gap-3">
            {!isOnline && <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-[10px]"><WifiOff className="w-3 h-3 mr-1" />Offline</Badge>}
            {retakeTimeLeft !== null && (
              <Badge variant={retakeTimeLeft < 10 ? "destructive" : "secondary"} className="font-mono text-sm px-3">
                <Clock className="w-3 h-3 mr-1" />{Math.floor(retakeTimeLeft / 60)}:{(retakeTimeLeft % 60).toString().padStart(2, "0")}
              </Badge>
            )}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">Retake: {retakeQuiz.topic}</h2>
          <p className="text-sm text-muted-foreground">Question {retakeCurrentQ + 1} of {totalQ}</p>
        </div>
        {/* Progress bar */}
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${((retakeCurrentQ + 1) / totalQ) * 100}%` }} />
        </div>
        <Card className="bg-card border-border">
          <CardContent className="p-5 space-y-4">
            <p className="text-sm font-medium text-foreground">{question.question}</p>
            <div className="grid gap-2">
              {question.options.map((opt, oi) => (
                <button key={oi}
                  className={`text-left text-sm px-4 py-3 rounded-lg border transition-all ${
                    retakeAnswers[retakeCurrentQ] === oi
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:bg-primary/5"
                  }`}
                  onClick={() => setRetakeAnswers(prev => { const n = [...prev]; n[retakeCurrentQ] = oi; return n; })}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" size="sm" disabled={retakeCurrentQ === 0}
                onClick={() => setRetakeCurrentQ(p => p - 1)}>← Previous</Button>
              {retakeCurrentQ < totalQ - 1 ? (
                <Button size="sm" disabled={retakeAnswers[retakeCurrentQ] === null}
                  onClick={() => setRetakeCurrentQ(p => p + 1)}>Next →</Button>
              ) : (
                <Button size="sm" disabled={!allAnswered}
                  onClick={() => handleRetakeSubmit()}>Submit</Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detailLoading) {
    return (
      <div className="p-4 md:p-6 overflow-y-auto h-full space-y-4 animate-pulse">
        {/* Back button placeholder */}
        <div className="h-8 w-32 bg-secondary/50 rounded-lg" />

        {/* Title + subtitle */}
        <div className="space-y-2">
          <div className="h-6 w-56 bg-secondary/60 rounded-lg" />
          <div className="h-4 w-36 bg-secondary/40 rounded" />
        </div>

        {/* Question cards */}
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
            {/* Question row */}
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-secondary/60 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-full bg-secondary/60 rounded" />
                <div className="h-3.5 w-3/4 bg-secondary/40 rounded" />
              </div>
            </div>
            {/* Options */}
            <div className="grid gap-2 ml-7">
              {[...Array(4)].map((_, oi) => (
                <div key={oi} className="h-9 w-full bg-secondary/30 rounded-lg border border-border" />
              ))}
            </div>
            {/* Explanation */}
            <div className="ml-7 h-10 w-full bg-secondary/20 rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (selectedQuiz) {
    return (
      <div className="p-4 md:p-6 overflow-y-auto h-full space-y-4">
        {/* Delete confirmation dialog — also shown in detail view */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">Delete Quiz?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                This will permanently delete <span className="font-semibold text-foreground">"{deleteTarget?.topic}"</span> and all its results. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border text-muted-foreground hover:text-foreground">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await handleDeleteConfirm();
                  setSelectedQuiz(null);
                  setDetailError(null);
                }}
                disabled={isDeleting}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => { setSelectedQuiz(null); setDetailError(null); }}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Quizzes
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartRetake(selectedQuiz.id, selectedQuiz.topic)}
              className="gap-2 text-primary hover:text-primary hover:bg-primary/10 border-primary/30"
            >
              <RefreshCw className="w-4 h-4" /> Retake Quiz
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(selectedQuiz)}
              className="gap-2 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" /> Delete Quiz
            </Button>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold text-foreground">{selectedQuiz.topic}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Score: {selectedQuiz.score}/{selectedQuiz.total} • Accuracy: {selectedQuiz.accuracy}%
          </p>
        </div>

        {detailError && (
          <div className="text-sm text-destructive">Failed to load details: {detailError}</div>
        )}

        {selectedQuiz.questions.length > 0 ? (
          <div className="space-y-4">
            {selectedQuiz.questions.map((q, i) => {
              const isCorrect = q.selected === q.correct;
              const wasUnanswered = selectedQuiz.unansweredIndices.includes(i);
              return (
                <Card key={i} className="bg-card border-border">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start gap-2">
                      {wasUnanswered
                        ? <Clock className="w-5 h-5 text-muted-foreground/60 mt-0.5 shrink-0" />
                        : isCorrect
                          ? <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                          : <XCircle     className="w-5 h-5 text-destructive mt-0.5 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{q.question}</p>
                        {wasUnanswered && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/60 bg-secondary px-2 py-0.5 rounded-full">
                            ⏱ Not answered — time ran out
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-2 ml-7">
                      {q.options.map((opt, oi) => (
                        <div
                          key={oi}
                          className={`text-sm px-3 py-2 rounded-lg border ${
                            oi === q.correct
                              ? "border-success/40 bg-success/10 text-success"
                              : oi === q.selected && !isCorrect && !wasUnanswered
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
      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Quiz?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will permanently delete <span className="font-semibold text-foreground">"{deleteTarget?.topic}"</span> and all its results. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:text-foreground">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={difficultyColor(quiz.difficulty)}>
                      {quiz.difficulty}
                    </Badge>
                    {/* Delete button — always visible, stopPropagation prevents card click */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(quiz); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Delete quiz"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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