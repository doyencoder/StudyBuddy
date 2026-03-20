import * as React from 'react'
import { cn } from '@/lib/utils'

interface BentoGridProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4
}

function BentoGrid({
  className,
  columns = 3,
  children,
  ...props
}: BentoGridProps) {
  return (
    <div
      className={cn(
        'grid gap-4 sm:gap-6',
        {
          'grid-cols-1 md:grid-cols-2': columns === 2,
          'grid-cols-1 md:grid-cols-2 lg:grid-cols-3': columns === 3,
          'grid-cols-1 md:grid-cols-2 lg:grid-cols-4': columns === 4,
        },
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface BentoItemProps extends React.HTMLAttributes<HTMLDivElement> {
  colSpan?: 1 | 2 | 3 | 4
  rowSpan?: 1 | 2 | 3
}

function BentoItem({
  className,
  colSpan = 1,
  rowSpan = 1,
  children,
  ...props
}: BentoItemProps) {
  return (
    <div
      className={cn(
        {
          'md:col-span-1': colSpan === 1,
          'md:col-span-2': colSpan === 2,
          'lg:col-span-3': colSpan === 3,
          'lg:col-span-4': colSpan === 4,
          'row-span-1': rowSpan === 1,
          'row-span-2': rowSpan === 2,
          'row-span-3': rowSpan === 3,
        },
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { BentoGrid, BentoItem }