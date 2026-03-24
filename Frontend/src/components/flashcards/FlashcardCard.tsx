import { ArrowUpRight } from "lucide-react";

type FlashcardSlot = "center" | "left" | "right" | "back" | "retreat" | "incoming";

interface FlashcardCardProps {
  title: string;
  description: string;
  slot?: FlashcardSlot;
  onCycle?: () => void;
  onOpenChat?: () => void;
  isHovered?: boolean;
}

export function FlashcardCard({
  title,
  description,
  slot = "center",
  onCycle,
  onOpenChat,
  isHovered = false,
}: FlashcardCardProps) {
  const getStackStyles = () => {
    if (slot === "center") {
      return {
        zIndex: 40,
        transform: isHovered
          ? "translate(0px, -8px) scale(1.02) rotate(-1.2deg)"
          : "translate(0px, 0px) scale(1) rotate(0deg)",
        boxShadow: "0 30px 60px rgba(15, 23, 42, 0.36)",
        filter: "none",
        cardOpacity: 1,
        contentOpacity: 1,
      };
    }

    if (slot === "left") {
      return {
        zIndex: 24,
        transform: "translate(-34px, 16px) scale(0.91) rotate(-7deg)",
        boxShadow: "0 18px 34px rgba(15, 23, 42, 0.2)",
        filter: "saturate(0.82) brightness(0.88) blur(0.2px)",
        cardOpacity: 0.84,
        contentOpacity: 0.12,
      };
    }

    if (slot === "right") {
      return {
        zIndex: 30,
        transform: "translate(26px, 14px) scale(0.95) rotate(4.5deg)",
        boxShadow: "0 20px 40px rgba(15, 23, 42, 0.24)",
        filter: "saturate(0.9) brightness(0.93)",
        cardOpacity: 0.9,
        contentOpacity: 0.16,
      };
    }

    if (slot === "retreat") {
      return {
        zIndex: 28,
        transform: "translate(-56px, 18px) scale(0.88) rotate(-9deg)",
        boxShadow: "0 16px 30px rgba(15, 23, 42, 0.18)",
        filter: "saturate(0.78) brightness(0.84) blur(0.4px)",
        cardOpacity: 0.72,
        contentOpacity: 0.08,
      };
    }

    if (slot === "incoming") {
      return {
        zIndex: 34,
        transform: "translate(10px, 4px) scale(0.985) rotate(1.5deg)",
        boxShadow: "0 24px 48px rgba(15, 23, 42, 0.28)",
        filter: "saturate(0.98) brightness(0.98)",
        cardOpacity: 0.96,
        contentOpacity: 0.76,
      };
    }

    return {
      zIndex: 16,
      transform: "translate(42px, 22px) scale(0.87) rotate(8deg)",
      boxShadow: "0 12px 22px rgba(15, 23, 42, 0.16)",
      filter: "saturate(0.72) brightness(0.82) blur(0.5px)",
      cardOpacity: 0.68,
      contentOpacity: 0.03,
    };
  };

  const styles = getStackStyles();
  const isCenter = slot === "center";
  const showHoverEffect = isCenter && isHovered;

  const baseBackground =
    "radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 52%), linear-gradient(180deg, rgba(24, 36, 64, 0.98), rgba(14, 20, 36, 1))";
  const hoverBackground =
    "radial-gradient(circle at top left, rgba(59, 130, 246, 0.26), transparent 62%), linear-gradient(180deg, rgba(28, 44, 76, 0.99), rgba(16, 24, 42, 1))";

  return (
    <div
      className={`absolute inset-0 overflow-hidden rounded-xl select-none transition-[transform,opacity,filter,box-shadow,border-color,background] duration-[620ms] ease-[cubic-bezier(0.2,0.9,0.2,1)] will-change-transform ${
        isCenter ? "cursor-pointer" : ""
      }`}
      onClick={isCenter ? onCycle : undefined}
      style={{
        zIndex: styles.zIndex,
        transform: styles.transform,
        transformOrigin: "center center",
        background: showHoverEffect ? hoverBackground : baseBackground,
        opacity: styles.cardOpacity,
        filter: styles.filter,
        border: `1px solid ${
          showHoverEffect ? "rgba(96, 165, 250, 0.45)" : "rgba(96, 165, 250, 0.2)"
        }`,
        boxShadow: styles.boxShadow,
      }}
    >
      <div
        className="relative z-10 flex h-full flex-col p-5 transition-opacity duration-300"
        style={{ opacity: styles.contentOpacity }}
      >
        <div className="flex items-start justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-white/50">
            Flashcard Deck
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenChat?.();
            }}
            className="rounded-full border p-1.5 transition-colors"
            style={{
              borderColor: showHoverEffect
                ? "rgba(59, 130, 246, 0.4)"
                : "rgba(255, 255, 255, 0.1)",
              backgroundColor: showHoverEffect
                ? "rgba(59, 130, 246, 0.1)"
                : "rgba(255, 255, 255, 0.05)",
            }}
            aria-label="Open source chat"
            title="Open source chat"
          >
            <ArrowUpRight
              className="h-3.5 w-3.5 transition-colors"
              style={{
                color: showHoverEffect
                  ? "rgba(59, 130, 246, 0.9)"
                  : "rgba(255, 255, 255, 0.7)",
              }}
            />
          </button>
        </div>

        <div className="mt-7 pr-2">
          <h3 className="text-balance text-lg font-semibold leading-tight text-white">
            {title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
