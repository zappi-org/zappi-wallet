import { useEffect, useRef, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useFocusTrap } from '@/ui/hooks/use-focus-trap'

/**
 * Stands in for a motion sheet. The enter animation settles right after mount,
 * and motion fires that same onAnimationComplete again for the exit, just
 * before AnimatePresence reports onExitComplete — the order the focus-return
 * path has to survive.
 */
function Dialog({
  open,
  name,
  children,
}: {
  open: boolean
  name: string
  children?: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { onEntryComplete, restoreFocus } = useFocusTrap(open, containerRef, backdropRef)
  const wasOpen = useRef(false)

  useEffect(() => {
    onEntryComplete()
  })

  useEffect(() => {
    if (wasOpen.current && !open) restoreFocus()
    wasOpen.current = open
  }, [open, restoreFocus])

  if (!open) return null

  return (
    <>
      <div ref={backdropRef} data-testid={`${name}-backdrop`} />
      <div ref={containerRef} role="dialog" aria-modal="true" tabIndex={-1} data-testid={name}>
        {children}
      </div>
    </>
  )
}

describe('useFocusTrap', () => {
  it('wraps Tab from the last focusable back to the first', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>background</button>
        <Dialog open name="sheet">
          <button>first</button>
          <button>last</button>
        </Dialog>
      </>,
    )

    screen.getByText('last').focus()
    await user.tab()

    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first focusable back to the last', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>background</button>
        <Dialog open name="sheet">
          <button>first</button>
          <button>last</button>
        </Dialog>
      </>,
    )

    screen.getByText('first').focus()
    await user.tab({ shift: true })

    expect(screen.getByText('last')).toHaveFocus()
  })

  /** The dialog surface itself holds focus on open; stepping back must not leave it. */
  it('sends Shift+Tab from the dialog surface to the last focusable', async () => {
    const user = userEvent.setup()
    render(
      <Dialog open name="sheet">
        <button>first</button>
        <button>last</button>
      </Dialog>,
    )

    expect(screen.getByTestId('sheet')).toHaveFocus()
    await user.tab({ shift: true })

    expect(screen.getByText('last')).toHaveFocus()
  })

  it('never lands on background controls while the dialog is open', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>background</button>
        <Dialog open name="sheet">
          <button>first</button>
          <button>last</button>
        </Dialog>
      </>,
    )

    for (let step = 0; step < 5; step += 1) {
      await user.tab()
      expect(screen.getByText('background')).not.toHaveFocus()
    }
  })

  it('makes background siblings inert and releases them on close', () => {
    const { rerender } = render(
      <>
        <button>background</button>
        <Dialog open name="sheet">
          <button>first</button>
        </Dialog>
      </>,
    )

    expect(screen.getByText('background')).toHaveAttribute('inert')
    // The backdrop stays live or tap-to-dismiss would stop firing.
    expect(screen.getByTestId('sheet-backdrop')).not.toHaveAttribute('inert')

    rerender(
      <>
        <button>background</button>
        <Dialog open={false} name="sheet" />
      </>,
    )

    expect(screen.getByText('background')).not.toHaveAttribute('inert')
  })

  it('traps within a nested dialog and hands back when it closes', async () => {
    const user = userEvent.setup()
    const tree = (innerOpen: boolean) => (
      <Dialog open name="outer">
        <button>outer-action</button>
        <Dialog open={innerOpen} name="inner">
          <button>inner-action</button>
        </Dialog>
      </Dialog>
    )

    const { rerender } = render(tree(true))

    expect(screen.getByText('outer-action')).toHaveAttribute('inert')
    screen.getByText('inner-action').focus()
    await user.tab()
    expect(screen.getByText('inner-action')).toHaveFocus()

    rerender(tree(false))

    expect(screen.getByText('outer-action')).not.toHaveAttribute('inert')
    screen.getByText('outer-action').focus()
    await user.tab()
    expect(screen.getByText('outer-action')).toHaveFocus()
  })

  /**
   * The regression: the opener used to be recorded on onAnimationComplete, which
   * motion also fires for the exit, so the dialog overwrote its own opener and
   * the restore focused a node on its way out.
   */
  it('returns focus to the opener even though the exit re-fires the entry callback', () => {
    const { rerender } = render(
      <>
        <button>open sheet</button>
        <Dialog open={false} name="sheet" />
      </>,
    )

    const opener = screen.getByText('open sheet')
    opener.focus()

    rerender(
      <>
        <button>open sheet</button>
        <Dialog open name="sheet">
          <button>first</button>
        </Dialog>
      </>,
    )
    expect(screen.getByTestId('sheet')).toHaveFocus()

    rerender(
      <>
        <button>open sheet</button>
        <Dialog open={false} name="sheet" />
      </>,
    )

    expect(opener).toHaveFocus()
  })

  it('detaches the listener once nothing is open', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<Dialog open name="sheet" />)

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    removeSpy.mockRestore()
  })
})
