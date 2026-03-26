import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface FilterChipProps {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
  truncate?: boolean
}

export function FilterChip({ icon, label, active, onClick, truncate }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-8 rounded-full flex items-center gap-1.5 px-3 font-medium transition-colors whitespace-nowrap',
        'text-caption font-medium',
        active ? 'bg-primary/10 text-primary' : 'bg-background-card text-foreground-muted',
      )}
    >
      {icon}
      <span className={truncate ? 'max-w-[80px] truncate' : undefined}>{label}</span>
    </button>
  )
}
