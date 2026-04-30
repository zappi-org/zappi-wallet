import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/primitives/utils'

interface CSPageProps {
  title: string
  subtitle?: string
  onBack: () => void
  right?: ReactNode
  meta?: ReactNode
  children: ReactNode
  footer?: ReactNode
  noScroll?: boolean
}

export function CSPage({
  title,
  subtitle,
  onBack,
  right,
  meta,
  children,
  footer,
  noScroll,
}: CSPageProps) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[65]">
      <div className="px-5 pt-2 pb-4 shrink-0">
        <div className="flex items-center justify-between h-8 mb-3.5">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="w-8 h-8 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
          >
            <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
          </button>
          <div className="flex items-center">{right}</div>
        </div>
        {meta && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">{meta}</div>
        )}
        <h1 className="text-[22px] font-bold text-foreground leading-tight tracking-[-0.01em]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-[13px] text-foreground-muted leading-[1.5] tracking-[-0.005em]">
            {subtitle}
          </p>
        )}
      </div>
      <div
        className={cn(
          'relative flex-1',
          noScroll ? 'overflow-hidden flex flex-col' : 'overflow-y-auto',
        )}
      >
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-border/70 bg-background-card pb-safe">
          {footer}
        </div>
      )}
    </div>
  )
}
