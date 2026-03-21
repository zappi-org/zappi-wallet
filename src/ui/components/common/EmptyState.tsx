import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center px-8', className)}>
      {icon && (
        <div className="w-14 h-14 bg-foreground/[0.04] rounded-[13px] flex items-center justify-center mb-5">
          <div className="text-foreground/40">{icon}</div>
        </div>
      )}

      <p className="text-subtitle text-foreground">{title}</p>

      {description && (
        <p className="text-body text-foreground-muted mt-1.5 max-w-[260px] leading-relaxed">
          {description}
        </p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-5 py-2.5 rounded-lg bg-accent-primary text-white text-body font-medium hover:bg-primary-hover active:scale-[0.97] transition-all"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
