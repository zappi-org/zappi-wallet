import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MyAddressScreen } from '@/ui/screens/MyAddress/MyAddressScreen'
import { ChangeUsernameSheet } from '@/ui/screens/Settings/ChangeUsernameSheet'
import { NPUBCASH_DOMAIN } from '@/core/constants'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/ui/config/feature-flags', () => ({ ENABLE_LIGHTNING_ADDRESS_SETTINGS: true }))
vi.mock('@/ui/components/common/BottomSheet', () => ({
  BottomSheet: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div>{children}</div> : null,
}))
vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}))
vi.mock('@/ui/hooks/use-keyboard-inset', () => ({ useKeyboardInset: () => 0 }))
vi.mock('@/utils/format', () => ({ useFormatSats: () => (amount: number) => `${amount} sats` }))
vi.mock('@/ui/hooks/use-crypto', () => ({ useCrypto: () => ({ encodeNpub: () => 'npub1test' }) }))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({ useMintMetadata: () => ({ getDisplayName: () => 'Mint', getIconUrl: () => undefined }) }))
const copy = vi.fn()
const share = vi.fn()
vi.mock('@/ui/hooks/use-copy-feedback', () => ({
  useCopyFeedback: () => ({ copy, share, isCopied: () => false, isShared: () => false }),
}))
vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: ({ isOpen, onSelect }: { isOpen: boolean; onSelect: (url: string) => void }) =>
    isOpen ? <button onClick={() => onSelect('https://source')}>fund</button> : null,
}))
const state = {
  settings: { lightningAddress: 'john@zappi.link', mints: ['https://mint', 'https://source'], mintAliases: {} },
  balance: { byMint: {} as Record<string, number> },
  nostrPrivkey: 'secret', nostrPubkey: 'public', addToast: vi.fn(), triggerTxRefresh: vi.fn(),
  updateSettings: vi.fn((patch: Record<string, unknown>) => Object.assign(state.settings, patch)),
}
vi.mock('@/store', () => ({ useAppStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) }))
const getAlias = vi.fn()
const checkAliasPrice = vi.fn()
const changeAlias = vi.fn()
const executeSwap = vi.fn()
const registry = { paymentAlias: { getAlias, checkAliasPrice, changeAlias }, swap: { executeSwap } }
vi.mock('@/ui/hooks/use-service-registry', () => ({ useServiceRegistry: () => registry }))
const quote = (amount: number) => ({ ok: true, value: { amount, unit: 'sat', mintUrl: 'https://mint' } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const flush = async () => { await act(async () => {}) }
const changeInput = (name: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value: name } })
const submit = () => fireEvent.click(screen.getAllByRole('button', { name: 'common.change' }).at(-1)!)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  state.settings.lightningAddress = 'john@zappi.link'
  state.balance.byMint = {}
  getAlias.mockResolvedValue({ ok: true, value: { alias: 'john', domain: 'zappi.link', mintUrl: 'https://mint' } })
  checkAliasPrice.mockResolvedValue(quote(100))
  changeAlias.mockResolvedValue({ ok: true, value: { alias: 'alice' } })
  executeSwap.mockResolvedValue({ ok: true, value: {} })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('address rename', () => {
  it.each([false, true])('updates the mounted QR/copy/share after successful rename (funded=%s), even if revalidation fails', async (funded) => {
    if (funded) state.balance.byMint = { 'https://mint': 0, 'https://source': 1000 }
    const view = render(<MyAddressScreen onBack={vi.fn()} onSaveSettings={vi.fn(async () => {})} />)
    await flush()
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', 'john@zappi.link')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    changeInput('alice')
    submit()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'settings.pay' }))
    if (funded) { await flush(); fireEvent.click(screen.getByRole('button', { name: 'fund' })) }
    await flush()
    expect(changeAlias).toHaveBeenCalledWith('secret', 'alice', '', 'settings.changeUsername')
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', `alice@${NPUBCASH_DOMAIN}`)
    // MainApp changes the save callback identity as settings change, causing revalidation.
    getAlias.mockRejectedValue(new Error('offline'))
    view.rerender(<MyAddressScreen onBack={vi.fn()} onSaveSettings={vi.fn(async () => {})} />)
    await flush()
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', `alice@${NPUBCASH_DOMAIN}`)
    fireEvent.click(screen.getAllByRole('button', { name: 'common.copy' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'receive.qr.share' }))
    expect(copy).toHaveBeenCalledWith(`alice@${NPUBCASH_DOMAIN}`)
    expect(share).toHaveBeenCalledWith(`alice@${NPUBCASH_DOMAIN}`)
  })

  it('ignores a lookup started before the successful rename', async () => {
    const oldLookup = deferred<unknown>()
    getAlias.mockReturnValue(oldLookup.promise)
    render(<MyAddressScreen onBack={vi.fn()} onSaveSettings={vi.fn(async () => {})} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    changeInput('alice'); submit(); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'settings.pay' }))
    await flush()
    await act(async () => oldLookup.resolve({ ok: true, value: { alias: 'john', domain: 'zappi.link', mintUrl: 'https://mint' } }))
    expect(screen.getByTestId('qr')).toHaveAttribute('data-value', `alice@${NPUBCASH_DOMAIN}`)
  })
})

describe('username availability races', () => {
  it.each(['bob', '', '!', 'john'])('ignores an in-flight alice result when the input becomes %j', async (next) => {
    const alice = deferred<ReturnType<typeof quote>>()
    const bob = deferred<ReturnType<typeof quote>>()
    checkAliasPrice.mockReturnValueOnce(alice.promise).mockReturnValue(bob.promise)
    render(<ChangeUsernameSheet isOpen onClose={vi.fn()} onSaveSettings={vi.fn()} />)
    changeInput('alice')
    await act(async () => vi.advanceTimersByTime(400))
    changeInput(next)
    await act(async () => alice.resolve(quote(100)))
    expect(screen.queryByText('settings.usernameAvailable')).not.toBeInTheDocument()
    if (next === 'bob') {
      submit()
      expect(checkAliasPrice).toHaveBeenLastCalledWith('secret', 'bob')
      expect(screen.queryByText('settings.changeConfirmTitle')).not.toBeInTheDocument()
      await act(async () => bob.resolve(quote(500)))
      await act(async () => vi.advanceTimersByTime(1000))
      expect(screen.getByText('500 sats')).toBeInTheDocument()
      expect(screen.queryByText('100 sats')).not.toBeInTheDocument()
    }
  })

  it('does not let a queued debounce supersede an explicit check', async () => {
    const pending = deferred<ReturnType<typeof quote>>()
    checkAliasPrice.mockReturnValue(pending.promise)
    render(<ChangeUsernameSheet isOpen onClose={vi.fn()} onSaveSettings={vi.fn()} />)
    changeInput('alice'); submit()
    await act(async () => vi.advanceTimersByTime(400))
    expect(checkAliasPrice).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(quote(100)))
    expect(screen.getByText('settings.changeConfirmTitle')).toBeInTheDocument()
  })
})
