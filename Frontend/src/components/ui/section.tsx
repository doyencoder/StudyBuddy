import * as React from 'react'
import { cn } from '@/lib/utils'

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  narrow?: boolean
  spacious?: boolean
  noPadding?: boolean
}

function Section({
  className,
  children,
  narrow = false,
  spacious = false,
  noPadding = false,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn(
        'relative w-full',
        !noPadding && 'px-4 sm:px-6 lg:px-8',
        !noPadding && (spacious ? 'py-20 sm:py-28 lg:py-32' : 'py-16 sm:py-20 lg:py-24'),
        className
      )}
      {...props}
    >
      <div className={cn('mx-auto w-full', narrow ? 'max-w-4xl' : 'max-w-7xl')}>
        {children}
      </div>
    </section>
  )
}

interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  centered?: boolean
}

function SectionHeader({
  className,
  children,
  centered = true,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn('mb-12 sm:mb-16', centered && 'text-center', className)}
      {...props}
    >
      {children}
    </div>
  )
}

function SectionTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </h2>
  )
}

function SectionDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'mt-4 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-3xl',
        className
      )}
      {...props}
    >
      {children}
    </p>
  )
}

export { Section, SectionHeader, SectionTitle, SectionDescription }