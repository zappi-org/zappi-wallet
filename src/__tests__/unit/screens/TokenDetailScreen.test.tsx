import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TokenDetailScreen } from '@/ui/screens/Token/TokenDetailScreen'
import type { TokenDetailData } from '@/ui/screens/Token/types'
import { formatFiatAmount } from '@/utils/format'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

function makeDetail(): TokenDetailData {
  return {
    id: 'token-1',
    status: 'registered',
    amount: 1_000,
    memo: 'coffee',
    createdAt: Date.now(),
    statusAt: Date.now(),
    mintAlias: 'Mint',
    mintUrl: 'https://mint.test',
    fiat: { amount: 1.23, currency: 'USD' },
    unit: 'sat',
    tokenString: 'cashuAtoken',
  }
}

describe('TokenDetailScreen fiat display', () => {
  beforeEach(() => {
    const state = useAppStore.getState()
    useAppStore.setState({
      settings: {
        ...state.settings,
        fiatCurrency: 'USD',
        showFiatConversion: true,
      },
    })
  })

  it('shows fiat when the display setting is enabled', () => {
    render(<TokenDetailScreen data={makeDetail()} onClose={vi.fn()} />)

    expect(screen.getByText(`(${formatFiatAmount(1.23, 'USD')})`)).toBeInTheDocument()
  })

  it('keeps token fiat data render-only and hides it when the display setting is disabled', () => {
    const state = useAppStore.getState()
    useAppStore.setState({
      settings: {
        ...state.settings,
        showFiatConversion: false,
      },
    })

    render(<TokenDetailScreen data={makeDetail()} onClose={vi.fn()} />)

    expect(screen.queryByText(`(${formatFiatAmount(1.23, 'USD')})`)).not.toBeInTheDocument()
  })
})
