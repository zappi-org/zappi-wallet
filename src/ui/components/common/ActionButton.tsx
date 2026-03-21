import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ActionButtonColor = 'primary' | 'warning' | 'muted'

export interface ActionButtonProps {
  icon: ReactNode
  label: string
  onClick: () => void
  color?: ActionButtonColor
  disabled?: boolean
  className?: string
}

const iconColorStyles: Record<ActionButtonColor, string> = {
  primary: 'text-foreground',
  warning: 'text-accent-warning',
  muted: 'text-foreground-muted',
}

export function ActionButton({
  icon,
  label,
  onClick,
  color = 'primary',
  disabled = false,
  className,
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center gap-2 w-20 active:scale-[0.92] transition-transform disabled:opacity-40',
        className,
      )}
    >
      <div className="w-14 h-14 bg-background-card rounded-[13px] flex items-center justify-center shadow-action">
        <div className={iconColorStyles[color]}>{icon}</div>
      </div>
      <span className="text-caption text-foreground-muted font-medium">{label}</span>
    </button>
  )
}
