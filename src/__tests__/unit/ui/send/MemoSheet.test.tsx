import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoSheet } from '@/ui/screens/Send/MemoSheet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('MemoSheet', () => {
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
})
