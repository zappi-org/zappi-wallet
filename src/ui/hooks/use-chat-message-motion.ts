import {
  useLayoutEffect,
  useRef,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { ChatMessage } from '@/core/domain/chat'

const VERTICAL =
  'cubic-bezier(0.1991947291, 0.01064453125, 0.2792093704, 0.91025390625)'
const HORIZONTAL = 'cubic-bezier(0.23, 1, 0.32, 1)'
const DURATION = 300

function contentOffset(element: HTMLElement | null): number {
  const transform = element && getComputedStyle(element).transform
  return transform &&
    transform !== 'none' &&
    typeof DOMMatrixReadOnly !== 'undefined'
    ? new DOMMatrixReadOnly(transform).m42
    : 0
}

export function useChatMessageMotion({
  messages,
  scroll,
  input,
  atBottom,
  active,
  reduced,
  setAway,
}: {
  messages: ChatMessage[]
  scroll: RefObject<HTMLDivElement | null>
  input: RefObject<HTMLTextAreaElement | null>
  atBottom: RefObject<boolean>
  active: boolean
  reduced: boolean
  setAway: Dispatch<SetStateAction<boolean>>
}) {
  const content = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const bubbles = useRef(new Map<string, HTMLDivElement>())
  const known = useRef(new Set(messages.map((message) => message.id)))
  const animations = useRef(new Set<Animation>())
  const origin = useRef<{ content: string; rect: DOMRect } | null>(null)
  const wasActive = useRef(false)

  useLayoutEffect(() => {
    const list = scroll.current
    const added = messages.filter((message) => !known.current.has(message.id))
    messages.forEach((message) => known.current.add(message.id))
    const entering = active && !wasActive.current
    if (!list || !active) {
      wasActive.current = false
      return
    }
    wasActive.current = true
    // Status/read/draft updates must never pull a reader back to the bottom.
    if (!added.length && !entering) return
    const previousTop = list.scrollTop
    if (atBottom.current)
      list.scrollTo({ top: list.scrollHeight, behavior: 'instant' })
    else if (added.length) setAway(true)
    const movement = list.scrollTop - previousTop
    if (reduced || !added.length) {
      if (added.some((m) => m.outgoing)) origin.current = null
      return
    }

    const animate = (
      element: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions
    ) => {
      if (typeof element.animate !== 'function') return
      const animation = element.animate(frames, options)
      animations.current.add(animation)
      animation.onfinish = () => animations.current.delete(animation)
    }
    // Read geometry once, then move the transcript as one compositor layer.
    const previousOffset = contentOffset(content.current)
    const incoming = added
      .map((message) => ({
        message,
        bubble: bubbles.current.get(message.id),
        row: rows.current.get(message.id),
      }))
      .filter((item) => item.bubble && item.row)
      .map((item) => ({
        ...item,
        rect: item.bubble!.getBoundingClientRect(),
      }))
    animations.current.forEach((animation) => animation.cancel())
    animations.current.clear()
    const shift =
      movement > 0
        ? Math.min(movement, list.clientHeight) + previousOffset
        : 0
    if (content.current && shift > 0)
      animate(
        content.current,
        [
          { transform: `translateY(${shift}px)` },
          { transform: 'translateY(0px)' },
        ],
        { duration: DURATION, easing: VERTICAL }
      )
    for (const { message, bubble, row, rect } of incoming) {
      let x = 0
      let y = shift > 0 ? 0 : 12
      if (message.outgoing && origin.current?.content === message.content) {
        x = origin.current.rect.left - rect.left
        y =
          origin.current.rect.bottom - (rect.bottom - previousOffset) - shift
        origin.current = null
      }
      animate(
        bubble!,
        [{ translate: `${x}px 0px` }, { translate: '0px 0px' }],
        { duration: DURATION, easing: HORIZONTAL }
      )
      animate(
        bubble!,
        [
          { transform: `translateY(${y}px)` },
          { transform: 'translateY(0px)' },
        ],
        { duration: DURATION, easing: VERTICAL }
      )
      animate(bubble!, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 120,
        easing: 'ease-out',
      })
      row!
        .querySelectorAll<HTMLElement>(
          '[data-chat-metadata], [data-chat-avatar]'
        )
        .forEach((element) => {
          animate(element, [{ opacity: 0 }, { opacity: 1 }], {
            duration: 150,
            delay: 80,
            fill: 'backwards',
          })
        })
    }
  }, [messages, active, reduced, scroll, atBottom, setAway])

  useLayoutEffect(() => {
    const node = scroll.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      if (active && atBottom.current)
        node.scrollTo({ top: node.scrollHeight, behavior: 'instant' })
    })
    observer.observe(node)
    // Cards can resize after receipt details load without resizing the viewport.
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [active, scroll, atBottom])

  useLayoutEffect(() => {
    const running = animations.current
    if (!active || reduced) {
      running.forEach((animation) => animation.cancel())
      running.clear()
    }
    return () => {
      running.forEach((animation) => animation.cancel())
      running.clear()
    }
  }, [active, reduced])

  return {
    rows,
    bubbles,
    content,
    interrupt: () => {
      const y = contentOffset(content.current)
      const previousTop = scroll.current?.scrollTop ?? 0
      animations.current.forEach((animation) => animation.cancel())
      animations.current.clear()
      if (scroll.current && y)
        scroll.current.scrollTo({
          top: previousTop - y,
          behavior: 'instant',
        })
    },
    captureComposer: (text: string) => {
      if (input.current)
        origin.current = {
          content: text.trim(),
          rect: input.current.getBoundingClientRect(),
        }
    },
  }
}
