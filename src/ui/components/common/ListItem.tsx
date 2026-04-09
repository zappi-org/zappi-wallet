import { type ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

export interface ListItemProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  right?: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}

export function ListItem({
  icon,
  title,
  subtitle,
  right,
  onClick,
  disabled = false,
  className,
}: ListItemProps) {
  const Comp = onClick ? 'button' : 'div'

  return (
    <Comp
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-3 px-5 py-3.5 min-h-[52px] transition-colors',
        onClick && !disabled && 'hover:bg-foreground/[0.02] active:bg-foreground/[0.04] cursor-pointer',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {icon && (
        <div className="shrink-0">{icon}</div>
      )}

      <div className="flex-1 min-w-0 text-left">
        <span className="text-body text-foreground block truncate">
          {title}
        </span>
        {subtitle && (
          <span className="text-caption text-foreground-muted block truncate mt-0.5">
            {subtitle}
          </span>
        )}
      </div>

      {right && (
        <div className="shrink-0 flex items-center">{right}</div>
      )}
    </Comp>
  )
}
