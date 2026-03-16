import { cn } from '@/lib/utils'
import { formatSats, formatFiat } from '@/utils/format'

export interface AmountDisplayProps {
  amount: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeStyles = {
  sm: { amount: 'text-body-lg font-semibold', fiat: 'text-body-sm' },
  md: { amount: 'text-heading-lg', fiat: 'text-body-sm' },
  lg: { amount: 'text-display-lg', fiat: 'text-body' },
}

export function AmountDisplay({
  amount,
  size = 'md',
  className,
}: AmountDisplayProps) {
  const styles = sizeStyles[size]
  const fiat = formatFiat(amount)

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <span className={cn(styles.amount, 'text-foreground')}>{formatSats(amount)}</span>
      {fiat && (
        <span className={cn(styles.fiat, 'text-foreground-muted')}>≈ {fiat}</span>
      )}
    </div>
  )
}
