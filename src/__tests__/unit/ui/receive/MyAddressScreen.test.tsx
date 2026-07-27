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

// The lightning tab's content is flag-gated, so the flag has to be steerable
// per test — a getter keeps the ESM live binding readable at render time.
const flags = { lightning: false }
vi.mock('@/ui/config/feature-flags', () => ({
  get ENABLE_LIGHTNING_ADDRESS_SETTINGS() {
    return flags.lightning
  },
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

// Radix TabsTrigger switches on mousedown/focus, not click — fireEvent.click
// never fires those, so the established repo pattern (ReceiveRequestStep.protocols.test.tsx)
// is userEvent, which simulates the full pointer sequence.
const selectLightningTab = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'myAddress.lightningTab' }))
}

describe('MyAddressScreen', () => {
  beforeEach(() => {
    flags.lightning = false
    storeState.settings.lightningAddress = 'john@zappi.link'
    getDefaults.mockReset()
    getDefaults.mockResolvedValue({ ok: true, value: { mintUrl: 'https://mint.a' } })
  })

  it('opens on the npub — the handle that always exists', () => {
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText('npub1testxyz')).toBeInTheDocument()
  })

  it('shows coming soon on the lightning tab while the feature is gated', async () => {
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    await selectLightningTab()
    expect(screen.getByText('myAddress.comingSoon')).toBeInTheDocument()
    // The gated tab offers neither the address nor the dead create CTA.
    expect(screen.queryByText('john@zappi.link')).not.toBeInTheDocument()
    expect(screen.queryByText('myAddress.createAddress')).not.toBeInTheDocument()
  })

  it('shows the lightning address QR and deposit-mint caption once ungated', async () => {
    flags.lightning = true
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    await selectLightningTab()
    expect(screen.getByText('john@zappi.link')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('myAddress.depositsTo:Lemonfizz')).toBeInTheDocument())
  })

  it('falls back to the generic caption when getDefaults rejects', async () => {
    flags.lightning = true
    getDefaults.mockReset()
    getDefaults.mockRejectedValue(new Error('offline'))
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    await selectLightningTab()
    await waitFor(() => expect(screen.getByText('myAddress.depositsToFallback')).toBeInTheDocument())
    expect(screen.queryByText(/myAddress\.depositsTo:/)).not.toBeInTheDocument()
  })

  it('missing lightning address routes the create CTA to settings', async () => {
    flags.lightning = true
    storeState.settings.lightningAddress = null
    const onOpenSettings = vi.fn()
    render(<MyAddressScreen onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    await selectLightningTab()
    fireEvent.click(screen.getByText('myAddress.createAddress'))
    expect(onOpenSettings).toHaveBeenCalled()
  })
})
