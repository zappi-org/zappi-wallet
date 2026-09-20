import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useChatMessageMotion } from '@/ui/hooks/use-chat-message-motion'
import type { ChatMessage } from '@/core/domain/chat'

const previousObserver = globalThis.ResizeObserver
const observers: Array<{
  targets: Set<Element>
  notify: ResizeObserverCallback
}> = []
globalThis.ResizeObserver = class {
  private entry: (typeof observers)[number]
  constructor(notify: ResizeObserverCallback) {
    this.entry = { targets: new Set(), notify }
    observers.push(this.entry)
  }
  observe(target: Element) {
    this.entry.targets.add(target)
  }
  unobserve(target: Element) {
    this.entry.targets.delete(target)
  }
  disconnect() {
    this.entry.targets.clear()
  }
}
afterAll(() => {
  globalThis.ResizeObserver = previousObserver
})
const message = (id: string, outgoing = false): ChatMessage => ({
  id,
  conversationId: 'chat',
  sender: 'sender',
  recipient: 'recipient',
  content: id,
  outgoing,
  status: 'received',
  createdAt: 1000,
})
let height: number
let position: number
beforeEach(() => {
  observers.length = 0
  height = 200
  position = 100
})
function setup(atBottom = true, reduced = false) {
  const list = document.createElement('div')
  Object.defineProperties(list, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 100 },
    scrollTop: {
      get: () => position,
      set: (value) => {
        position = Math.min(value, height - 100)
      },
    },
  })
  list.scrollTo = ((options: ScrollToOptions) => {
    list.scrollTop = options.top ?? list.scrollTop
  }) as typeof list.scrollTo
  const input = document.createElement('textarea')
  input.getBoundingClientRect = () => ({ left: 50, bottom: 414 } as DOMRect)
  const scrollRef = { current: list }
  const inputRef = { current: input }
  const bottomRef = { current: atBottom }
  const away = vi.fn()
  const existing = message('old')
  const { result, rerender } = renderHook(
    ({ messages }) =>
      useChatMessageMotion({
        messages,
        scroll: scrollRef,
        input: inputRef,
        atBottom: bottomRef,
        active: true,
        reduced,
        setAway: away,
      }),
    { initialProps: { messages: [existing] } }
  )
  const oldRow = document.createElement('div')
  const newRow = document.createElement('div')
  const bubble = document.createElement('div')
  bubble.getBoundingClientRect = () => ({ left: 250, bottom: 344 } as DOMRect)
  const oldAnimation = vi.fn(
    () => ({ cancel: vi.fn() } as unknown as Animation)
  )
  const bubbleAnimation = vi.fn(
    () => ({ cancel: vi.fn() } as unknown as Animation)
  )
  oldRow.animate = oldAnimation
  result.current.content.current = oldRow
  bubble.animate = bubbleAnimation
  result.current.rows.current.set('old', oldRow)
  result.current.rows.current.set('new', newRow)
  result.current.bubbles.current.set('new', bubble)
  return {
    result,
    rerender,
    existing,
    oldAnimation,
    bubbleAnimation,
    away,
    oldRow,
  }
}

describe('composer-to-message motion', () => {
  it('moves a sent bubble from the actual composer while shifting existing messages together', () => {
    const state = setup()
    expect(state.bubbleAnimation).not.toHaveBeenCalled()
    state.result.current.captureComposer('new')
    height = 260
    state.rerender({ messages: [state.existing, message('new', true)] })
    expect(position).toBe(160)
    expect(state.oldAnimation).toHaveBeenCalledWith(
      [{ transform: 'translateY(60px)' }, { transform: 'translateY(0px)' }],
      expect.anything()
    )
    expect(state.bubbleAnimation).toHaveBeenCalledWith(
      [{ translate: '-200px 0px' }, { translate: '0px 0px' }],
      expect.anything()
    )
    expect(state.bubbleAnimation).toHaveBeenCalledWith(
      [{ transform: 'translateY(10px)' }, { transform: 'translateY(0px)' }],
      expect.anything()
    )
    state.bubbleAnimation.mockClear()
    state.rerender({
      messages: [state.existing, { ...message('new', true), status: 'sent' }],
    })
    expect(state.bubbleAnimation).not.toHaveBeenCalled()
  })
  it('does not pull the reader to the bottom when a message arrives', () => {
    const state = setup(false)
    position = 20
    height = 260
    state.rerender({ messages: [state.existing, message('new')] })
    expect(position).toBe(20)
    expect(state.away).toHaveBeenCalledWith(true)
    expect(state.oldAnimation).not.toHaveBeenCalled()
  })
  it('inserts instantly with reduced motion', () => {
    const state = setup(true, true)
    height = 260
    state.rerender({ messages: [state.existing, message('new')] })
    expect(position).toBe(160)
    expect(state.bubbleAnimation).not.toHaveBeenCalled()
    expect(state.oldAnimation).not.toHaveBeenCalled()
  })
})

it('does not snap a near-bottom reader back on a status update', () => {
  const state = setup()
  position = 95
  state.rerender({ messages: [{ ...state.existing, status: 'sent' }] })
  expect(position).toBe(95)
  expect(state.oldAnimation).not.toHaveBeenCalled()
})

it('uses the pre-cancellation position when interrupting transformed content', () => {
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m42 = 30
    }
  )
  try {
    const state = setup()
    state.oldAnimation.mockImplementation(
      () =>
        ({
          cancel: () => {
            height = 260
            position = 160
          },
        } as unknown as Animation)
    )
    height = 260
    state.rerender({ messages: [state.existing, message('new')] })
    state.oldRow.style.transform = 'matrix(1, 0, 0, 1, 0, 30)'
    height = 290
    position = 190
    state.result.current.interrupt()
    expect(position).toBe(160)
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('entry and late transcript layout', () => {
  function Transcript({
    ready = true,
    active = true,
  }: {
    ready?: boolean
    active?: boolean
  }) {
    const scroll = useRef<HTMLDivElement>(null)
    const input = useRef<HTMLTextAreaElement>(null)
    const atBottom = useRef(true)
    const { content } = useChatMessageMotion({
      messages: [message('existing')],
      scroll,
      input,
      atBottom,
      active: active && ready,
      reduced: true,
      setAway: () => {},
    })
    if (!ready) return null
    return (
      <div
        data-testid="transcript"
        ref={(node) => {
          scroll.current = node
          if (!node) return
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, get: () => height },
            clientHeight: { configurable: true, value: 100 },
            scrollTop: {
              configurable: true,
              get: () => position,
              set: (value) => {
                position = Math.min(value, height - 100)
              },
            },
          })
          node.scrollTo = ((options: ScrollToOptions) => {
            node.scrollTop = options.top ?? node.scrollTop
          }) as typeof node.scrollTo
        }}
        onWheel={() => {
          atBottom.current = false
        }}
      >
        <div ref={content} data-testid="content" />
      </div>
    )
  }
  function resized(element: Element) {
    act(() => {
      for (const observer of observers) {
        if (observer.targets.has(element))
          observer.notify([], {} as ResizeObserver)
      }
    })
  }
  it('aligns a conversation whose data arrives after its screen becomes active', () => {
    position = 0
    const view = render(<Transcript ready={false} />)
    view.rerender(<Transcript ready />)
    expect(position).toBe(100)
    expect(
      observers.some((observer) =>
        observer.targets.has(view.getByTestId('content'))
      )
    ).toBe(true)
  })
  it('follows late card layout and viewport changes exactly to the bottom', () => {
    const view = render(<Transcript />)
    expect(position).toBe(100)
    height = 247
    resized(view.getByTestId('content'))
    expect(position).toBe(147)
    height = 281
    resized(view.getByTestId('transcript'))
    expect(position).toBe(181)
    view.unmount()
  })
  it('does not move a reader after content resize or while the room is covered', () => {
    const view = render(<Transcript />)
    act(() => {
      view
        .getByTestId('transcript')
        .dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, deltaY: -40 })
        )
    })
    position = 40
    height = 270
    resized(view.getByTestId('content'))
    expect(position).toBe(40)
    view.rerender(<Transcript active={false} />)
    height = 310
    resized(view.getByTestId('content'))
    expect(position).toBe(40)
    view.unmount()
  })
})
