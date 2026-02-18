import { Database } from 'lucide-react'
import { cn } from '@/components/ui/utils'

// Mint Icon Component
export function MintIcon({
  url,
  getIconUrl,
  size = 'md',
  className = ''
}: {
  url: string | null
  getIconUrl: (url: string) => string | undefined
  size?: 'sm' | 'md'
  className?: string
}) {
  const iconUrl = url ? getIconUrl(url) : undefined
  const sizeClasses = size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'
  const fallbackIconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'

  if (iconUrl) {
    return (
      <div className={cn(sizeClasses, 'rounded-full overflow-hidden bg-white/50 shrink-0', className)}>
        <img
          src={iconUrl}
          alt="Mint icon"
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>
    )
  }

  return (
    <div className={cn(
      sizeClasses,
      'rounded-full bg-gradient-to-br from-primary to-accent-primary flex items-center justify-center shrink-0',
      className
    )}>
      <Database className={cn(fallbackIconSize, 'text-white/80')} />
    </div>
  )
}

// Toggle Switch Component
export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-10 h-6 rounded-full transition-colors relative flex items-center px-1 shadow-inner',
        checked ? 'bg-primary' : 'bg-foreground-muted/30',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div
        className="w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-200"
        style={{ transform: `translateX(${checked ? 16 : 0}px)` }}
      />
    </button>
  )
}
