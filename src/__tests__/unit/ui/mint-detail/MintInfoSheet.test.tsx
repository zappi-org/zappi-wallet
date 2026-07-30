import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MintInfoSheet } from '@/ui/screens/MintDetail/MintInfoSheet'

const addToast = vi.fn()
const fetchMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settings: { mints: string[] }; addToast: typeof addToast }) => unknown) => selector({
    settings: {
      mints: ['https://mint-a.test', 'https://mint-b.test'],
    },
    addToast,
  }),
}))

vi.mock('@/ui/components/common/BottomSheet', () => ({
  BottomSheet: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (
    isOpen ? <div>{children}</div> : null
  ),
}))

vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => ({
    mintInfo: { getInfo: vi.fn().mockResolvedValue(null) },
  }),
}))

vi.mock('@/ui/screens/MintDetail/MintUrlQrModal', () => ({
  MintUrlQrModal: () => null,
}))

vi.mock('@/ui/screens/MintDetail/SupportedNutsModal', () => ({
  SupportedNutsModal: () => null,
}))

vi.mock('@/ui/screens/MintDetail/DeleteMintSheet', () => ({
  DeleteMintSheet: () => null,
}))

describe('MintInfoSheet', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('blocks duplicate mint renames and shows an inline error', () => {
    const onRename = vi.fn()

    render(
      <MintInfoSheet
        isOpen
        section="settings"
        mint={{
          url: 'https://mint-a.test',
          name: 'Alpha',
          alias: 'Alpha',
          balance: 0,
          isOnline: true,
        }}
        onClose={vi.fn()}
        onRename={onRename}
        getDisplayName={(url) => url === 'https://mint-a.test' ? 'Alpha' : 'Beta'}
      />,
    )

    // Role query skips the aria-hidden live card preview, which also renders the name.
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))

    const input = screen.getByDisplayValue('Alpha')
    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('mintDetail.duplicateName')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument()
  })
})
