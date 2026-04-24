import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UntrustedMintStep } from '@/ui/screens/Receive/steps/UntrustedMintStep'
import type { ValidatedCashuToken } from '@/core/domain/input-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settings: { mints: string[] } }) => unknown) => selector({
    settings: { mints: ['https://target.mint'] },
  }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sats`,
  useFormatFiat: () => () => null,
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url,
    getIconUrl: () => undefined,
  }),
}))

vi.mock('@/ui/utils/haptic', () => ({
  hapticTap: vi.fn(),
}))

const token: ValidatedCashuToken = {
  type: 'cashu-token',
  token: 'cashuA...',
  amountSats: 1,
  mintUrl: 'https://source.mint',
}

function renderStep(overrides: Partial<Parameters<typeof UntrustedMintStep>[0]> = {}) {
  return render(
    <UntrustedMintStep
      onBack={vi.fn()}
      onReject={vi.fn()}
      onAddAndReceive={vi.fn().mockResolvedValue(undefined)}
      token={token}
      isOnline
      {...overrides}
    />,
  )
}

describe('UntrustedMintStep', () => {
  it('offers only add-and-receive or reject for unknown mint tokens', () => {
    renderStep()

    expect(screen.getByText('receive.untrusted.addAndReceive')).toBeInTheDocument()
    expect(screen.getByText('receive.untrusted.reject')).toBeInTheDocument()
    expect(screen.queryByText('receive.untrusted.myMint')).not.toBeInTheDocument()
    expect(screen.queryByText('receive.untrusted.receiveWithMint')).not.toBeInTheDocument()
  })

  it('keeps reject available while offline because it does not touch the token', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined)
    renderStep({ isOnline: false, onReject })

    const addButton = screen.getByText('receive.untrusted.addAndReceive').closest('button')
    const rejectButton = screen.getByText('receive.untrusted.reject').closest('button')

    expect(addButton).toBeDisabled()
    expect(rejectButton).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(rejectButton!)
    })
    expect(onReject).toHaveBeenCalled()
  })
})
