import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type React from 'react'

import type { ValidatedCashuRequest } from '@/core/domain/input-types'
import { SendingStep } from '@/ui/screens/Send/steps/SendingStep'
import { SendCompleteStep } from '@/ui/screens/Send/steps/SendCompleteStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ values }: { values?: Record<string, string> }) => (
    <span>
      {values?.recipient} {values?.amount}
    </span>
  ),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `₿${amount}`,
  useFormatFiat: () => () => '',
}))

vi.mock('@/ui/components/payment', () => ({
  SendingAnimation: () => <div data-testid="sending-animation" />,
}))

vi.mock('@/ui/components/payment/Confetti', () => ({
  Confetti: () => null,
}))

vi.mock('@/ui/utils/haptic', () => ({
  hapticSuccess: vi.fn(),
  hapticTap: vi.fn(),
}))

vi.mock('motion/react', () => ({
  motion: {
    img: ({
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...props
    }: {
      initial?: unknown
      animate?: unknown
      transition?: unknown
      [key: string]: unknown
    }) => <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />,
  },
}))

function makeDirectNpubRequest(): ValidatedCashuRequest {
  return {
    type: 'cashu-request',
    request: 'npub1recipient',
    parsed: {
      id: 'direct-test',
      unit: 'sat',
      mints: ['https://mint.test'],
      transports: [{ type: 'nostr', target: 'npub1recipient' }],
      hasNostrTransport: true,
      nostrTarget: 'npub1recipient',
      hasPostTransport: false,
      sameMintOnly: true,
    },
  }
}

describe('send status steps display name', () => {
  it('uses the address-book display name while sending a direct npub payment', () => {
    render(
      <SendingStep
        validatedData={makeDirectNpubRequest()}
        amount={1}
        displayName="Alice"
      />
    )

    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.queryByText(/eCash/)).not.toBeInTheDocument()
  })

  it('uses the address-book display name on direct npub payment completion', () => {
    render(
      <SendCompleteStep
        validatedData={makeDirectNpubRequest()}
        amount={1}
        displayName="Alice"
        onComplete={vi.fn()}
      />
    )

    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.queryByText(/eCash/)).not.toBeInTheDocument()
  })

  it('falls back to the direct npub target instead of generic eCash when no display name exists', () => {
    render(
      <SendingStep
        validatedData={makeDirectNpubRequest()}
        amount={1}
      />
    )

    expect(screen.getByText(/npub1recipient/)).toBeInTheDocument()
    expect(screen.queryByText(/eCash/)).not.toBeInTheDocument()
  })
})
