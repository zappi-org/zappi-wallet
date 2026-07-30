import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecipientEndpointIcon } from '@/ui/components/payment/RecipientEndpointIcon'

describe('RecipientEndpointIcon', () => {
  it('uses one lightning glyph for every Lightning recipient', () => {
    render(<RecipientEndpointIcon kind="lightning" />)
    expect(screen.getByTestId('recipient-lightning-icon')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the Nostr asset without a background wrapper', () => {
    const { container } = render(<RecipientEndpointIcon kind="nostr" />)
    expect(screen.getByTestId('recipient-nostr-icon')).toBeInTheDocument()
    expect(container.querySelector('div')).not.toBeInTheDocument()
  })
})
