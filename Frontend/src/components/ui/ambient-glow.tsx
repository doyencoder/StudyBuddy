import * as React from 'react'
import { cn } from '@/lib/utils'

interface AmbientGlowProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'primary' | 'accent' | 'mixed'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  animate?: boolean
  intensity?: 'low' | 'medium' | 'high'
}

function AmbientGlow({
  className,
  variant = 'primary',
  size = 'lg',
  position = 'center',
  animate = true,
  intensity = 'medium',
  ...props
}: AmbientGlowProps) {
  const sizeClasses = {
    sm: 'w-48 h-48',
    md: 'w-72 h-72',
    lg: 'w-96 h-96',
    xl: 'w-[500px] h-[500px]',
  }

  const positionClasses = {
    center: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
    'top-left': 'left-0 top-0 -translate-x-1/4 -translate-y-1/4',
    'top-right': 'right-0 top-0 translate-x-1/4 -translate-y-1/4',
    'bottom-left': 'left-0 bottom-0 -translate-x-1/4 translate-y-1/4',
    'bottom-right': 'right-0 bottom-0 translate-x-1/4 translate-y-1/4',
  }

  const intensityClasses = {
    low: 'opacity-20',
    medium: 'opacity-30',
    high: 'opacity-50',
  }

  const variantColors = {
    primary: 'bg-primary',
    accent: 'bg-accent',
    mixed: 'bg-gradient-to-br from-primary via-accent to-primary',
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute rounded-full blur-3xl',
        sizeClasses[size],
        positionClasses[position],
        intensityClasses[intensity],
        variantColors[variant],
        animate && 'animate-glow-pulse',
        className
      )}
      aria-hidden="true"
      {...props}
    />
  )
}

interface BackgroundOrbsProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: 1 | 2 | 3 | 4 | 5
}

function BackgroundOrbs({
  className,
  count = 3,
  ...props
}: BackgroundOrbsProps) {
  const orbs = [
    { variant: 'primary' as const, position: 'top-left' as const, size: 'lg' as const, intensity: 'low' as const },
    { variant: 'accent' as const, position: 'top-right' as const, size: 'md' as const, intensity: 'low' as const },
    { variant: 'primary' as const, position: 'bottom-right' as const, size: 'xl' as const, intensity: 'low' as const },
    { variant: 'accent' as const, position: 'bottom-left' as const, size: 'md' as const, intensity: 'low' as const },
    { variant: 'mixed' as const, position: 'center' as const, size: 'lg' as const, intensity: 'low' as const },
  ]

  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden="true"
      {...props}
    >
      {orbs.slice(0, count).map((orb, index) => (
        <AmbientGlow
          key={index}
          variant={orb.variant}
          position={orb.position}
          size={orb.size}
          intensity={orb.intensity}
        />
      ))}
    </div>
  )
}

export { AmbientGlow, BackgroundOrbs }