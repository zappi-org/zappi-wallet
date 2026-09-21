import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MyAddressScreen } from '@/ui/screens/MyAddress/MyAddressScreen'
import { NPUBCASH_DOMAIN } from '@/core/constants'

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
// Passthrough no longer needed — tab content swaps without animation (the
// DirectionalTabPanel import was removed from the screen).
// (mock removed)

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
  settings: { lightningAddress: 'john@zappi.link' as string | null, mintAliases: {}, mints: [] as string[] },
  balance: { byMint: {} },
  nostrPubkey: 'deadbeef',
  nostrPrivkey: 'privkey-hex',
}
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}))
vi.mock('@/ui/hooks/use-crypto', () => ({
  useCrypto: () => ({ encodeNpub: () => 'npub1testxyz' }),
}))
const getAlias = vi.fn()
const getCurrentAlias = vi.fn()
// registry must be a stable reference like the real context — a fresh object
// every render becomes an effect re-run loop (see RelayManagementScreen.test.tsx).
const stableRegistry = { paymentAlias: { getAlias, getCurrentAlias } }
vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => stableRegistry,
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({ getDisplayName: () => 'Lemonfizz', getIconUrl: () => undefined }),
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
    localStorage.clear()
    flags.lightning = false
    storeState.settings.lightningAddress = 'john@zappi.link'
    getAlias.mockReset()
    getAlias.mockResolvedValue({ ok: true, value: { alias: 'john', domain: 'zappi.link', mintUrl: 'https://mint.a', lockQuote: false } })
    getCurrentAlias.mockReset()
    getCurrentAlias.mockResolvedValue({ ok: true, value: { alias: 'john' } })
  })

  it('shows coming soon on the lightning tab while the feature is gated', async () => {
    render(<MyAddressScreen onBack={vi.fn()} />)
    await selectLightningTab()
    expect(screen.getByText('myAddress.comingSoon')).toBeInTheDocument()
    // The gated tab offers neither the address nor the dead create CTA.
    expect(screen.queryByText('john@zappi.link')).not.toBeInTheDocument()
    expect(screen.queryByText('myAddress.createAddress')).not.toBeInTheDocument()
  })

  it('shows the lightning address QR and deposit-mint row once ungated', async () => {
    flags.lightning = true
    render(<MyAddressScreen onBack={vi.fn()} />)
    await selectLightningTab()
    expect(screen.getByText('john@zappi.link')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Lemonfizz')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'common.change' })).toBeInTheDocument()
  })

  it('falls back to the generic caption when getAlias rejects', async () => {
    flags.lightning = true
    getAlias.mockReset()
    getAlias.mockRejectedValue(new Error('offline'))
    render(<MyAddressScreen onBack={vi.fn()} />)
    await selectLightningTab()
    await waitFor(() => expect(screen.getByText('myAddress.depositsToFallback')).toBeInTheDocument())
    expect(screen.queryByText(/myAddress\.depositsTo:/)).not.toBeInTheDocument()
  })

  it('missing address registers the npub via the npubcash alias', async () => {
    flags.lightning = true
    storeState.settings.lightningAddress = null
    // Server genuinely has no alias — the create CTA path stays visible
    // (the alias-restore path is covered by the address-display cases above).
    getAlias.mockResolvedValue({ ok: true, value: { alias: null, domain: 'zappi.link', mintUrl: null, lockQuote: false } })
    const onSaveSettings = vi.fn(async () => {})
    render(<MyAddressScreen onBack={vi.fn()} onSaveSettings={onSaveSettings} />)
    await selectLightningTab()
    fireEvent.click(screen.getByText('myAddress.createAddress'))
    expect(getCurrentAlias).toHaveBeenCalled()
    await waitFor(() =>
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ lightningAddress: `john@${NPUBCASH_DOMAIN}` }),
      ),
    )
  })
})
