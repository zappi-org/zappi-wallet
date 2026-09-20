import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react'
import { ContactFormModal } from '@/ui/screens/Contacts/ContactFormModal'
import { ServiceProvider } from '@/ui/hooks/service-context'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { useChatViewport } from '@/ui/hooks/use-chat-viewport'
import { npubEncode } from '@/adapters/nostr/internal/nostr-crypto'

vi.mock('@/ui/components/common', () => ({
  Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/ui/components/common/QrScannerModal', () => ({
  QrScannerModal: () => null,
}))

describe('chat contact editing', () => {
  it('saves a valid Nostr contact without requiring payment advertisements', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('No payment profile'))
    const save = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn()
    const address = npubEncode('b'.repeat(64))
    render(
      <ServiceProvider
        registry={
          { addressResolver: { resolve } } as unknown as ServiceRegistry
        }
      >
        <ContactFormModal
          isOpen
          onClose={close}
          onSave={save}
          initialAddress={address}
        />
      </ServiceProvider>
    )
    fireEvent.change(
      screen.getByPlaceholderText('contacts.namePlaceholder'),
      {
        target: { value: 'Chat only contact' },
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        name: 'Chat only contact',
        address,
      })
    )
    expect(resolve).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
  it('keeps the form open and reports an actual save failure', async () => {
    const close = vi.fn()
    render(
      <ServiceProvider
        registry={
          {
            addressResolver: { resolve: vi.fn() },
          } as unknown as ServiceRegistry
        }
      >
        <ContactFormModal
          isOpen
          onClose={close}
          onSave={async () => {
            throw new Error('Storage full')
          }}
          initialAddress={npubEncode('b'.repeat(64))}
        />
      </ServiceProvider>
    )
    fireEvent.change(
      screen.getByPlaceholderText('contacts.namePlaceholder'),
      {
        target: { value: 'Bob' },
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    expect(await screen.findByText('chat.saveFailed')).toBeInTheDocument()
    expect(close).not.toHaveBeenCalled()
  })
})

function ViewportProbe() {
  const ref = useChatViewport(true)
  return (
    <div>
      <div ref={ref} data-testid="viewport" />
    </div>
  )
}
describe('chat visual viewport', () => {
  it('tracks keyboard height and offset without scrolling the document, then cleans up', () => {
    vi.useFakeTimers()
    const previous = window.visualViewport
    const viewport = Object.assign(new EventTarget(), {
      height: 500,
      offsetTop: 70,
      scale: 1,
    })
    const remove = vi.spyOn(viewport, 'removeEventListener')
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    })
    try {
      const { unmount } = render(<ViewportProbe />)
      expect(screen.getByTestId('viewport')).toHaveStyle({
        height: '500px',
        top: '70px',
      })
      act(() => {
        viewport.height = 320
        viewport.offsetTop = 0
        viewport.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(20)
      })
      expect(screen.getByTestId('viewport')).toHaveStyle({
        height: '320px',
        top: '0px',
      })
      act(() => {
        viewport.scale = 2
        viewport.height = 160
        viewport.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(20)
      })
      expect(screen.getByTestId('viewport')).toHaveStyle({ height: '320px' })
      unmount()
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
      expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
    } finally {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: previous,
      })
      vi.useRealTimers()
    }
  })
})

describe('installed iOS chat viewport', () => {
  it('locks the document, preserves full-bleed height and restores it after keyboard dismissal', () => {
    vi.useFakeTimers()
    const previous = window.visualViewport
    const agent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('iPhone')
    const viewport = Object.assign(new EventTarget(), {
      height: 810,
      offsetTop: 0,
      scale: 1,
    })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    })
    document.documentElement.classList.add('standalone')
    document.body.style.position = 'relative'
    try {
      const { unmount } = render(<ViewportProbe />)
      const node = screen.getByTestId('viewport')
      Object.defineProperty(node.parentElement, 'clientHeight', {
        configurable: true,
        value: 844,
      })
      const resize = (height: number, offsetTop = 0) =>
        act(() => {
          viewport.height = height
          viewport.offsetTop = offsetTop
          viewport.dispatchEvent(new Event('resize'))
          vi.advanceTimersByTime(20)
        })
      resize(810)
      expect(node).toHaveStyle({ height: '844px', top: '0px' })
      expect(document.body.style.position).toBe('fixed')
      resize(490, 35)
      expect(node).toHaveStyle({ height: '490px', top: '35px' })
      expect(node.style.getPropertyValue('--chat-bottom-inset')).toBe('0px')
      expect(node.dataset.keyboardOpen).toBe('true')
      resize(810)
      expect(node).toHaveStyle({ height: '844px', top: '0px' })
      expect(node.dataset.keyboardOpen).toBe('false')
      unmount()
      expect(document.body.style.position).toBe('relative')
      expect(node.style.height).toBe('')
    } finally {
      agent.mockRestore()
      document.body.style.position = ''
      document.documentElement.classList.remove('standalone')
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: previous,
      })
      vi.useRealTimers()
    }
  })

  it('allows transcript scrolling but prevents edge gestures from panning the page', () => {
    const agent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('iPhone')
    const previous = window.visualViewport
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        height: 490,
        offsetTop: 0,
        scale: 1,
      }),
    })
    try {
      const { unmount } = render(<ViewportProbe />)
      const node = screen.getByTestId('viewport')
      const transcript = document.createElement('div')
      transcript.style.overflowY = 'auto'
      Object.defineProperty(transcript, 'scrollHeight', { value: 1000 })
      Object.defineProperty(transcript, 'clientHeight', { value: 200 })
      node.appendChild(transcript)
      const gesture = (scrollTop: number, touches = 1) => {
        transcript.scrollTop = scrollTop
        fireEvent.touchStart(transcript, {
          touches: [{ clientX: 20, clientY: 200 }],
        })
        const event = new Event('touchmove', {
          bubbles: true,
          cancelable: true,
        })
        Object.defineProperty(event, 'touches', {
          value: Array.from({ length: touches }, () => ({
            clientX: 20,
            clientY: 100,
          })),
        })
        transcript.dispatchEvent(event)
        return event.defaultPrevented
      }
      expect(gesture(300)).toBe(false)
      expect(gesture(800)).toBe(true)
      expect(gesture(800, 2)).toBe(false)
      unmount()
    } finally {
      agent.mockRestore()
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: previous,
      })
    }
  })
})
