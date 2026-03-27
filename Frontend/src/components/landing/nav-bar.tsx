import * as React from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { GraduationCap, Menu, X } from 'lucide-react'

interface NavItem {
  label: string
  href: string
}

interface NavBarProps extends React.HTMLAttributes<HTMLElement> {
  brandName?: string
  items?: NavItem[]
  ctaText?: string
  ctaHref?: string
}

function NavBar({
  className,
  brandName = 'StudyBuddy',
  items = [
    { label: 'Features', href: '#features' },
    { label: 'How it Works', href: '#how-it-works' },
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Nova', href: '/nova' },
  ],
  ctaText = 'Start Learning',
  ctaHref = '/chat',
  ...props
}: NavBarProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [isScrolled, setIsScrolled] = React.useState(false)
  const navRef = React.useRef<HTMLElement>(null)

  const handleAnchorClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      const targetId = href.replace('#', '')
      const target = document.getElementById(targetId)
      if (!target) return

      event.preventDefault()
      const navHeight = navRef.current?.offsetHeight ?? 0
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 12

      window.scrollTo({
        top: Math.max(top, 0),
        behavior: 'smooth',
      })
      setIsOpen(false)
    },
    []
  )

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
      // Close menu when user scrolls
      if (window.scrollY > 10) setIsOpen(false)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Close menu when tapping anywhere outside the nav
  React.useEffect(() => {
    if (!isOpen) return
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [isOpen])

  return (
    <nav
      ref={navRef}
      className={cn(
        'fixed top-0 left-0 right-0 z-50',
        'transition-all duration-300',
        isScrolled
          ? 'bg-background/90 backdrop-blur-xl border-b border-border/50 shadow-sm'
          : 'bg-transparent',
        className
      )}
      {...props}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div
              className={cn(
                'flex items-center justify-center',
                'w-9 h-9 rounded-xl',
                'bg-primary/10 text-primary',
                'transition-all duration-200',
                'group-hover:bg-primary/20'
              )}
            >
              <GraduationCap className="w-5 h-5" />
            </div>
            <span className="text-lg font-semibold text-foreground">{brandName}</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:gap-1">
            {items.map((item) => (
              item.href.startsWith('#') ? (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={(event) => handleAnchorClick(event, item.href)}
                  className={cn(
                    'relative px-4 py-2 text-sm font-medium',
                    'text-muted-foreground hover:text-foreground',
                    'transition-all duration-200',
                    'rounded-lg hover:bg-accent/50',
                    'group'
                  )}
                >
                  {item.label}
                  <span className="absolute bottom-1 left-4 right-4 h-px bg-primary scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                </a>
              ) : (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'relative px-4 py-2 text-sm font-medium',
                    'text-muted-foreground hover:text-foreground',
                    'transition-all duration-200',
                    'rounded-lg hover:bg-accent/50',
                    'group'
                  )}
                >
                  {item.label}
                  <span className="absolute bottom-1 left-4 right-4 h-px bg-primary scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
                </Link>
              )
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex md:items-center md:gap-3">
            <Button asChild size="sm">
              <Link to={ctaHref}>{ctaText}</Link>
            </Button>
          </div>

          {/* Mobile menu button */}
          <button
            type="button"
            className="md:hidden p-2 text-muted-foreground hover:text-foreground"
            onClick={() => setIsOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation — animated slide-down */}
      <div
        className={cn(
          'md:hidden overflow-hidden transition-all duration-300 ease-in-out',
          isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
        )}
        style={{ background: 'hsl(var(--background) / 0.97)', backdropFilter: 'blur(20px)' }}
      >
        <div className="border-b border-border/50 px-4 py-4 space-y-1">
          {items.map((item) => (
            item.href.startsWith('#') ? (
              <a
                key={item.href}
                href={item.href}
                onClick={(event) => handleAnchorClick(event, item.href)}
                className={cn(
                  'block px-3 py-2.5 text-sm font-medium rounded-lg',
                  'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  'transition-colors duration-200'
                )}
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'block px-3 py-2.5 text-sm font-medium rounded-lg',
                  'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  'transition-colors duration-200'
                )}
                onClick={() => setIsOpen(false)}
              >
                {item.label}
              </Link>
            )
          ))}
          <div className="pt-2 pb-1">
            <Button asChild className="w-full" size="sm" onClick={() => setIsOpen(false)}>
              <Link to={ctaHref}>{ctaText}</Link>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  )
}

export { NavBar }
