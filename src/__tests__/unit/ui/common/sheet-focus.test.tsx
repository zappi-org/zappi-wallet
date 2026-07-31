import { Children, useEffect, useRef, type ReactNode, type Ref } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { HistoryDrawer } from '@/ui/components/common/HistoryDrawer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/ui/screens/History/HistoryScreen', () => ({
  default: () => <button>history-action</button>,
}))

/**
 * Motion props are dropped rather than forwarded so React does not warn about
 * unknown DOM attributes; onAnimationComplete fires on mount and again on
 * unmount, which is how motion reports enter and exit.
 */
vi.mock('motion/react', () => {
  const MOTION_ONLY = new Set([
    'initial', 'animate', 'exit', 'transition', 'layout',
    'drag', 'dragConstraints', 'dragElastic', 'dragControls', 'dragListener',
    'dragSnapToOrigin', 'dragMomentum', 'onDragStart', 'onDragEnd', 'onAnimationComplete',
  ])

  function Div({ ref, ...props }: Record<string, unknown> & { ref?: Ref<HTMLDivElement> }) {
    const onAnimationComplete = props.onAnimationComplete as (() => void) | undefined
    useEffect(() => {
      onAnimationComplete?.()
      return () => onAnimationComplete?.()
    })

    const domProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => !MOTION_ONLY.has(key)),
    )
    // Motion values are objects; only plain CSS survives the trip to the DOM.
    if (domProps.style && typeof domProps.style === 'object') {
      domProps.style = Object.fromEntries(
        Object.entries(domProps.style as Record<string, unknown>).filter(
          ([, value]) => typeof value === 'string' || typeof value === 'number',
        ),
      )
    }
    return <div {...domProps} ref={ref} />
  }

  /** Enough of a motion value to read, write and derive from. */
  function motionValue(initial: unknown) {
    let current = initial
    return {
      get: () => current,
      set: (next: unknown) => { current = next },
      on: () => () => {},
    }
  }

  function AnimatePresence({
    children,
    onExitComplete,
  }: {
    children?: ReactNode
    onExitComplete?: () => void
  }) {
    const wasPresent = useRef(false)
    const present = Children.toArray(children).length > 0
    useEffect(() => {
      if (wasPresent.current && !present) onExitComplete?.()
      wasPresent.current = present
    }, [present, onExitComplete])
    return <>{children}</>
  }

  return {
    motion: { div: Div },
    AnimatePresence,
    useDragControls: () => ({ start: () => {} }),
    useReducedMotion: () => false,
    useMotionValue: (initial: unknown) => motionValue(initial),
    useTransform: (source: { get: () => number }, transform: (value: number) => number) =>
      motionValue(transform(source.get())),
    animate: (value: { set: (next: unknown) => void }, to: unknown) => {
      value.set(to)
      return { stop: () => {} }
    },
  }
})

describe('BottomSheet focus containment', () => {
  it('cycles Tab inside the sheet and leaves the background inert', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>background</button>
        <BottomSheet isOpen onClose={() => {}} title="Pick a mint">
          <button>alpha</button>
          <button>omega</button>
        </BottomSheet>
      </>,
    )

    expect(screen.getByText('background')).toHaveAttribute('inert')

    screen.getByText('omega').focus()
    await user.tab()
    expect(screen.getByText('alpha')).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByText('omega')).toHaveFocus()
  })

  it('returns focus to the opener when the sheet closes', () => {
    const tree = (isOpen: boolean) => (
      <>
        <button>open sheet</button>
        <BottomSheet isOpen={isOpen} onClose={() => {}} title="Pick a mint">
          <button>alpha</button>
        </BottomSheet>
      </>
    )

    const { rerender } = render(tree(false))
    const opener = screen.getByText('open sheet')
    opener.focus()

    rerender(tree(true))
    rerender(tree(false))

    expect(opener).toHaveFocus()
  })
})

describe('HistoryDrawer focus containment', () => {
  it('cycles Tab inside the expanded drawer and leaves the background inert', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>background</button>
        <HistoryDrawer expanded onExpandedChange={() => {}} peek={null} transactions={[]} />
      </>,
    )

    const action = await screen.findByText('history-action')
    // The drawer portals to the body, so what goes inert is the app subtree the
    // background sits in, not the button node itself.
    expect(screen.getByText('background').closest('[inert]')).not.toBeNull()

    action.focus()
    await user.tab()

    expect(action).toHaveFocus()
    expect(screen.getByText('background')).not.toHaveFocus()
  })
})
