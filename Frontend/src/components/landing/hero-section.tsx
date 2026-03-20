import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChatDemo } from './chat-demo'
import { cn } from '@/lib/utils'
import {
  Sparkles,
  Target,
  Wand2,
  Route,
  ArrowRight
} from 'lucide-react'

function HeroSection() {
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background — near pure black like reference */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ backgroundColor: '#050508' }} />

        {/* Blue glow right side */}
        <div
          className="absolute top-0 right-0 w-[60%] h-full"
          style={{
            background: 'radial-gradient(ellipse 80% 100% at 100% 50%, rgba(75, 143, 240, 0.12) 0%, rgba(75, 143, 240, 0.06) 35%, transparent 70%)',
          }}
        />

        {/* Subtle top-left accent */}
        <div
          className="absolute top-0 left-0 w-[40%] h-[60%]"
          style={{
            background: 'radial-gradient(ellipse 60% 60% at 0% 0%, rgba(75, 143, 240, 0.05) 0%, transparent 60%)',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative w-full px-6 sm:px-8 lg:px-16 xl:px-24 py-24 pt-32">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center max-w-[1600px] mx-auto">

          {/* Left column */}
          <div className="text-center lg:text-left">

            {/* Badge */}
            <div
              className={cn("transition-all duration-700", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4")}
              style={{ transitionDelay: '100ms' }}
            >
              <Badge
                variant="outline"
                className="mb-6 px-4 py-2 rounded-full"
                style={{ borderColor: 'rgba(75, 143, 240, 0.35)', backgroundColor: 'rgba(75, 143, 240, 0.08)', color: '#4B8FF0' }}
              >
                <Sparkles className="w-3.5 h-3.5 mr-2" />
                AI-Powered Personal Tutor
              </Badge>
            </div>

            {/* Headline */}
            <h1
              className={cn("text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight leading-[1.1] transition-all duration-700", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
              style={{ transitionDelay: '200ms', color: '#F0F4FF' }}
            >
              Your smart{' '}
              <span style={{ background: 'linear-gradient(90deg, #4B8FF0 0%, #3DD6C8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                AI study partner
              </span>
              {' '}is here.
            </h1>

            {/* Subheadline */}
            <p
              className={cn("mt-6 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto lg:mx-0 transition-all duration-700", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
              style={{ transitionDelay: '300ms', color: '#8A95AA' }}
            >
              Chat, quiz, plan, and visualize your way to better grades — in any language you think in.
            </p>

            {/* CTAs */}
            <div
              className={cn("mt-8 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start transition-all duration-700", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
              style={{ transitionDelay: '400ms' }}
            >
              <Button asChild size="lg" className="text-base px-8 font-semibold text-white border-0" style={{ backgroundColor: '#4B8FF0' }}>
                <Link to="/chat">
                  Start Learning Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="text-base px-8" style={{ borderColor: 'rgba(240, 244, 255, 0.2)', color: '#F0F4FF', backgroundColor: 'transparent' }}>
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>

            {/* Trust line */}
            <p
              className={cn("mt-8 text-sm transition-all duration-700", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
              style={{ transitionDelay: '500ms', color: '#8A95AA' }}
            >
              Built for students. Grounded in your uploaded content. Fast, private, and context-aware.
            </p>

            {/* Feature pills */}
            <div
              className={cn("mt-6 flex flex-wrap gap-4 justify-center lg:justify-start transition-all duration-700", isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6")}
              style={{ transitionDelay: '600ms' }}
            >
              {[
                { icon: Target, label: 'Weak-area tracking' },
                { icon: Wand2, label: 'Mind maps & diagrams' },
                { icon: Route, label: 'Adaptive study plans' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-sm" style={{ color: '#8A95AA' }}>
                  <item.icon className="w-4 h-4" style={{ color: '#4B8FF0' }} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right column - Chat Demo */}
          <div
            className={cn("relative transition-all duration-1000", isLoaded ? "opacity-100 translate-x-0" : "opacity-0 translate-x-12")}
            style={{ transitionDelay: '400ms' }}
          >
            <ChatDemo />
          </div>
        </div>
      </div>
    </section>
  )
}

export { HeroSection }