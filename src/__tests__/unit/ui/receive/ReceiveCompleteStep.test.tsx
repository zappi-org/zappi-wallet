import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveCompleteStep } from '@/ui/screens/Receive/steps/ReceiveCompleteStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ko' } }),
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({ getDisplayName: () => 'Lemonfizz' }),
}))

const base = {
  amount: 1000, mintUrl: 'https://mint.a', method: 'bolt11' as const,
  receivedAt: 1750000000000, onExit: vi.fn(),
}

describe('ReceiveCompleteStep', () => {
  it('renders method/mint rows and exit works', () => {
    render(<ReceiveCompleteStep {...base} />)
    expect(screen.getByText('receive.receipt.methodLightning')).toBeInTheDocument()
    expect(screen.getByText('Lemonfizz')).toBeInTheDocument()
    fireEvent.click(screen.getByText('receive.request.exit'))
    expect(base.onExit).toHaveBeenCalled()
  })

  it('hides make-another when callback absent, shows it when present', () => {
    const { rerender } = render(<ReceiveCompleteStep {...base} />)
    expect(screen.queryByText('receive.request.makeAnother')).not.toBeInTheDocument()
    const onMakeAnother = vi.fn()
    rerender(<ReceiveCompleteStep {...base} onMakeAnother={onMakeAnother} />)
    fireEvent.click(screen.getByText('receive.request.makeAnother'))
    expect(onMakeAnother).toHaveBeenCalled()
  })
})
