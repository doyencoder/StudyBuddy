import * as React from 'react'
import { Section, SectionHeader, SectionTitle, SectionDescription } from '@/components/ui/section'
import { BentoGrid, BentoItem } from '@/components/ui/bento-grid'
import {
  GlassCard,
  GlassCardIcon,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardLabel
} from '@/components/ui/glass-card'
import { useScrollAnimation } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import {
  MessageSquare,
  Wand2,
  Timer,
  Target,
  LineChart,
  UploadCloud
} from 'lucide-react'

const features = [
  {
    icon: MessageSquare,
    title: 'RAG chat grounded in your own notes',
    description: 'Ask anything about the PDFs, images, and notes you uploaded. StudyBuddy retrieves context from your material so answers stay relevant, specific, and exam-ready.',
    label: 'Context-aware answers',
    colSpan: 2 as const,
    rowSpan: 1 as const,
  },
  {
    icon: Wand2,
    title: 'Dynamic diagrams and mind maps',
    description: 'Generate Mermaid flowcharts, concept maps, and visual breakdowns when a topic needs structure, not just text.',
    label: 'Visual learning',
    colSpan: 1 as const,
    rowSpan: 1 as const,
  },
  {
    icon: Timer,
    title: 'AI quizzes with timers',
    description: 'Create topic-based quizzes, track scores, and identify weak areas instantly with performance-aware feedback.',
    label: 'Practice mode',
    colSpan: 1 as const,
    rowSpan: 1 as const,
  },
  {
    icon: Target,
    title: 'Study plans that turn weakness into action',
    description: 'Convert weak topics into long-term goals, weekly tasks, and clear revision plans you can actually follow.',
    label: 'Actionable goals',
    colSpan: 1 as const,
    rowSpan: 1 as const,
  },
  {
    icon: LineChart,
    title: 'Analytics that show real progress',
    description: 'Track streaks, topic mastery, score trends, and improvement over time from a clean dashboard.',
    label: 'Progress tracking',
    colSpan: 1 as const,
    rowSpan: 1 as const,
  },
  {
    icon: UploadCloud,
    title: 'Upload-first workflow',
    description: 'Start with PDFs, screenshots, or handwritten notes. No setup friction — just upload and begin learning.',
    label: 'Fast onboarding',
    colSpan: 1 as const,
    rowSpan: 1 as const,
  },
]

function FeatureCard({
  feature,
  index
}: {
  feature: typeof features[number]
  index: number
}) {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.1 })

  return (
    <BentoItem
      colSpan={feature.colSpan}
      rowSpan={feature.rowSpan}
    >
      <div
        ref={ref}
        className={cn(
          "h-full opacity-0 transition-all duration-700",
          isVisible && "opacity-100 translate-y-0",
          !isVisible && "translate-y-8"
        )}
        style={{ transitionDelay: `${index * 100}ms` }}
      >
        <GlassCard
          interactive
          glow="primary"
          padding="lg"
          className="h-full group"
        >
          <GlassCardIcon className="group-hover:scale-110 group-hover:bg-primary/20 transition-transform duration-300">
            <feature.icon className="w-5 h-5" />
          </GlassCardIcon>
          <GlassCardTitle className="group-hover:text-primary transition-colors duration-300">
            {feature.title}
          </GlassCardTitle>
          <GlassCardDescription className="mt-2">
            {feature.description}
          </GlassCardDescription>
          <GlassCardLabel>{feature.label}</GlassCardLabel>
        </GlassCard>
      </div>
    </BentoItem>
  )
}

function FeaturesSection() {
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.2 })

  return (
    <Section id="features">
      <div
        ref={headerRef}
        className={cn(
          "opacity-0 transition-all duration-700",
          headerVisible && "opacity-100 translate-y-0",
          !headerVisible && "translate-y-6"
        )}
      >
        <SectionHeader>
          <SectionTitle>Everything you need to study smarter</SectionTitle>
          <SectionDescription className="mx-auto">
            StudyBuddy combines grounded AI chat, visual explanation tools, quiz generation, and long-term progress tracking in one focused workspace.
          </SectionDescription>
        </SectionHeader>
      </div>

      <BentoGrid columns={3}>
        {features.map((feature, index) => (
          <FeatureCard key={feature.title} feature={feature} index={index} />
        ))}
      </BentoGrid>
    </Section>
  )
}

export { FeaturesSection }