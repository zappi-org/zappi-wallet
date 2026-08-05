import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { sat } from '@/core/domain/amount'
import type { ValidatedCashuToken } from '@/core/domain/input-types'
import { ConfirmTrustedStep } from '@/ui/screens/Receive/redeem/ConfirmTrustedStep'
import { ConfirmUntrustedStep } from '@/ui/screens/Receive/redeem/ConfirmUntrustedStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const addToast = vi.fn()
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sat`,
  useFormatFiat: () => () => null,
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: () => 'Trusted Mint',
    getIconUrl: () => null,
    getMetadata: () => null,
  }),
}))

vi.mock('@/ui/utils/haptic', () => ({ hapticError: vi.fn() }))

const token: ValidatedCashuToken = {
  type: 'cashu-token',
  token: 'cashuBtest',
  mintUrl: 'https://trusted.mint',
  amount: sat(21),
}

describe('receive confirmation handoff', () => {
  it('keeps the trusted receive button busy after success until the parent replaces the screen', async () => {
    let resolveReceive: () => void = () => {}
    const onReceive = vi.fn(
      () => new Promise<void>((resolve) => { resolveReceive = resolve }),
    )

    render(
      <ConfirmTrustedStep
        token={token}
        onBack={vi.fn()}
        onReceive={onReceive}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'receive.token.receive' }))
    const busyButton = screen.getByRole('button', { name: 'tokenRegister.receiving' })
    expect(busyButton).toBeDisabled()
    expect(busyButton.className).not.toContain('disabled:bg-foreground/[0.035]')

    await act(async () => { resolveReceive() })

    expect(screen.getByRole('button', { name: 'tokenRegister.receiving' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'receive.token.receive' })).not.toBeInTheDocument()
  })

  it('keeps the untrusted add-and-receive action busy after success until handoff', async () => {
    let resolveReceive: () => void = () => {}
    const onAddAndReceive = vi.fn(
      () => new Promise<void>((resolve) => { resolveReceive = resolve }),
    )

    render(
      <ConfirmUntrustedStep
        token={token}
        onBack={vi.fn()}
        onAddAndReceive={onAddAndReceive}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /receive\.untrusted\.addAndReceive/ }))
    expect(screen.getByText('tokenRegister.receiving')).toBeInTheDocument()

    await act(async () => { resolveReceive() })

    expect(screen.getByText('tokenRegister.receiving')).toBeInTheDocument()
    expect(screen.queryByText('receive.untrusted.addAndReceive')).not.toBeInTheDocument()
  })

  it('restores the trusted receive button when receiving fails', async () => {
    render(
      <ConfirmTrustedStep
        token={token}
        onBack={vi.fn()}
        onReceive={vi.fn(async () => { throw new Error('receive failed') })}
        onReject={vi.fn()}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'receive.token.receive' }))
    })

    expect(screen.getByRole('button', { name: 'receive.token.receive' })).toBeEnabled()
  })
})
