import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MintManagementScreen } from '@/ui/screens/Settings/MintManagementScreen'

const addToast = vi.fn()
const checkAllMints = vi.fn()
const fetchMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { min?: number }) => {
      if (params?.min) {
        return `${key}:${params.min}`
      }
      return key
    },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))

vi.mock('motion/react', () => ({
  Reorder: {
    Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  useDragControls: () => ({ start: vi.fn() }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: {
    settings: { mints: string[] }
    balance: { byMint: Record<string, number> }
    addToast: typeof addToast
  }) => unknown) => selector({
    settings: {
      mints: ['https://mint-a.test', 'https://mint-b.test', 'https://mint-c.test'],
    },
    balance: {
      byMint: {
        'https://mint-a.test': 10,
        'https://mint-b.test': 20,
        'https://mint-c.test': 30,
      },
    },
    addToast,
  }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount}`,
  useFormatFiat: () => () => null,
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => {
      if (url === 'https://mint-a.test') return 'Mint A'
      if (url === 'https://mint-b.test') return 'Mint B'
      return 'Mint C'
    },
    getIconUrl: () => undefined,
  }),
}))

vi.mock('@/ui/hooks/use-mint-health', () => ({
  useMintHealth: () => ({
    getCachedStatus: () => ({ isOnline: true }),
    checkAllMints,
  }),
}))

vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => ({
    mintInfo: { getInfo: vi.fn().mockResolvedValue(null) },
  }),
}))

vi.mock('@/ui/screens/Settings/SettingsHelpers', () => ({
  MintIcon: () => <div data-testid="mint-icon" />,
}))

vi.mock('@/ui/screens/MintDetail/MintUrlQrModal', () => ({
  MintUrlQrModal: () => null,
}))

vi.mock('@/ui/components/common', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (
    isOpen ? <div>{children}</div> : null
  ),
}))

describe('MintManagementScreen', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('reorders mints when the drag handle receives an arrow key', async () => {
    const onSaveSettings = vi.fn().mockResolvedValue(undefined)

    render(
      <MintManagementScreen
        onBack={vi.fn()}
        onAddMint={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    fireEvent.keyDown(screen.getByLabelText('settings.dragToReorder Mint A'), { key: 'ArrowDown' })

    expect(onSaveSettings).toHaveBeenCalledWith({
      mints: ['https://mint-b.test', 'https://mint-a.test', 'https://mint-c.test'],
    })
  })

  it('renders drag handles for mint reordering', () => {
    render(
      <MintManagementScreen
        onBack={vi.fn()}
        onAddMint={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('mint-drag-handle')).toHaveLength(3)
  })

  it('ignores arrow keys at list boundaries', () => {
    const onSaveSettings = vi.fn().mockResolvedValue(undefined)

    render(
      <MintManagementScreen
        onBack={vi.fn()}
        onAddMint={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    const firstHandle = screen.getByLabelText('settings.dragToReorder Mint A')
    const lastHandle = screen.getByLabelText('settings.dragToReorder Mint C')

    fireEvent.keyDown(firstHandle, { key: 'ArrowUp' })
    fireEvent.keyDown(lastHandle, { key: 'ArrowDown' })

    expect(onSaveSettings).not.toHaveBeenCalled()
  })

  it('rolls back local order when saving a mint move fails', async () => {
    const onSaveSettings = vi.fn().mockRejectedValue(new Error('save failed'))

    render(
      <MintManagementScreen
        onBack={vi.fn()}
        onAddMint={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    fireEvent.keyDown(screen.getByLabelText('settings.dragToReorder Mint A'), { key: 'ArrowDown' })

    await screen.findByLabelText('settings.dragToReorder Mint A')
    expect(addToast).toHaveBeenCalledWith({ type: 'error', message: 'errors.unknownError' })
  })
})
