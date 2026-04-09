import { type ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

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
        <div className="mb-5 text-foreground-muted">{icon}</div>
      )}

      <p className="text-subtitle font-semibold text-foreground">{title}</p>

      {description && (
        <p className="text-body text-foreground-muted mt-1.5 max-w-[260px] leading-relaxed">
          {description}
        </p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-5 py-2.5 rounded-lg bg-accent-primary text-white text-body font-medium hover:bg-primary-hover active:scale-[0.98] transition-all"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
