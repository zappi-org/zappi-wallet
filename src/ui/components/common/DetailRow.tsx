import { type ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

export interface DetailRowProps {
  label: string
  value: ReactNode
  bold?: boolean
  className?: string
}

export function DetailRow({
  label,
  value,
  bold = false,
  className,
}: DetailRowProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <span className={cn('text-body text-foreground-muted shrink-0', bold && 'text-foreground font-medium')}>
        {label}
      </span>
      <span className={cn('text-body font-medium text-foreground text-right truncate', bold && 'font-semibold')}>
        {value}
      </span>
    </div>
  )
}
