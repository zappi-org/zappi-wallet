import { type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/ui/lib/utils'
import { IconBadge, type IconBadgeColor } from './IconBadge'

/* ─── Section wrapper ─── */

export interface SettingsSectionProps {
  label?: string
  children: ReactNode
  className?: string
}

export function SettingsSection({ label, children, className }: SettingsSectionProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span className="text-caption text-foreground-muted px-1">
          {label}
        </span>
      )}
      <div className="bg-background-card rounded-xl overflow-hidden divide-y divide-foreground/[0.06]">
        {children}
      </div>
    </div>
  )
}

/* ─── Single item row ─── */

export interface SettingsItemProps {
  icon?: ReactNode
  iconColor?: IconBadgeColor
  label: string
  subtitle?: string
  right?: ReactNode
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
  className?: string
}

export function SettingsItem({
  icon,
  iconColor = 'primary',
  label,
  subtitle,
  right,
  onClick,
  destructive = false,
  disabled = false,
  className,
}: SettingsItemProps) {
  const Comp = onClick ? 'button' : 'div'

  return (
    <Comp
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-3 px-5 py-3.5 transition-colors min-h-[48px]',
        onClick && !disabled && 'hover:bg-foreground/[0.02] active:bg-foreground/[0.04]',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {icon && (
        <IconBadge icon={icon} color={iconColor} size="sm" />
      )}

      <div className="flex-1 min-w-0 text-left">
        <span className={cn(
          'text-body block',
          destructive ? 'text-accent-danger' : 'text-foreground',
        )}>
          {label}
        </span>
        {subtitle && (
          <span className="text-caption text-foreground-muted block truncate mt-0.5">
            {subtitle}
          </span>
        )}
      </div>

      {right ?? (onClick && (
        <ChevronRight className="w-4 h-4 text-foreground-subtle/60 shrink-0" />
      ))}
    </Comp>
  )
}
