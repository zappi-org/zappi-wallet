import type { ReactNode } from 'react'

interface HintBoxProps {
  children: ReactNode
  className?: string
}

export function HintBox({ children, className = '' }: HintBoxProps) {
  return (
    <div className={`flex items-start gap-2.5 bg-foreground/[0.04] rounded-xl px-4 py-3 ${className}`}>
      <span className="text-caption leading-relaxed mt-px">💡</span>
      <div className="text-caption text-foreground-muted leading-relaxed">
        {children}
      </div>
    </div>
  )
}
