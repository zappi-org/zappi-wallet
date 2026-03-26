import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  return (
    <header
      className={cn(
        'relative flex items-center justify-between px-5 h-14 shrink-0',
        variant === 'transparent' && 'bg-transparent',
        className,
      )}
    >
      {/* Left: back button or spacer */}
      {onBack ? (
        <button
          onClick={onBack}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
      ) : (
        <div className="w-10" />
      )}

      {/* Center: title */}
      {title && (
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold text-foreground pointer-events-none">
          {title}
        </h1>
      )}

      {/* Right: action or spacer */}
      {rightAction ? (
        <div className="shrink-0 flex items-center z-10">{rightAction}</div>
      ) : (
        <div className="w-10" />
      )}
    </header>
  )
}
