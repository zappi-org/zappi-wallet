import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteMintSheet } from '@/ui/screens/MintDetail/DeleteMintSheet'

const mintSwap = vi.fn()
const settingsState = {
  mints: ['https://mint-a.test'],
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sats`,
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settings: typeof settingsState }) => unknown) => selector({
    settings: settingsState,
  }),
}))

vi.mock('@/ui/hooks', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url === 'https://mint-a.test' ? 'Mint A' : 'Mint B',
  }),
  usePayment: () => ({
    mintSwap,
  }),
}))

describe('DeleteMintSheet', () => {
  beforeEach(() => {
    settingsState.mints = ['https://mint-a.test']
    mintSwap.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('allows force delete when there is no other mint to drain into', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)

    render(
      <DeleteMintSheet
        isOpen
        mint={{ url: 'https://mint-a.test', balance: 21, isOnline: true }}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    )

    expect(screen.queryByText('mintDetail.emptyAndDeleteBtn')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('mintDetail.forceDeleteBtn'))
    fireEvent.click(screen.getByText('mintDetail.forceDeleteBtn'))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('https://mint-a.test')
    })
    expect(mintSwap).not.toHaveBeenCalled()
  })

  it('keeps a force delete escape hatch when drain swap fails', async () => {
    settingsState.mints = ['https://mint-a.test', 'https://mint-b.test']
    mintSwap.mockResolvedValue(null)
    const onDelete = vi.fn().mockResolvedValue(undefined)

    render(
      <DeleteMintSheet
        isOpen
        mint={{ url: 'https://mint-a.test', balance: 21, isOnline: true }}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    )

    fireEvent.click(screen.getByText('mintDetail.emptyAndDeleteBtn'))

    await waitFor(() => {
      expect(screen.getByText('mintDetail.swapFailed')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('mintDetail.forceDeleteBtn'))
    fireEvent.click(screen.getByText('mintDetail.forceDeleteBtn'))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('https://mint-a.test')
    })
  })

  it('never offers a notation variant of the mint being deleted as its own swap destination', () => {
    // Same mint, four legal notations — none of them is an "other" mint.
    settingsState.mints = [
      'https://mint-a.test',
      'https://mint-a.test/',
      'https://MINT-A.test',
      'https://mint-a.test:443',
    ]

    render(
      <DeleteMintSheet
        isOpen
        mint={{ url: 'https://mint-a.test', balance: 21, isOnline: true }}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.queryByText('mintDetail.emptyAndDeleteBtn')).not.toBeInTheDocument()
    expect(screen.getByText('mintDetail.sendElsewhere')).toBeInTheDocument()
  })

  it('drains into the genuinely different mint when the list also holds a variant of the deleted one', async () => {
    settingsState.mints = ['https://mint-a.test/', 'https://mint-b.test']
    mintSwap.mockResolvedValue({ ok: true })
    const onDelete = vi.fn().mockResolvedValue(undefined)

    render(
      <DeleteMintSheet
        isOpen
        mint={{ url: 'https://mint-a.test', balance: 21, isOnline: true }}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    )

    fireEvent.click(screen.getByText('mintDetail.emptyAndDeleteBtn'))

    await waitFor(() => {
      expect(mintSwap).toHaveBeenCalledWith(
        'https://mint-a.test',
        'https://mint-b.test',
        21,
        { drain: true },
      )
    })
  })
})
