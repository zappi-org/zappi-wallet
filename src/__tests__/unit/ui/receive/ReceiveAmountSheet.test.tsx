import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveAmountSheet } from '@/ui/screens/Receive/ReceiveAmountSheet'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

const base = {
  isOpen: true, onClose: vi.fn(), onEditMint: vi.fn(), onConfirm: vi.fn(),
  mintUrl: 'https://mint.a', mintDisplayName: 'Lemonfizz',
  initialAmount: 0, initialMemo: '',
}

describe('ReceiveAmountSheet', () => {
  it('disables confirm at zero, enables after keypad input, emits amount+memo', () => {
    render(<ReceiveAmountSheet {...base} />)
    const confirm = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirm).toBeDisabled()
    fireEvent.pointerDown(screen.getByText('1'))
    fireEvent.pointerDown(screen.getByText('0'))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(base.onConfirm).toHaveBeenCalledWith({ amount: 10, memo: '' })
  })

  it('reset clears the amount', () => {
    render(<ReceiveAmountSheet {...base} initialAmount={500} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.reset' }))
    expect(screen.getByRole('button', { name: 'common.confirm' })).toBeDisabled()
  })
})
