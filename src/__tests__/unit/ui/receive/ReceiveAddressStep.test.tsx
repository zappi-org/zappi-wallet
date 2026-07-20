import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveAddressStep } from '@/ui/screens/Receive/steps/ReceiveAddressStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// QRCodeDisplay pulls in bc-ur -> cborg, whose package.json exports map
// vitest/vite can't resolve — same workaround as ReceiveQRStep.protocols.test.tsx.
// Value goes in a data attribute (not text content) so it doesn't collide
// with the plaintext address the step renders below the QR.
vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: ({ value }: { value: string }) => <div data-testid="qr-value" data-value={value} />,
}))

const base = {
  onBack: vi.fn(), onTabChange: vi.fn(), onEditMint: vi.fn(),
  onDirectReceive: vi.fn(), onSpecifyAmount: vi.fn(),
  lightningAddress: 'john@zappi.link', npub: 'npub1testxyz',
  mintUrl: 'https://mint.a', mintDisplayName: 'Lemonfizz',
}

describe('ReceiveAddressStep', () => {
  it('lightning tab shows address, account card, and both actions', () => {
    render(<ReceiveAddressStep {...base} addressTab="lightning" />)
    expect(screen.getByText('john@zappi.link')).toBeInTheDocument()
    expect(screen.getByText('Lemonfizz')).toBeInTheDocument()
    fireEvent.click(screen.getByText('receive.landing.specifyAmount'))
    expect(base.onSpecifyAmount).toHaveBeenCalled()
    fireEvent.click(screen.getByText('receive.landing.directReceive'))
    expect(base.onDirectReceive).toHaveBeenCalled()
  })

  it('nostr tab shows npub and hides the account card', () => {
    render(<ReceiveAddressStep {...base} addressTab="nostr" />)
    expect(screen.getByText('npub1testxyz')).toBeInTheDocument()
    expect(screen.queryByText('Lemonfizz')).not.toBeInTheDocument()
  })

  it('missing lightning address shows create CTA', () => {
    const onCreateAddress = vi.fn()
    render(<ReceiveAddressStep {...base} addressTab="lightning" lightningAddress={null} onCreateAddress={onCreateAddress} />)
    fireEvent.click(screen.getByText('receive.landing.createAddress'))
    expect(onCreateAddress).toHaveBeenCalled()
  })
})
