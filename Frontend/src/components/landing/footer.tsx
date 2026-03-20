import * as React from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { GraduationCap } from 'lucide-react'

function Footer({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  const currentYear = new Date().getFullYear()

  return (
    <footer className={cn('border-t border-border/50 bg-background', className)} {...props}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

          {/* Brand */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary/20 transition-colors duration-200">
              <GraduationCap className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-foreground">StudyBuddy</span>
          </Link>

          {/* Links */}
          <div className="flex items-center gap-6">
            {[
              { label: 'Features', href: '#features' },
              { label: 'How it Works', href: '#how-it-works' },
              { label: 'Dashboard', href: '/dashboard' },
            ].map((link) => (
              link.href.startsWith('#') ? (
                <a key={link.href} href={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200">
                  {link.label}
                </a>
              ) : (
                <Link key={link.href} to={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200">
                  {link.label}
                </Link>
              )
            ))}
          </div>
        </div>

        {/* Copyright — single thin line */}
        <div className="border-t border-border/30 py-3">
          <p className="text-xs text-muted-foreground">
            &copy; {currentYear} StudyBuddy. Built for focused learning.
          </p>
        </div>
      </div>
    </footer>
  )
}

export { Footer }