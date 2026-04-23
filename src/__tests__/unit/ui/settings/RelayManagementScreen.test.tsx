import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayManagementScreen } from '@/ui/screens/Settings/RelayManagementScreen'

class MockWebSocket {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(_url: string) {}

  close() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { min?: number; max?: number }) => {
      if (typeof params?.min === 'number') {
        return `${key}:${params.min}`
      }
      if (typeof params?.max === 'number') {
        return `${key}:${params.max}`
      }
      return key
    },
  }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settings: { relays: string[] } }) => unknown) => selector({
    settings: {
      relays: ['wss://relay-a.test', 'wss://relay-b.test'],
    },
  }),
}))

vi.mock('@/ui/components/common', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (
    isOpen ? <div>{children}</div> : null
  ),
}))

describe('RelayManagementScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reorders relays when the move button is pressed', async () => {
    const onSaveSettings = vi.fn().mockResolvedValue(undefined)

    render(
      <RelayManagementScreen
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    fireEvent.click(screen.getByLabelText('settings.moveDown relay-a.test'))

    expect(onSaveSettings).toHaveBeenCalledWith({
      relays: ['wss://relay-b.test', 'wss://relay-a.test'],
    })
  })
})
