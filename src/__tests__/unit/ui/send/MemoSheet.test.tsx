import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoSheet } from '@/ui/screens/Send/MemoSheet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Drive the activity-top signal so the interrupt path can be exercised without
// mounting a full stackflow stack.
const activity = vi.hoisted(() => ({ isTop: true }))
vi.mock('@/ui/navigation/use-is-activity-top', () => ({
  useIsActivityTop: () => activity.isTop,
}))

describe('MemoSheet', () => {
  beforeEach(() => {
    activity.isTop = true
  })

  it('saves the trimmed draft and closes', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<MemoSheet isOpen memo="" onSave={onSave} onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('send.memo.placeholder'), {
      target: { value: '  coffee  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    expect(onSave).toHaveBeenCalledWith('coffee')
    expect(onClose).toHaveBeenCalled()
  })

  it('re-seeds the draft from the memo prop each time it opens', () => {
    const { rerender } = render(<MemoSheet isOpen={false} memo="old" onSave={vi.fn()} onClose={vi.fn()} />)
    rerender(<MemoSheet isOpen memo="old" onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('send.memo.placeholder')).toHaveValue('old')
  })

  it('closes itself when its owning activity is no longer top', () => {
    const onClose = vi.fn()
    const { rerender } = render(<MemoSheet isOpen memo="" onSave={vi.fn()} onClose={onClose} />)
    expect(onClose).not.toHaveBeenCalled()

    activity.isTop = false
    rerender(<MemoSheet isOpen memo="" onSave={vi.fn()} onClose={onClose} />)
    expect(onClose).toHaveBeenCalled()
  })
})
