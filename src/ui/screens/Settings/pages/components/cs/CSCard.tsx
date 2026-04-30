import { type ReactNode } from 'react'
import { cn } from '@/ui/primitives/utils'

interface CSCardProps {
  children: ReactNode
  onClick?: () => void
  className?: string
  padding?: 'none' | 'sm' | 'md'
  as?: 'div' | 'button'
}

const PADDING_CLASS = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
} as const

export function CSCard({ children, onClick, className, padding = 'md', as }: CSCardProps) {
  const Component = as ?? (onClick ? 'button' : 'div')
  const interactive = Boolean(onClick)

  return (
    <Component
      type={Component === 'button' ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'block w-full text-left bg-background-card border border-border rounded-[16px] transition-transform',
        PADDING_CLASS[padding],
        interactive && 'active:scale-[0.99]',
        className,
      )}
    >
      {children}
    </Component>
  )
}
