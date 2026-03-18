import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type AlertVariant = 'info' | 'warning' | 'danger'

export interface AlertProps {
  variant?: AlertVariant
  icon?: ReactNode
  children: ReactNode
  className?: string
}

const barColors: Record<AlertVariant, string> = {
  info: 'bg-accent-primary',
  warning: 'bg-accent-warning',
  danger: 'bg-accent-danger',
}

const bgColors: Record<AlertVariant, string> = {
  info: 'bg-accent-primary/[0.05]',
  warning: 'bg-accent-warning/[0.06]',
  danger: 'bg-accent-danger/[0.05]',
}

const iconColors: Record<AlertVariant, string> = {
  info: 'text-accent-primary',
  warning: 'text-accent-warning',
  danger: 'text-accent-danger',
}

export function Alert({
  variant = 'info',
  icon,
  children,
  className,
}: AlertProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl overflow-hidden',
        bgColors[variant],
        className,
      )}
      role="alert"
    >
      <div className={cn('w-[3px] self-stretch shrink-0 rounded-full', barColors[variant])} />
      {icon && (
        <div className={cn('shrink-0 mt-3', iconColors[variant])}>
          {icon}
        </div>
      )}
      <div className={cn('text-body text-foreground flex-1 py-3', icon ? 'pr-4' : 'px-2 pr-4')}>
        {children}
      </div>
    </div>
  )
}
