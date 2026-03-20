import { cn } from '@/lib/utils'
import { useScrollAnimation } from '@/hooks/use-scroll-animation'
import { forwardRef, type HTMLAttributes } from 'react'

interface AnimatedSectionProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'article'
  animation?: 'fade-up' | 'fade-in' | 'scale-in' | 'slide-up'
  delay?: number
  threshold?: number
}

const AnimatedSection = forwardRef<HTMLElement, AnimatedSectionProps>(
  (
    {
      as: Component = 'section',
      animation = 'fade-up',
      delay = 0,
      threshold = 0.1,
      className,
      children,
      style,
      ...props
    },
    forwardedRef
  ) => {
    const { ref, isVisible } = useScrollAnimation<HTMLElement>({ threshold })

    const animationClasses = {
      'fade-up': 'animate-fade-in-up',
      'fade-in': 'animate-fade-in',
      'scale-in': 'animate-scale-in',
      'slide-up': 'animate-slide-up',
    }

    return (
      <Component
        ref={(node) => {
          (ref as React.MutableRefObject<HTMLElement | null>).current = node
          if (typeof forwardedRef === 'function') {
            forwardedRef(node)
          } else if (forwardedRef) {
            forwardedRef.current = node
          }
        }}
        className={cn(
          'opacity-0',
          isVisible && animationClasses[animation],
          className
        )}
        style={{
          ...style,
          animationDelay: isVisible ? `${delay}ms` : undefined,
          animationFillMode: 'forwards',
        }}
        {...props}
      >
        {children}
      </Component>
    )
  }
)

AnimatedSection.displayName = 'AnimatedSection'

export { AnimatedSection }