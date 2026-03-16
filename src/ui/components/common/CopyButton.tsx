import { useState, useCallback, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CopyButtonProps {
  value: string
  label?: string
  copiedLabel?: string
  icon?: ReactNode
  variant?: 'default' | 'ghost'
  className?: string
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  variant = 'default',
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = value
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [value])

  const variantStyles = {
    default: 'bg-foreground/[0.06] hover:bg-foreground/[0.09] active:scale-[0.97]',
    ghost: 'hover:bg-foreground/[0.04] active:scale-[0.97]',
  }

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'flex items-center justify-center gap-2 py-3 rounded-lg text-body font-medium transition-all min-h-[44px]',
        variantStyles[variant],
        className,
      )}
    >
      {copied ? (
        <Check className="w-4 h-4 text-accent-success" strokeWidth={2} />
      ) : (
        <Copy className="w-4 h-4 text-foreground-muted" strokeWidth={1.8} />
      )}
      <span className={copied ? 'text-accent-success' : 'text-foreground'}>
        {copied ? copiedLabel : label}
      </span>
    </button>
  )
}
