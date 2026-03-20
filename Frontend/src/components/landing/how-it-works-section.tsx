import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const STEPS = [
  {
    number: "01",
    title: "Upload Your Materials",
    description:
      "Drop in PDFs, images, or paste your class notes. StudyBuddy reads and understands everything.",
  },
  {
    number: "02",
    title: "Chat with Your Content",
    description:
      "Ask questions, request explanations, or dive deep into specific topics. Your AI tutor knows your material.",
  },
  {
    number: "03",
    title: "Generate Study Tools",
    description:
      "Create quizzes, flashcards, mind maps, and study plans tailored to your learning goals.",
  },
  {
    number: "04",
    title: "Master Your Subject",
    description:
      "Track progress, identify weak areas, and get personalized recommendations to ace your exams.",
  },
]

function HowItWorksSection() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [visibleSteps, setVisibleSteps] = useState<Set<number>>(new Set())

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const stepIndex = parseInt(
            entry.target.getAttribute("data-step") || "0"
          )
          if (entry.isIntersecting) {
            setVisibleSteps((prev) => new Set([...prev, stepIndex]))
          }
        })
      },
      { threshold: 0.3, rootMargin: "-100px" }
    )

    const stepElements = sectionRef.current?.querySelectorAll("[data-step]")
    stepElements?.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative py-24 md:py-32 px-4 sm:px-6 lg:px-8"
    >
      <div className="relative max-w-5xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-24">
          <div className="inline-flex items-center px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-sm font-medium mb-6">
            How It Works
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground">
            From notes to mastery in{" "}
            <span className="text-primary">four steps</span>
          </h2>
        </div>

        {/* Timeline container */}
        <div className="relative">
          {/* Center vertical line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-border" />

          {/* Steps */}
          <div className="relative">
            {STEPS.map((step, index) => {
              const isLeft = index % 2 === 0
              const isVisible = visibleSteps.has(index)

              return (
                <div
                  key={step.number}
                  data-step={index}
                  className={cn(
                    "relative flex items-center justify-center py-16 first:pt-0 last:pb-0 transition-all duration-700 ease-out",
                    isVisible
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-12"
                  )}
                  style={{ transitionDelay: `${index * 200}ms` }}
                >
                  {/* Left content area */}
                  <div className="w-[45%] pr-12">
                    {isLeft && (
                      <div className="text-right">
                        <h3 className="text-xl md:text-2xl font-bold text-foreground mb-3">
                          {step.title}
                        </h3>
                        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Center circle */}
                  <div
                    className={cn(
                      "relative z-10 w-14 h-14 rounded-full border-2 flex items-center justify-center bg-background transition-all duration-500",
                      isVisible ? "border-primary scale-100" : "border-border scale-90"
                    )}
                  >
                    <span
                      className={cn(
                        "text-lg font-semibold transition-colors duration-500",
                        isVisible ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {step.number}
                    </span>
                  </div>

                  {/* Right content area */}
                  <div className="w-[45%] pl-12">
                    {!isLeft && (
                      <div className="text-left">
                        <h3 className="text-xl md:text-2xl font-bold text-foreground mb-3">
                          {step.title}
                        </h3>
                        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

export { HowItWorksSection }