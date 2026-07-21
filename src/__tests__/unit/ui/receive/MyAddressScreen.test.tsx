import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MyAddressScreen } from '@/ui/screens/MyAddress/MyAddressScreen'

// t() interpolates {{mint}} so the success caption can be asserted by value.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { mint?: string }) => (opts?.mint ? `${k}:${opts.mint}` : k),
  }),
}))
// QRCodeDisplay pulls in bc-ur -> cborg (unresolvable exports map in vitest);
// value goes in a data attribute so it doesn't collide with the plaintext string.
vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: ({ value }: { value: string }) => <div data-testid="qr-value" data-value={value} />,
}))
// Passthrough so the active tab's content always renders (no AnimatePresence timing).
vi.mock('@/ui/components/common/DirectionalTabPanel', () => ({
  DirectionalTabPanel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const storeState = {
  addToast: vi.fn(),
  settings: { lightningAddress: 'john@zappi.link' as string | null, mintAliases: {} },
  nostrPubkey: 'deadbeef',
}
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}))
vi.mock('@/ui/hooks/use-crypto', () => ({
  useCrypto: () => ({ encodeNpub: () => 'npub1testxyz' }),
}))
const getDefaults = vi.fn()
// registry must be a stable reference like the real context — a fresh object
// every render becomes an effect re-run loop (see RelayManagementScreen.test.tsx).
const stableRegistry = { username: { getDefaults } }
vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => stableRegistry,
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({ getDisplayName: () => 'Lemonfizz' }),
}))

describe('MyAddressScreen', () => {
  beforeEach(() => {
    storeState.settings.lightningAddress = 'john@zappi.link'
    getDefaults.mockReset()
    getDefaults.mockResolvedValue({ ok: true, value: { mintUrl: 'https://mint.a' } })
  })

  it('shows the lightning address QR and deposit-mint caption', async () => {
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText('john@zappi.link')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('myAddress.depositsTo:Lemonfizz')).toBeInTheDocument())
  })

  it('switches to the nostr tab and shows the npub', async () => {
    // Radix TabsTrigger switches on mousedown/focus, not click — fireEvent.click
    // never fires those, so the established repo pattern (ReceiveRequestStep.protocols.test.tsx)
    // is userEvent, which simulates the full pointer sequence.
    const user = userEvent.setup()
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'myAddress.nostrTab' }))
    expect(screen.getByText('npub1testxyz')).toBeInTheDocument()
  })

  it('falls back to the generic caption when getDefaults rejects', async () => {
    getDefaults.mockReset()
    getDefaults.mockRejectedValue(new Error('offline'))
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('myAddress.depositsToFallback')).toBeInTheDocument())
    expect(screen.queryByText(/myAddress\.depositsTo:/)).not.toBeInTheDocument()
  })

  it('missing lightning address routes the create CTA to settings', () => {
    storeState.settings.lightningAddress = null
    const onOpenSettings = vi.fn()
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByText('myAddress.createAddress'))
    expect(onOpenSettings).toHaveBeenCalled()
  })
})
