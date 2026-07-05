import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayManagementScreen } from '@/ui/screens/Settings/RelayManagementScreen'

const addToast = vi.fn()

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

vi.mock('motion/react', () => ({
  Reorder: {
    Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  useDragControls: () => ({ start: vi.fn() }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: {
    settings: { relays: string[] }
    addToast: typeof addToast
  }) => unknown) => selector({
    settings: {
      relays: ['wss://relay-a.test', 'wss://relay-b.test'],
    },
    addToast,
  }),
}))

vi.mock('@/ui/components/common', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (
    isOpen ? <div>{children}</div> : null
  ),
}))

// 생존 표시가 raw WS 프로브 대신 게이트웨이 상태를 읽는다 (설계 §10 B6).
// registry는 실제 컨텍스트처럼 **안정 참조**여야 한다 — 렌더마다 새 객체면
// effect 재실행 루프가 된다.
const stableRegistry = {
  nostrGateway: {
    getRelayStatus: () => [
      { url: 'wss://relay-a.test', connected: true },
      { url: 'wss://relay-b.test', connected: false },
    ],
  },
}
vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => stableRegistry,
}))

describe('RelayManagementScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('reorders relays when the drag handle receives an arrow key', async () => {
    const onSaveSettings = vi.fn().mockResolvedValue(undefined)

    render(
      <RelayManagementScreen
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    fireEvent.keyDown(screen.getByLabelText('settings.dragToReorder relay-a.test'), { key: 'ArrowDown' })

    expect(onSaveSettings).toHaveBeenCalledWith({
      relays: ['wss://relay-b.test', 'wss://relay-a.test'],
    })
  })

  it('renders drag handles for relay reordering', () => {
    render(
      <RelayManagementScreen
        onBack={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('relay-drag-handle')).toHaveLength(2)
  })

  it('ignores arrow keys at list boundaries', () => {
    const onSaveSettings = vi.fn().mockResolvedValue(undefined)

    render(
      <RelayManagementScreen
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    const firstHandle = screen.getByLabelText('settings.dragToReorder relay-a.test')
    const lastHandle = screen.getByLabelText('settings.dragToReorder relay-b.test')

    fireEvent.keyDown(firstHandle, { key: 'ArrowUp' })
    fireEvent.keyDown(lastHandle, { key: 'ArrowDown' })

    expect(onSaveSettings).not.toHaveBeenCalled()
  })

  it('rolls back local order when saving a relay move fails', async () => {
    const onSaveSettings = vi.fn().mockRejectedValue(new Error('save failed'))

    render(
      <RelayManagementScreen
        onBack={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    )

    fireEvent.keyDown(screen.getByLabelText('settings.dragToReorder relay-a.test'), { key: 'ArrowDown' })

    await screen.findByLabelText('settings.dragToReorder relay-a.test')
    expect(addToast).toHaveBeenCalledWith({ type: 'error', message: 'errors.unknownError' })
  })
})
