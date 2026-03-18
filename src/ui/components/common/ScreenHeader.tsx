import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ScreenHeaderProps {
  title?: string
  onBack?: () => void
  rightAction?: ReactNode
  variant?: 'default' | 'transparent'
  className?: string
}

export function ScreenHeader({
  title,
  onBack,
  rightAction,
  variant = 'default',
  className,
}: ScreenHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-center gap-2 px-4 h-14 shrink-0',
        variant === 'transparent' && 'bg-transparent',
        className,
      )}
    >
      {onBack ? (
        <button
          onClick={onBack}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-black/[0.04] active:bg-black/[0.06] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
      ) : (
        <div className="w-8" />
      )}

      {title && (
        <h1 className="text-heading-lg text-foreground flex-1 truncate">
          {title}
        </h1>
      )}

      {rightAction ? (
        <div className="shrink-0 flex items-center">{rightAction}</div>
      ) : (
        onBack && <div className="w-10" />
      )}
    </header>
  )
}
