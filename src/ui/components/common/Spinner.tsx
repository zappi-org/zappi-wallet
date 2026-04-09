import { cn } from '@/ui/lib/utils'

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  color?: 'primary' | 'white' | 'muted'
  className?: string
}

const sizeStyles = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-3',
}

const colorStyles = {
  primary: 'border-foreground/15 border-t-foreground',
  white: 'border-white/30 border-t-white',
  muted: 'border-foreground/10 border-t-foreground/50',
}

export function Spinner({
  size = 'md',
  color = 'primary',
  className,
}: SpinnerProps) {
  return (
    <div
      className={cn(
        'rounded-full animate-spin',
        sizeStyles[size],
        colorStyles[color],
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  )
}
