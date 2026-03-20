import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const glassCardVariants = cva(
  'relative overflow-hidden transition-all duration-300',
  {
    variants: {
      variant: {
        default: [
          'bg-card/60 backdrop-blur-xl',
          'border border-border/50',
          'rounded-2xl',
        ].join(' '),
        solid: [
          'bg-card',
          'border border-border',
          'rounded-2xl',
        ].join(' '),
        subtle: [
          'bg-card/40 backdrop-blur-lg',
          'border border-border/30',
          'rounded-2xl',
        ].join(' '),
        elevated: [
          'bg-card',
          'border border-border',
          'rounded-2xl',
          'shadow-xl shadow-black/20',
        ].join(' '),
        outline: [
          'bg-transparent',
          'border border-border',
          'rounded-2xl',
        ].join(' '),
      },
      interactive: {
        true: 'hover:bg-card hover:border-border/80 hover:shadow-lg hover:shadow-black/10 hover:-translate-y-0.5 cursor-pointer',
        false: '',
      },
      glow: {
        none: '',
        primary: 'hover:shadow-[0_0_30px_hsl(var(--primary)/0.3)]',
        accent: 'hover:shadow-[0_0_30px_hsl(var(--accent)/0.3)]',
        soft: 'shadow-[0_0_40px_hsl(var(--primary)/0.15)]',
      },
      padding: {
        none: 'p-0',
        sm: 'p-4',
        md: 'p-6',
        lg: 'p-8',
        xl: 'p-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      interactive: false,
      glow: 'none',
      padding: 'md',
    },
  }
)

interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {}

function GlassCard({
  className,
  variant,
  interactive,
  glow,
  padding,
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(glassCardVariants({ variant, interactive, glow, padding }), className)}
      {...props}
    >
      {children}
    </div>
  )
}

function GlassCardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      {children}
    </div>
  )
}

function GlassCardIcon({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center',
        'w-10 h-10 rounded-xl',
        'bg-primary/10 text-primary',
        'mb-3',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function GlassCardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-lg font-semibold tracking-tight text-foreground', className)}
      {...props}
    >
      {children}
    </h3>
  )
}

function GlassCardDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-muted-foreground leading-relaxed', className)}
      {...props}
    >
      {children}
    </p>
  )
}

function GlassCardLabel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center',
        'px-2 py-0.5 rounded-md',
        'bg-primary/10 text-primary',
        'text-xs font-medium',
        'mt-3',
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

function GlassCardContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-4', className)} {...props}>
      {children}
    </div>
  )
}

export {
  GlassCard,
  GlassCardHeader,
  GlassCardIcon,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardLabel,
  GlassCardContent,
  glassCardVariants,
}