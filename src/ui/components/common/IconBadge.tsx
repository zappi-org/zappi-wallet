import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type IconBadgeColor = 'primary' | 'success' | 'warning' | 'danger' | 'muted' | 'default'
export type IconBadgeSize = 'sm' | 'md' | 'lg'

export interface IconBadgeProps {
  icon: ReactNode
  color?: IconBadgeColor
  size?: IconBadgeSize
  className?: string
}

const colorStyles: Record<IconBadgeColor, string> = {
  default: 'bg-foreground/[0.05] text-foreground/70',
  primary: 'bg-foreground/[0.05] text-foreground/70',
  success: 'bg-accent-success/[0.08] text-accent-success',
  warning: 'bg-accent-warning/[0.10] text-accent-warning',
  danger: 'bg-accent-danger/[0.08] text-accent-danger',
  muted: 'bg-foreground/[0.04] text-foreground-muted',
}

const sizeStyles: Record<IconBadgeSize, string> = {
  sm: 'w-[30px] h-[30px] rounded-[8px]',
  md: 'w-9 h-9 rounded-[10px]',
  lg: 'w-11 h-11 rounded-[12px]',
}

export function IconBadge({
  icon,
  color = 'default',
  size = 'md',
  className,
}: IconBadgeProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center shrink-0',
        colorStyles[color],
        sizeStyles[size],
        className,
      )}
    >
      {icon}
    </div>
  )
}
