import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TokenConfirmStep } from '@/ui/screens/Receive/steps/TokenConfirmStep'
import type { ValidatedCashuToken } from '@/core/domain/input-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { mint?: string; amount?: string }) => {
      if (params?.mint) return `${key}:${params.mint}`
      if (params?.amount) return `${key}:${params.amount}`
      return key
    },
  }),
  Trans: ({ i18nKey, values }: { i18nKey: string; values?: { mint?: string; amount?: string } }) => (
    <span>{i18nKey}:{values?.mint}:{values?.amount}</span>
  ),
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: (mintUrl: string) => mintUrl.includes('target') ? 'Target Mint' : 'Source Mint',
  }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sats`,
  useFormatFiat: () => () => null,
}))

vi.mock('@/ui/utils/haptic', () => ({
  hapticTap: vi.fn(),
}))

const token: ValidatedCashuToken = {
  type: 'cashu-token',
  token: 'cashuA...',
  amountSats: 10,
  mintUrl: 'https://source.mint',
}

function renderStep(overrides: Partial<Parameters<typeof TokenConfirmStep>[0]> = {}) {
  return render(
    <TokenConfirmStep
      onBack={vi.fn()}
      onReject={vi.fn()}
      onReceive={vi.fn().mockResolvedValue(undefined)}
      token={token}
      isOnline
      inspection={null}
      {...overrides}
    />,
  )
}

describe('TokenConfirmStep', () => {
  it('receives registered tokens at their original mint only', async () => {
    const onReject = vi.fn()
    const onReceive = vi.fn().mockResolvedValue(undefined)

    renderStep({ onReject, onReceive })

    expect(screen.queryByText('receive.token.receiveViaSwap:Target Mint')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('receive.token.receiveDirectly:Source Mint'))

    await waitFor(() => {
      expect(onReceive).toHaveBeenCalledTimes(1)
    })
    expect(onReceive).toHaveBeenCalledWith()
    expect(onReject).not.toHaveBeenCalled()
  })

  it('offers a reject action for registered tokens before redeeming', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined)
    const onReceive = vi.fn().mockResolvedValue(undefined)

    renderStep({ onReject, onReceive })

    fireEvent.click(screen.getByText('receive.token.reject'))

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledTimes(1)
    })
    expect(onReceive).not.toHaveBeenCalled()
  })
})
