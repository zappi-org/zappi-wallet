import { CircleDot, Zap } from 'lucide-react'
import nostrIcon from '@/assets/nostr-icon.svg'

export type RecipientEndpointKind = 'generic' | 'lightning' | 'nostr'

interface RecipientEndpointIconProps {
  kind: RecipientEndpointKind
  className?: string
}

export function RecipientEndpointIcon({
  kind,
  className = 'h-7 w-7',
}: RecipientEndpointIconProps) {
  if (kind === 'nostr') {
    return <img src={nostrIcon} alt="" aria-hidden className={`${className} object-contain`} data-testid="recipient-nostr-icon" />
  }

  if (kind === 'lightning') {
    return <Zap className={`${className} fill-current text-amber-500`} strokeWidth={1.8} aria-hidden data-testid="recipient-lightning-icon" />
  }

  return <CircleDot className={`${className} text-brand`} strokeWidth={1.8} aria-hidden data-testid="recipient-generic-icon" />
}
