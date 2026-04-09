import { cn } from '@/ui/lib/utils'
import { formatSats, formatFiat } from '@/utils/format'

export interface AmountDisplayProps {
  amount: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeStyles = {
  sm: { amount: 'text-amount font-semibold font-display', fiat: 'text-caption' },
  md: { amount: 'text-amount-lg font-bold font-display', fiat: 'text-caption' },
  lg: { amount: 'text-display font-bold font-display', fiat: 'text-body' },
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
        <span className={cn(styles.fiat, 'text-foreground-muted')}>{fiat}</span>
      )}
    </div>
  )
}
