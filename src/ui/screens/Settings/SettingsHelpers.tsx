import { Database } from 'lucide-react'
import { cn } from '@/ui/lib/utils'

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
      <div className={cn(sizeClasses, 'rounded-lg overflow-hidden bg-foreground/[0.04] shrink-0', className)}>
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
      'rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0',
      className
    )}>
      <Database className={cn(fallbackIconSize, 'text-foreground-muted')} />
    </div>
  )
}
