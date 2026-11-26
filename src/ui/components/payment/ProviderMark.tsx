import { useEffect, useRef } from 'react'
import { hallmark, HALLMARK_VIEWBOX } from 'hallmarks'
import { cn } from '@/ui/lib/utils'

export interface ProviderMarkProps {
  identifier: string
  width?: number
  className?: string
}

export function ProviderMark({ identifier, width = 24, className }: ProviderMarkProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const height = Math.round((width * HALLMARK_VIEWBOX.height) / HALLMARK_VIEWBOX.width)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const mark = hallmark(identifier, { style: 'standard' })
    mark.setAttribute('width', String(width))
    mark.setAttribute('height', String(height))
    mark.setAttribute('aria-hidden', 'true')
    mark.setAttribute('focusable', 'false')
    host.replaceChildren(mark)
    return () => {
      host.replaceChildren()
    }
  }, [identifier, width, height])

  return (
    <span
      ref={hostRef}
      data-testid="provider-mark"
      className={cn('inline-flex shrink-0', className)}
      style={{ width, height }}
    />
  )
}
