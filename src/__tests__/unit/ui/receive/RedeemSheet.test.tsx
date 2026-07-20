import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RedeemSheet } from '@/ui/screens/Receive/redeem/RedeemSheet'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/ui/components/common/QrScanner', () => ({ QrScanner: () => <div data-testid="camera" /> }))

const validated = { type: 'cashu-token', token: 'cashuA...', mintUrl: 'https://mint.a', amount: { value: 10n, unit: 'sat' } }
const validateAsync = vi.fn().mockResolvedValue(validated)
vi.mock('@/ui/hooks/use-input-parser', () => ({
  useInputParser: () => ({ detectAndClassify: (raw: string) => ({ raw }), validateAsync }),
}))

describe('RedeemSheet', () => {
  it('pasted token validates and bubbles up', async () => {
    const onValidated = vi.fn()
    Object.assign(navigator, { clipboard: { readText: vi.fn().mockResolvedValue('cashuA...') } })
    render(<RedeemSheet isOpen onClose={vi.fn()} onValidated={onValidated} />)
    fireEvent.click(screen.getByText('receive.redeem.paste'))
    await waitFor(() => expect(onValidated).toHaveBeenCalledWith(validated))
  })

  it('non-cashu input delegates to router', async () => {
    validateAsync.mockResolvedValueOnce({ type: 'bolt11', invoice: 'lnbc...' })
    const onRouteValidated = vi.fn()
    Object.assign(navigator, { clipboard: { readText: vi.fn().mockResolvedValue('lnbc...') } })
    render(<RedeemSheet isOpen onClose={vi.fn()} onValidated={vi.fn()} onRouteValidated={onRouteValidated} />)
    fireEvent.click(screen.getByText('receive.redeem.paste'))
    await waitFor(() => expect(onRouteValidated).toHaveBeenCalled())
  })
})
