import { Children, useEffect, useRef, type ReactNode, type Ref } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '@/ui/components/common/BottomSheet'

const motionState = vi.hoisted(() => ({
  reduced: false,
  startDrag: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const isTop = vi.fn(() => true)
vi.mock('@/ui/navigation/use-is-activity-top', () => ({
  useIsActivityTop: () => isTop(),
}))

/** Motion props are dropped so React does not warn about unknown DOM attributes. */
vi.mock('motion/react', () => {
  const MOTION_ONLY = new Set([
    'initial', 'animate', 'exit', 'transition', 'layout',
    'drag', 'dragConstraints', 'dragElastic', 'dragControls', 'dragListener',
    'dragSnapToOrigin', 'onDragEnd', 'onAnimationComplete',
  ])

  function Div({ ref, ...props }: Record<string, unknown> & { ref?: Ref<HTMLDivElement> }) {
    const domProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => !MOTION_ONLY.has(key)),
    )
    return <div {...domProps} ref={ref} />
  }

  function AnimatePresence({ children }: { children?: ReactNode }) {
    const wasPresent = useRef(false)
    const present = Children.toArray(children).length > 0
    useEffect(() => { wasPresent.current = present }, [present])
    return <>{children}</>
  }

  return {
    motion: { div: Div },
    AnimatePresence,
    useDragControls: () => ({ start: motionState.startDrag }),
    useReducedMotion: () => motionState.reduced,
  }
})

const backdrop = () => document.querySelector('.bg-black') as HTMLElement

beforeEach(() => {
  motionState.reduced = false
  motionState.startDrag.mockReset()
})

describe('BottomSheet dismissal', () => {
  it('closes on a backdrop tap and on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BottomSheet isOpen onClose={onClose} title="sheet"><p>body</p></BottomSheet>)

    await user.click(backdrop())
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('ignores the backdrop and Escape while not dismissible', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={onClose} dismissible={false} title="sheet">
        <p>body</p>
      </BottomSheet>,
    )

    await user.click(backdrop())
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders at the body when portalled', () => {
    const { container } = render(
      <BottomSheet isOpen onClose={() => {}} portal title="sheet">
        <p>portal-body</p>
      </BottomSheet>,
    )

    expect(screen.getByText('portal-body')).toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('folds when its activity stops being the top of the stack', () => {
    const onClose = vi.fn()
    isTop.mockReturnValue(false)
    render(
      <BottomSheet isOpen onClose={onClose} portal closeWhenCovered title="sheet">
        <p>body</p>
      </BottomSheet>,
    )

    expect(onClose).toHaveBeenCalled()
    isTop.mockReturnValue(true)
  })

  it('stays put when covered but not asked to fold', () => {
    const onClose = vi.fn()
    isTop.mockReturnValue(false)
    render(
      <BottomSheet isOpen onClose={onClose} portal title="sheet">
        <p>body</p>
      </BottomSheet>,
    )

    expect(onClose).not.toHaveBeenCalled()
    isTop.mockReturnValue(true)
  })

  it('keeps drag dismissal available when reduced motion is requested', () => {
    motionState.reduced = true
    render(<BottomSheet isOpen onClose={() => {}} title="sheet"><p>body</p></BottomSheet>)

    fireEvent.pointerDown(screen.getByRole('dialog'), { clientX: 20, clientY: 20 })

    expect(motionState.startDrag).toHaveBeenCalledTimes(1)
  })

  it('provides a 44px touch-reserved drag surface', () => {
    render(<BottomSheet isOpen onClose={() => {}} title="sheet"><p>body</p></BottomSheet>)

    const handle = document.querySelector('[data-sheet-drag-handle]')
    expect(handle).not.toBeNull()
    expect((handle as HTMLElement).style.minHeight).toBe('44px')
    expect((handle as HTMLElement).style.touchAction).toBe('none')
  })
})
