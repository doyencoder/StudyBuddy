import { cn } from "@/lib/utils"
import { useScrollProgress } from "@/hooks/use-scroll-animation"

interface ScrollProgressProps {
  className?: string
  barClassName?: string
  position?: "top" | "bottom"
}

export function ScrollProgress({
  className,
  barClassName,
  position = "top",
}: ScrollProgressProps) {
  const progress = useScrollProgress()

  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-50 h-1 bg-border/30",
        position === "top" ? "top-0" : "bottom-0",
        className
      )}
    >
      <div
        className={cn(
          "h-full bg-gradient-to-r from-primary via-primary to-primary/70 transition-all duration-150 ease-out",
          barClassName
        )}
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}