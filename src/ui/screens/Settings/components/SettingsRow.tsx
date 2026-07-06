import { useState, useCallback } from 'react'
import { ChevronRight, Copy, Check } from 'lucide-react'
import { cn } from '@/ui/lib/utils'

interface SettingsRowProps {
  label: string
  value?: string | null
  onPress: () => void
  variant?: 'nav' | 'copy' | 'danger'
  mono?: boolean
  truncateValue?: boolean
  badge?: number
}

export function SettingsRow({
  label,
  value,
  onPress,
  variant = 'nav',
  mono = false,
  truncateValue = false,
  badge,
}: SettingsRowProps) {
  const [copied, setCopied] = useState(false)

  const handlePress = useCallback(() => {
    onPress()
    if (variant === 'copy') {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [onPress, variant])

  return (
    <button
      onClick={handlePress}
      className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left min-h-[52px]"
    >
      <span className={cn(
        'text-body font-medium',
        variant === 'danger' && 'text-accent-danger',
      )}>
        {label}
      </span>
      <div className="flex items-center gap-1.5 min-w-0 ml-3">
        {badge !== undefined && badge > 0 && (
          <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent-danger text-white text-label font-semibold flex items-center justify-center leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {value && (
          <span className={cn(
            'text-body text-foreground-muted',
            mono && 'font-mono text-caption',
            truncateValue && 'truncate max-w-[160px]',
          )}>
            {value}
          </span>
        )}
        {variant === 'copy' ? (
          copied ? (
            <Check className="w-4 h-4 text-accent-primary shrink-0" />
          ) : (
            <Copy className="w-4 h-4 text-foreground-subtle shrink-0" />
          )
        ) : (
          <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" />
        )}
      </div>
    </button>
  )
}
