/**
 * MyAddressScreen — the profile-owned identity screen. The user's static
 * receive handles (lightning address + nostr npub) with QR, copy, share.
 * Split out of the receive flow so identity (mint-bound / mint-agnostic
 * address) lives apart from per-mint request creation (receive-ia-split).
 *
 * Presentation: ticket-style card (white ticket outlined in brand-200 over a
 * brand-600 underlay, perforated tear line between QR and address info).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Pencil, Copy, Check, Share2, Info } from 'lucide-react'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { ChangeUsernameSheet } from '@/ui/screens/Settings/ChangeUsernameSheet'
import { useAppStore } from '@/store'
import { useCopyFeedback } from '@/ui/hooks/use-copy-feedback'
import { useCrypto } from '@/ui/hooks/use-crypto'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { hapticTap } from '@/ui/utils/haptic'
import { ENABLE_LIGHTNING_ADDRESS_SETTINGS } from '@/ui/config/feature-flags'
import { NPUBCASH_URL, NPUBCASH_DOMAIN } from '@/core/constants'

export interface MyAddressScreenProps {
  onBack: () => void
  /** Persists settings (store + repo) — MainApp's handleSaveSettings. */
  onSaveSettings?: (settings: Record<string, unknown>) => Promise<void>
}

type AddressTab = 'lightning' | 'nostr'

/**
 * Deposit mint + alias live on npubcash (username usecase). Hybrid: cache in
 * localStorage for instant warm renders, fetch revalidates every entry.
 */
type DepositMintState =
  | { status: 'loading' }
  | { status: 'ready'; mintUrl: string }
  | { status: 'error' }

interface MyAddressCache {
  alias?: string
  mintUrl?: string
  updatedAt: number
}

const MYADDRESS_CACHE_KEY = 'zappi-myaddress-cache'

function readMyAddressCache(): MyAddressCache | null {
  try {
    const raw = localStorage.getItem(MYADDRESS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MyAddressCache
    return parsed && (parsed.alias || parsed.mintUrl) ? parsed : null
  } catch {
    return null
  }
}

function writeMyAddressCache(cache: MyAddressCache): void {
  try {
    localStorage.setItem(MYADDRESS_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // storage full/denied — the cache is a nicety, never fail the screen
  }
}

function useDepositMint(
  refreshKey: number,
  onSaveSettings?: (settings: Record<string, unknown>) => Promise<void>,
): { deposit: DepositMintState; cache: MyAddressCache | null } {
  const registry = useServiceRegistry()
  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const [deposit, setDeposit] = useState<DepositMintState>({ status: 'loading' })
  const [cache, setCache] = useState<MyAddressCache | null>(readMyAddressCache)
  useEffect(() => {
    // registry is stable for the app's lifetime (bootstrap sets it once). On
    // revalidation (refreshKey) the last state/cache stay on screen — no flash
    // back to a loading placeholder.
    let cancelled = false
    const fetchDeposit = nostrPrivkey
      ? registry.paymentAlias.getAlias(nostrPrivkey)
      : Promise.reject(new Error('no privkey'))
    fetchDeposit
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          const next: MyAddressCache = {
            alias: result.value.alias || undefined,
            mintUrl: result.value.mintUrl || undefined,
            updatedAt: Date.now(),
          }
          writeMyAddressCache(next)
          setCache(next)
          setDeposit(
            result.value.mintUrl
              ? { status: 'ready', mintUrl: result.value.mintUrl }
              : { status: 'error' },
          )
          // Store lost the address? npubcash still knows the alias — restore it.
          if (result.value.alias && !useAppStore.getState().settings.lightningAddress) {
            onSaveSettings?.({
              lightningAddress: `${result.value.alias}@${result.value.domain}`,
              npubcashUrl: NPUBCASH_URL,
            })
          }
        } else {
          setDeposit({ status: 'error' })
        }
      })
      .catch(() => {
        if (!cancelled) setDeposit({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [registry, nostrPrivkey, refreshKey, onSaveSettings])
  return { deposit, cache }
}

const TABS: AddressTab[] = ['lightning', 'nostr']

export function MyAddressScreen({ onBack, onSaveSettings }: MyAddressScreenProps) {
  const { t } = useTranslation()
  const lightningAddress = useAppStore((s) => s.settings.lightningAddress) ?? null
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const crypto = useCrypto()
  // human readable (lightning / NIP-05) is the default view.
  const [tab, setTab] = useState<AddressTab>('lightning')
  const { isCopied, isShared, copy, share } = useCopyFeedback()

  // npub derived from the stored pubkey (mirrors ReceiveFlow's prior derivation).
  const npub = useMemo(() => {
    if (!nostrPubkey) return null
    try {
      return crypto.encodeNpub(nostrPubkey)
    } catch {
      return null
    }
  }, [nostrPubkey, crypto])

  // Display-only formatting: keep the "npub1" prefix, then 4-char groups
  // (nostr-tab spec). Chunks alternate color; copy/share use the raw npub.
  const displayNpub = useMemo(() => {
    if (!npub) return null
    if (npub.length <= 5) return [npub]
    const groups = npub.slice(5).match(/.{1,4}/g) ?? []
    return [npub.slice(0, 5), ...groups]
  }, [npub])

  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const registry = useServiceRegistry()
  const addToast = useAppStore((s) => s.addToast)
  const [mintPickerOpen, setMintPickerOpen] = useState(false)
  const [mintRefreshKey, setMintRefreshKey] = useState(0)
  // ponytail: sheet opens in-place over this page (MainApp's old onChangeUsername
  // navigation swapped the whole screen, so the sheet appeared on a blank page).
  const [usernameSheetOpen, setUsernameSheetOpen] = useState(false)
  // Remount per open: input inits from the (possibly changed) current address.
  const [usernameSheetOpenCount, setUsernameSheetOpenCount] = useState(0)

  const reduceMotion = useReducedMotion()

  // Cache-first, revalidate on every entry; cached alias fills in while the
  // store's address is missing.
  const { deposit, cache } = useDepositMint(mintRefreshKey, onSaveSettings)
  const displayAddress = lightningAddress ?? (cache?.alias ?? null)
  const mintUrl = cache?.mintUrl ?? (deposit.status === 'ready' ? deposit.mintUrl : null)
  const depositMintUrls = useMemo(() => (mintUrl ? [mintUrl] : []), [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(depositMintUrls)

  // Lightning addresses can't be created while the settings flow is gated, so
  // the tab announces itself as coming soon rather than offering a dead CTA.
  // It stays selectable — half a two-segment control is not a control.
  const lightningComingSoon = tab === 'lightning' && !ENABLE_LIGHTNING_ADDRESS_SETTINGS
  const value = lightningComingSoon ? null : tab === 'lightning' ? displayAddress : npub

  // npub → lightning address registration: the npubcash server already has an
  // alias for this pubkey, so this is just a lookup + persist. The NUT-12
  // (kind 10019) publish is NOT needed here — it is republished on onboarding
  // and whenever mints/relays change (use-mint-handlers).
  const [isRegistering, setIsRegistering] = useState(false)
  const handleRegister = useCallback(async () => {
    if (!ENABLE_LIGHTNING_ADDRESS_SETTINGS || !nostrPrivkey) return
    setIsRegistering(true)
    try {
      const result = await registry.paymentAlias.getCurrentAlias(nostrPrivkey)
      if (result.ok) {
        await onSaveSettings?.({
          lightningAddress: `${result.value.alias}@${NPUBCASH_DOMAIN}`,
          npubcashUrl: NPUBCASH_URL,
        })
        addToast({ type: 'success', message: t('settings.lightningAddressRegistered') })
        setMintRefreshKey((k) => k + 1)
      } else {
        addToast({ type: 'error', message: t('settings.lightningAddressRegistrationFailed') })
      }
    } catch {
      addToast({ type: 'error', message: t('settings.lightningAddressRegistrationFailed') })
    } finally {
      setIsRegistering(false)
    }
  }, [nostrPrivkey, registry, onSaveSettings, addToast, t])

  const handleCopy = useCallback(() => copy(value ?? ''), [value, copy])
  const handleShare = useCallback(() => share(value ?? ''), [value, share])

  const handleChangeMint = useCallback(async (mintUrl: string) => {
    if (!nostrPrivkey) return
    const result = await registry.paymentAlias.setMint(nostrPrivkey, mintUrl)
    if (result.ok) {
      addToast({ type: 'success', message: t('settings.mintChanged') })
      setMintRefreshKey((k) => k + 1)
    } else {
      addToast({ type: 'error', message: t('settings.mintChangeFailed') })
    }
  }, [nostrPrivkey, registry, addToast, t])

  return (
    <div className="h-full bg-background text-foreground flex flex-col pt-safe">
      <ScreenHeader title={t('myAddress.title')} onBack={onBack} />

      <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-4 pb-app">
        {/* Ticket card (no underlay/shadow behind it) */}
        <div className="relative w-full max-w-[360px]">
          <div className="relative rounded-[12px] border-2 border-brand-200 bg-background-card">
            {/* Underline tabs */}
            <div role="tablist" className="flex px-6 pt-2">
              {TABS.map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    hapticTap()
                    setTab(key)
                  }}
                  className={`flex-1 border-b-2 pb-2 pt-3 text-label transition-colors ${
                    tab === key
                      ? 'border-neutral-700 font-medium text-foreground'
                      : 'border-transparent text-foreground-muted'
                  }`}
                >
                  {t(`myAddress.${key}Tab`)}
                </button>
              ))}
            </div>

            <div className="px-6 pb-6">
              {/* QR (or the gated / no-address state) — bare flat QR filling the
                  card width (panel's ~26px gutters each side), pulled up almost
                  to the active tab's underline. */}
              <div className="flex justify-center pt-1 pb-6">
                {value ? (
                  <button
                    type="button"
                    aria-label={t('common.copy')}
                    onClick={handleCopy}
                    className="w-full cursor-pointer active:scale-95 motion-reduce:active:scale-100 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
                  >
                    <QRCodeDisplay value={value} fill />
                  </button>
                ) : tab === 'lightning' && !lightningComingSoon && deposit.status === 'loading' ? (
                  <div className="flex min-h-60 flex-col items-center justify-center gap-4" aria-hidden>
                    <span className={`h-44 w-44 rounded-2xl bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`} />
                    <span className={`h-3 w-36 rounded-md bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`} />
                  </div>
                ) : (
                  <div className="flex min-h-60 flex-col items-center justify-center gap-4">
                    <p className="text-body text-foreground-muted">
                      {lightningComingSoon ? t('myAddress.comingSoon') : t('myAddress.noAddress')}
                    </p>
                    {!lightningComingSoon && (
                      <Button
                        variant="secondary"
                        size="md"
                        loading={isRegistering}
                        onClick={() => { hapticTap(); handleRegister() }}
                      >
                        {t('myAddress.createAddress')}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Perforated tear line with punched notches — -mx-[26px] extends
                  the wrapper to the card's border-box (panel padding 24px + the
                  2px border), so notches positioned at left-0/right-0 cover the
                  card border exactly; 10 dashes centered per spec (14px dash,
                  14px gap). */}
              <div className="relative -mx-[26px] mt-1 mb-0" aria-hidden>
                <div className="mx-auto flex w-[266px] max-w-full justify-center gap-3.5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <span key={i} className="h-[3px] w-3.5 shrink-0 bg-neutral-300" />
                  ))}
                </div>
                {/* Punch holes — subtract look: one composite element per notch.
                    A bg-background half-disk whose own 2px border traces the arc,
                    so the card outline reads as one continuous path around the
                    hole (matching the Figma subtract) — no clipped seams. */}
                <span className="absolute left-0 -top-[18px] h-10 w-5 rounded-r-[20px] border-2 border-l-0 border-brand-200 bg-background" />
                <span className="absolute right-0 -top-[18px] h-10 w-5 rounded-l-[20px] border-2 border-r-0 border-brand-200 bg-background" />
              </div>

              {/* Address info below the tear line */}
              {tab === 'lightning' ? (
                lightningComingSoon ? null : !displayAddress ? null : (
                  <>
                    {/* Address row — label above, address + edit button on one
                        line, 4px below the punch notches (3px dashes + 23px). */}
                    <div className="mt-[23px]">
                      <p className="text-label text-foreground-muted">{t('myAddress.addressLabel')}</p>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <p className="min-w-0 break-all text-subtitle font-extrabold">{displayAddress}</p>
                        <button
                          type="button"
                          onClick={() => { hapticTap(); setUsernameSheetOpen(true); setUsernameSheetOpenCount((c) => c + 1) }}
                          className="flex h-[26px] w-[50px] shrink-0 items-center justify-center gap-1 rounded-[7px] border border-neutral-300 bg-background-card text-[9px] text-foreground active:scale-95 motion-reduce:active:scale-100 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        >
                          <Pencil className="h-3 w-3" />
                          {t('common.edit')}
                        </button>
                      </div>
                    </div>

                    {/* Deposit-mint row — the decisive "where does this land?" line.
                        Changing the mint is a rare, deliberate action; the change
                        affordance lives next to the mint name. */}
                    <div className="mt-5">
                      <p className="text-label text-foreground-muted">{t('myAddress.receiveMint')}</p>
                      {mintUrl ? (
                        <div className="mt-2 flex items-center gap-2">
                          <MintIcon
                            circle
                            iconUrl={getIconUrl(mintUrl)}
                            imgSize="w-4 h-4"
                            className="h-5 w-5 bg-neutral-200"
                          />
                          <span className="text-caption font-medium">{getDisplayName(mintUrl)}</span>
                          <button
                            type="button"
                            onClick={() => { hapticTap(); setMintPickerOpen(true) }}
                            className="text-caption text-foreground-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          >
                            {t('common.change')}
                          </button>
                        </div>
                      ) : deposit.status === 'loading' ? (
                        <div className="mt-2 flex items-center gap-2" role="status" aria-label={t('common.loading')}>
                          <span className={`h-5 w-5 shrink-0 rounded-full bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`} />
                          <span className={`h-4 w-28 rounded-md bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`} />
                        </div>
                      ) : (
                        <p className="mt-2 text-caption text-foreground-muted">{t('myAddress.depositsToFallback')}</p>
                      )}
                    </div>
                  </>
                )
              ) : (
                <div className="mt-[23px] min-w-0">
                  <p className="text-label text-foreground-muted">{t('myAddress.npubLabel')}</p>
                  {/* 4-char chunks, alternating colors (spec green #34AA4D) */}
                  <p className="mt-1 text-justify text-[16px] leading-[19px] font-extrabold">
                    {displayNpub?.map((chunk, i) => (
                      <span key={i} className={i % 2 === 1 ? 'text-[#34AA4D]' : 'text-neutral-700'}>
                        {i > 0 ? ' ' : ''}{chunk}
                      </span>
                    ))}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Zappi-only / sender-chosen mint notice — separate, below the ticket */}
        {tab === 'nostr' && value && (
          <div className="mt-5 flex w-full max-w-[360px] items-start gap-2 px-1">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" strokeWidth={1.5} />
            <p className="text-[11px] leading-[17px] text-foreground-muted">{t('myAddress.nostrNotice')}</p>
          </div>
        )}

        {/* Copy left, share right — the app-wide order for this pair. */}
        {value && (
          <div className="mt-5 flex justify-center gap-8">
            <button
              onClick={handleCopy}
              className="flex min-h-9 items-center gap-1.5 rounded-[7px] border border-neutral-200 bg-background-card px-4 text-label font-medium text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {isCopied() ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
              {isCopied() ? t('common.copied') : t('common.copy')}
            </button>
            <button
              onClick={handleShare}
              className="flex min-h-9 items-center gap-1.5 rounded-[7px] border border-neutral-200 bg-background-card px-4 text-label font-medium text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {isShared() ? <Check className="h-3.5 w-3.5 text-brand" /> : <Share2 className="h-3.5 w-3.5" />}
              {isShared() ? t('common.copied') : t('receive.qr.share')}
            </button>
          </div>
        )}
      </div>

      {/* Deposit-mint picker (npubcash preferred mint) */}
      <MintSelectBottomSheet
        isOpen={mintPickerOpen}
        onClose={() => setMintPickerOpen(false)}
        onSelect={handleChangeMint}
        selectedMintUrl={mintUrl}
        allowEmpty
      />

      {/* Username-change sheet in-place over this page (onSaveSettings is
          always provided by MainApp; guarded for the prop's optionality). */}
      {onSaveSettings && (
        <ChangeUsernameSheet
          key={usernameSheetOpenCount}
          isOpen={usernameSheetOpen}
          onClose={() => setUsernameSheetOpen(false)}
          onSaveSettings={onSaveSettings}
        />
      )}
    </div>
  )
}

export default MyAddressScreen
