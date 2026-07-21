import { CircleDot, Link, Zap } from 'lucide-react'
import nostrIcon from '@/assets/nostr-icon.svg'
import type { ContactAddressType } from '@/core/types'

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

/** Contact-row glyph shared by the address book and the send-flow contact
    list, so the same contact never wears two different icons. */
export function ContactAddressIcon({ type }: { type: ContactAddressType }) {
  if (type === 'lightning') return <RecipientEndpointIcon kind="lightning" />
  if (type === 'npub') return <RecipientEndpointIcon kind="nostr" />
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground-muted">
      <Link className="h-[16px] w-[16px] text-white" aria-hidden />
    </span>
  )
}
