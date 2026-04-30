import { cn } from '@/ui/lib/utils'
import type { ReactNode } from 'react'

export interface BottomActionBarProps {
  children: ReactNode
  /** 자식 간 세로 간격 */
  gap?: 'none' | 'sm' | 'md' | 'lg'
  className?: string
}

const GAP_CLASS: Record<NonNullable<BottomActionBarProps['gap']>, string> = {
  none: 'gap-0',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
}

export function BottomActionBar({
  children,
  gap = 'sm',
  className,
}: BottomActionBarProps) {
  return (
    <div
      className={cn('px-2 pb-app shrink-0 flex flex-col', GAP_CLASS[gap], className)}
    >
      {children}
    </div>
  )
}
