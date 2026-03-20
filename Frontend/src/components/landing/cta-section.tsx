import * as React from 'react'
import { Link } from 'react-router-dom'
import { Section } from '@/components/ui/section'
import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useScrollAnimation } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import { Sparkles, ArrowRight } from 'lucide-react'

function CTASection() {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.2 })

  return (
    <Section>
      <div
        ref={ref}
        className={cn(
          "relative opacity-0 transition-all duration-1000",
          isVisible && "opacity-100 translate-y-0 scale-100",
          !isVisible && "translate-y-12 scale-95"
        )}
      >
        {/* Background glow */}
        <AmbientGlow
          variant="primary"
          position="center"
          size="xl"
          intensity="low"
        />

        {/* CTA Container */}
        <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-card/40 backdrop-blur-xl group hover:border-primary/30 transition-colors duration-500">
          {/* Gradient border effect */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/20 via-transparent to-primary/10 pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="relative px-6 py-16 sm:px-12 sm:py-20 lg:px-16 lg:py-24 text-center">
            {/* Decorative pill */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-6 rounded-full border border-primary/30 bg-primary/5 text-primary text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              <span>Start learning today</span>
            </div>

            {/* Headline */}
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground max-w-3xl mx-auto">
              Ready to study with an AI that knows your material?
            </h2>

            {/* Supporting copy */}
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Upload your notes, ask better questions, and turn every weak topic into a guided plan for improvement.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" className="text-base px-8 group/btn">
                <Link to="/chat">
                  Start Learning Free
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover/btn:translate-x-1" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="text-base px-8">
                <Link to="/dashboard">View Dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

export { CTASection }