import { useState } from "react";
import { ClipboardList, ChevronRight, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Quiz {
  id: string;
  topic: string;
  date: string;
  score: number;
  total: number;
  accuracy: number;
  difficulty: "Easy" | "Medium" | "Hard";
  questions: {
    question: string;
    options: string[];
    selected: number;
    correct: number;
    explanation: string;
  }[];
  weakAreas: string[];
}

const MOCK_QUIZZES: Quiz[] = [
  {
    id: "1",
    topic: "Photosynthesis",
    date: "2026-03-01",
    score: 8,
    total: 10,
    accuracy: 80,
    difficulty: "Medium",
    questions: [
      {
        question: "What is the primary pigment in photosynthesis?",
        options: ["Chlorophyll", "Carotene", "Xanthophyll", "Anthocyanin"],
        selected: 0,
        correct: 0,
        explanation: "Chlorophyll is the main pigment that absorbs light energy for photosynthesis.",
      },
      {
        question: "Where does the light reaction occur?",
        options: ["Stroma", "Thylakoid membrane", "Cytoplasm", "Nucleus"],
        selected: 2,
        correct: 1,
        explanation: "Light reactions take place in the thylakoid membranes of the chloroplast.",
      },
    ],
    weakAreas: ["Light reactions location", "Calvin cycle details"],
  },
  {
    id: "2",
    topic: "Newton's Laws of Motion",
    date: "2026-02-28",
    score: 6,
    total: 10,
    accuracy: 60,
    difficulty: "Hard",
    questions: [],
    weakAreas: ["Third law applications", "Free body diagrams"],
  },
  {
    id: "3",
    topic: "Cell Division",
    date: "2026-02-25",
    score: 9,
    total: 10,
    accuracy: 90,
    difficulty: "Easy",
    questions: [],
    weakAreas: [],
  },
  {
    id: "4",
    topic: "Thermodynamics",
    date: "2026-02-22",
    score: 5,
    total: 10,
    accuracy: 50,
    difficulty: "Hard",
    questions: [],
    weakAreas: ["Entropy", "Second law applications", "Carnot cycle"],
  },
];

const difficultyColor = (d: string) => {
  if (d === "Easy") return "bg-success/15 text-success border-success/30";
  if (d === "Medium") return "bg-warning/15 text-warning border-warning/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
};

const QuizzesPage = () => {
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);

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
                      {isCorrect ? (
                        <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                      )}
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
              Detailed questions will appear here when connected to AI.
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

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Quizzes</h1>
        <p className="text-muted-foreground mt-1">Review your quiz history and performance.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MOCK_QUIZZES.map((quiz) => (
          <Card key={quiz.id} className="bg-card border-border hover:border-glow transition-all duration-300 group cursor-pointer" onClick={() => setSelectedQuiz(quiz)}>
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
    </div>
  );
};

export default QuizzesPage;
