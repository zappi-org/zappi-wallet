import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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

  it('suppresses dismissal while a validation is in flight, allows it once settled', async () => {
    validateAsync.mockClear()
    let resolveValidate: (v: typeof validated) => void = () => {}
    validateAsync.mockImplementationOnce(() => new Promise((res) => { resolveValidate = res }))
    const onClose = vi.fn()
    const onValidated = vi.fn()
    Object.assign(navigator, { clipboard: { readText: vi.fn().mockResolvedValue('cashuA...') } })
    render(<RedeemSheet isOpen onClose={onClose} onValidated={onValidated} />)

    fireEvent.click(screen.getByText('receive.redeem.paste'))
    await waitFor(() => expect(validateAsync).toHaveBeenCalledTimes(1))

    // Backdrop dismissal mid-validation is a no-op — closing would race the
    // flow's continuation (confirm routing / reclaim).
    const backdrop = document.querySelector('div.inset-0.bg-black')!
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()

    // Once the attempt settles, dismissal works again.
    await act(async () => { resolveValidate(validated) })
    expect(onValidated).toHaveBeenCalledWith(validated)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // The sheet has no auto-feed any more: a routed/scanned token is parsed before
  // the flow is entered and lands on its confirm step. Opening the sheet to
  // re-parse it mounted the camera for ~320ms and then dismissed itself.
  it('opens inert — nothing is validated until the user supplies input', async () => {
    validateAsync.mockClear()
    const onValidated = vi.fn()
    render(<RedeemSheet isOpen onClose={vi.fn()} onValidated={onValidated} />)
    await Promise.resolve()
    expect(validateAsync).not.toHaveBeenCalled()
    expect(onValidated).not.toHaveBeenCalled()
  })
})
