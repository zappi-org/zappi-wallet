import { type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/ui/primitives/utils'

export type CSActionAccent = 'brand' | 'pending' | 'neutral'

interface CSActionRowProps {
  icon: ReactNode
  title: string
  subtitle?: string
  badge?: number | string
  accent?: CSActionAccent
  onClick: () => void
  disabled?: boolean
}

const ACCENT_CLASS: Record<CSActionAccent, string> = {
  brand: 'bg-brand-50',
  pending: 'bg-[#FFF6DC]',
  neutral: 'bg-[#F0F2F7]',
}

export function CSActionRow({
  icon,
  title,
  subtitle,
  badge,
  accent = 'brand',
  onClick,
  disabled,
}: CSActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-background-card border border-border rounded-[16px] flex items-center gap-3.5 text-left transition-transform active:scale-[0.99] disabled:opacity-60"
      style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 16, paddingBottom: 16 }}
    >
      <div
        className={cn(
          'w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0',
          ACCENT_CLASS[accent],
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-foreground tracking-[-0.01em] truncate">
            {title}
          </span>
          {badge !== undefined && badge !== 0 && (
            <span className="inline-flex items-center justify-center min-w-4 h-4 px-1.5 rounded-full bg-brand text-white text-[10px] font-bold leading-none">
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-[12px] text-foreground-muted mt-0.5 tracking-[-0.005em] truncate">
            {subtitle}
          </p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" strokeWidth={2} />
    </button>
  )
}
