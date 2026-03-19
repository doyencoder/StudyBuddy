import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CelebrationVariant = "quiz" | "daily_goal" | "long_term_goal";

interface CelebrationOverlayProps {
  show: boolean;
  variant: CelebrationVariant;
  onClose: () => void;
}

// ── Confetti particle config ──────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  shape: "rect" | "circle" | "star";
  size: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  decay: number;
}

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#3b82f6", "#f97316", "#14b8a6",
  "#e11d48", "#a855f7",
];

function createParticles(canvas: HTMLCanvasElement): Particle[] {
  const particles: Particle[] = [];
  const count = 140;
  const cx = canvas.width / 2;

  for (let i = 0; i < count; i++) {
    const angle = (Math.random() * Math.PI * 2);
    const speed = 6 + Math.random() * 12;
    particles.push({
      x: cx,
      y: canvas.height * 0.38,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: (["rect", "circle", "star"] as const)[Math.floor(Math.random() * 3)],
      size: 6 + Math.random() * 8,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.25,
      opacity: 1,
      decay: 0.012 + Math.random() * 0.008,
    });
  }
  return particles;
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const b = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2;
    i === 0 ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    ctx.lineTo(x + (r / 2) * Math.cos(b), y + (r / 2) * Math.sin(b));
  }
  ctx.closePath();
}

// ── Variant content ───────────────────────────────────────────────────────────

const VARIANT_CONTENT: Record<CelebrationVariant, { emoji: string; title: string; subtitle: string }> = {
  quiz: {
    emoji: "🏆",
    title: "Perfect Score!",
    subtitle: "100% — Absolutely flawless. You crushed it!",
  },
  daily_goal: {
    emoji: "⭐",
    title: "Daily Goals Done!",
    subtitle: "Every task checked off. What a productive day!",
  },
  long_term_goal: {
    emoji: "🎯",
    title: "Goal Achieved!",
    subtitle: "100% complete. You stayed the course and made it!",
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CelebrationOverlay({ show, variant, onClose }: CelebrationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  const content = VARIANT_CONTENT[variant];

  // Animate canvas confetti
  useEffect(() => {
    if (!show) return;

    setVisible(true);
    setFadeOut(false);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    particlesRef.current = createParticles(canvas);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particlesRef.current = particlesRef.current.filter(p => p.opacity > 0.02);

      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;        // gravity
        p.vx *= 0.98;        // air resistance
        p.rotation += p.rotationSpeed;
        p.opacity -= p.decay;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          drawStar(ctx, 0, 0, p.size / 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    // Auto-dismiss after 3.8s
    const fadeTimer = setTimeout(() => setFadeOut(true), 3200);
    const closeTimer = setTimeout(() => {
      setVisible(false);
      onClose();
    }, 3800);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(fadeTimer);
      clearTimeout(closeTimer);
    };
  }, [show]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-700 ${fadeOut ? "opacity-0" : "opacity-100"}`}
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onClick={() => { setFadeOut(true); setTimeout(() => { setVisible(false); onClose(); }, 600); }}
    >
      {/* Canvas for confetti — sits behind the card */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Celebration card */}
      <div
        className={`relative z-10 flex flex-col items-center gap-4 bg-card border border-border/60 rounded-3xl px-10 py-10 shadow-2xl text-center max-w-sm w-full mx-4 transition-all duration-500 ${fadeOut ? "scale-90 opacity-0" : "scale-100 opacity-100"}`}
        style={{
          animation: fadeOut ? undefined : "celebPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Emoji burst */}
        <div
          className="text-7xl select-none"
          style={{ animation: "celebBounce 0.6s ease-out 0.2s both" }}
        >
          {content.emoji}
        </div>

        {/* Sparkle row */}
        <div className="flex gap-2 text-2xl" style={{ animation: "celebFadeIn 0.4s ease 0.5s both" }}>
          {"✨🌟✨".split("").map((s, i) => (
            <span key={i} style={{ animationDelay: `${0.55 + i * 0.08}s`, animation: "celebFadeIn 0.3s ease both" }}>{s}</span>
          ))}
        </div>

        {/* Text */}
        <div className="space-y-2" style={{ animation: "celebFadeIn 0.4s ease 0.4s both" }}>
          <p className="text-2xl font-bold text-foreground tracking-tight">{content.title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{content.subtitle}</p>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 mt-1" style={{ animation: "celebFadeIn 0.4s ease 0.6s both" }}>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-primary"
              style={{ animation: `celebDot 0.4s ease ${0.7 + i * 0.07}s both` }}
            />
          ))}
        </div>

        {/* Dismiss hint */}
        <p className="text-xs text-muted-foreground/40 mt-1" style={{ animation: "celebFadeIn 0.4s ease 1s both" }}>
          Tap anywhere to dismiss
        </p>
      </div>

      {/* Keyframe injector */}
      <style>{`
        @keyframes celebPop {
          from { opacity: 0; transform: scale(0.6) translateY(20px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes celebBounce {
          0%   { transform: scale(0) rotate(-15deg); }
          60%  { transform: scale(1.25) rotate(5deg); }
          80%  { transform: scale(0.92) rotate(-3deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes celebFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes celebDot {
          from { opacity: 0; transform: scale(0); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}