import { GraduationCap, MessageSquare, Brain, Target, Image, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const features = [
  {
    icon: MessageSquare,
    title: "AI Chat Tutor",
    description: "Get instant answers and explanations in your preferred language with our intelligent study companion.",
  },
  {
    icon: Brain,
    title: "Smart Quizzes",
    description: "Auto-generated quizzes that adapt to your learning pace and identify knowledge gaps.",
  },
  {
    icon: Target,
    title: "Goal Tracking",
    description: "Set study goals, track your progress, and stay motivated with visual milestones.",
  },
  {
    icon: Image,
    title: "Visual Learning",
    description: "Generate diagrams, flowcharts, and mind maps to visualize complex concepts.",
  },
];

const benefits = [
  "Supports 8+ Indian languages",
  "AI-powered study plans",
  "Generate quizzes from any topic",
  "Track your learning progress",
  "Create mind maps & flowcharts",
  "100% free to get started",
];

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-primary" />
            </div>
            <span className="text-lg font-bold text-foreground">Study Buddy</span>
          </div>
          <Button onClick={() => navigate("/chat")} className="gap-2">
            Get Started <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        </div>
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8">
            <Sparkles className="w-4 h-4" />
            AI-Powered Learning Assistant
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            Your smartest
            <span className="text-gradient"> study partner</span>
            <br />is here.
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            Chat, quiz, plan, and visualize your way to better grades — in any language you think in.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" onClick={() => navigate("/chat")} className="gap-2 px-8 text-base glow-blue">
              Start Learning Free <ArrowRight className="w-4 h-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/dashboard")} className="gap-2 px-8 text-base">
              View Dashboard
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Everything you need to <span className="text-gradient">ace your studies</span></h2>
            <p className="text-muted-foreground text-lg max-w-lg mx-auto">Powerful tools designed for how students actually learn.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border bg-card p-7 hover:border-primary/30 hover:glow-blue-sm transition-all duration-300"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto rounded-3xl border border-border bg-card p-10 sm:p-14 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/5 blur-[80px] pointer-events-none" />
          <div className="relative flex flex-col lg:flex-row items-start gap-10">
            <div className="flex-1">
              <h2 className="text-3xl font-bold mb-4">Why students love <span className="text-gradient">Study Buddy</span></h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">Built specifically for Indian students who want a smarter, more personal way to prepare for exams and master new subjects.</p>
              <Button onClick={() => navigate("/chat")} className="gap-2">
                Try it now <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1">
              <ul className="space-y-4">
                {benefits.map((b) => (
                  <li key={b} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                    <span className="text-foreground">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to study smarter?</h2>
        <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">Jump in and start chatting with your AI study buddy — no sign-up needed.</p>
        <Button size="lg" onClick={() => navigate("/chat")} className="gap-2 px-10 text-base glow-blue animate-pulse-glow">
          Get Started Free <ArrowRight className="w-4 h-4" />
        </Button>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" />
            <span>Study Buddy</span>
          </div>
          <span>© {new Date().getFullYear()} Study Buddy. Built for learners.</span>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
