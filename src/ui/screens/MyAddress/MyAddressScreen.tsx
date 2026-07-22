/**
 * MyAddressScreen — the profile-owned identity screen. The user's static
 * receive handles (lightning address + nostr npub) with QR, copy, share.
 * Split out of the receive flow so identity (mint-bound / mint-agnostic
 * address) lives apart from per-mint request creation (receive-ia-split).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Share2, ChevronRight } from 'lucide-react'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { DirectionalTabPanel } from '@/ui/components/common/DirectionalTabPanel'
import { SegmentControl } from '@/ui/components/common/SegmentControl'
import { useAppStore } from '@/store'
import { useCrypto } from '@/ui/hooks/use-crypto'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { hapticTap } from '@/ui/utils/haptic'

export interface MyAddressScreenProps {
  onBack: () => void
  onOpenSettings: () => void
}

type AddressTab = 'lightning' | 'nostr'

/**
 * The primary/deposit mint is bound to the username/zappi-link registration,
 * not stored locally, so it is fetched from the username usecase (same UI-layer
 * registry idiom as UsernameChangeScreen). Loading and failure both fall back
 * to the generic caption — no caching (YAGNI).
 */
type DepositMintState =
  | { status: 'loading' }
  | { status: 'ready'; mintUrl: string }
  | { status: 'error' }

function useDepositMint(): DepositMintState {
  const registry = useServiceRegistry()
  const [state, setState] = useState<DepositMintState>({ status: 'loading' })
  useEffect(() => {
    // registry is stable for the app's lifetime (bootstrap sets it once), so
    // this effect runs exactly once — no need to reset to the already-initial
    // 'loading' state here.
    let cancelled = false
    registry.username
      .getDefaults()
      .then((result) => {
        if (cancelled) return
        setState(
          result.ok && result.value.mintUrl
            ? { status: 'ready', mintUrl: result.value.mintUrl }
            : { status: 'error' },
        )
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [registry])
  return state
}

export function MyAddressScreen({ onBack, onOpenSettings }: MyAddressScreenProps) {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)
  const lightningAddress = useAppStore((s) => s.settings.lightningAddress) ?? null
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const crypto = useCrypto()
  const [tab, setTab] = useState<AddressTab>('lightning')
  const [copied, setCopied] = useState(false)

  // npub derived from the stored pubkey (mirrors ReceiveFlow's prior derivation).
  const npub = useMemo(() => {
    if (!nostrPubkey) return null
    try {
      return crypto.encodeNpub(nostrPubkey)
    } catch {
      return null
    }
  }, [nostrPubkey, crypto])

  const value = tab === 'lightning' ? lightningAddress : npub

  const deposit = useDepositMint()
  const depositMintUrls = useMemo(
    () => (deposit.status === 'ready' ? [deposit.mintUrl] : []),
    [deposit],
  )
  const { getDisplayName } = useMintMetadata(depositMintUrls)
  const depositCaption =
    deposit.status === 'ready'
      ? t('myAddress.depositsTo', { mint: getDisplayName(deposit.mintUrl) })
      : t('myAddress.depositsToFallback')

  const handleCopy = useCallback(async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      hapticTap()
      addToast({ type: 'success', message: t('common.copied'), duration: 2000 })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError'), duration: 3000 })
    }
  }, [value, addToast, t])

  const handleShare = useCallback(async () => {
    if (!value) return
    hapticTap()
    try {
      if (navigator.share) await navigator.share({ text: value })
      else await handleCopy()
    } catch {
      /* user cancelled */
    }
  }, [value, handleCopy])

  return (
    <div className="h-full bg-background text-foreground flex flex-col pt-safe">
      <ScreenHeader title={t('myAddress.title')} onBack={onBack} />

      <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-4">
        <SegmentControl
          value={tab}
          onChange={(v) => {
            hapticTap()
            setTab(v)
          }}
          options={[
            { value: 'lightning', label: t('myAddress.lightningTab') },
            { value: 'nostr', label: t('myAddress.nostrTab') },
          ]}
          className="w-full max-w-[360px]"
        />

        <DirectionalTabPanel
          tabKey={tab}
          tabIndex={tab === 'lightning' ? 0 : 1}
          className="w-full flex flex-col items-center"
        >
          {value ? (
            <>
              <button
                type="button"
                aria-label={t('common.copy')}
                onClick={handleCopy}
                className="mt-6 cursor-pointer active:scale-95 motion-reduce:active:scale-100 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
              >
                <QRCodeDisplay value={value} size={200} className="rounded-2xl p-3 shadow-[0_2px_12px_rgba(0,0,0,0.08)]" />
              </button>
              <p className="mt-4 max-w-full break-all px-4 text-center text-body font-medium">{value}</p>
              <div className="flex gap-10 mt-4">
                <button onClick={handleShare} className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all">
                  <Share2 className="w-5 h-5" />
                  {t('receive.qr.share')}
                </button>
                <button onClick={handleCopy} className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all">
                  {copied ? <Check className="w-5 h-5 text-brand" /> : <Copy className="w-5 h-5" />}
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
            </>
          ) : (
            // Lightning tab without a registered address (npub is always derivable).
            <div className="mt-10 flex flex-col items-center gap-4">
              <p className="text-body text-foreground-muted">{t('myAddress.noAddress')}</p>
              <Button variant="secondary" size="md" onClick={() => { hapticTap(); onOpenSettings() }}>
                {t('myAddress.createAddress')}
              </Button>
            </div>
          )}
        </DirectionalTabPanel>

        {/* Deposit-mint caption — the decisive "where does this land?" line for the
            lightning address. Changing the mint is a rare, deliberate action gated
            behind settings, so the whole row is the change affordance. */}
        {tab === 'lightning' && value && (
          <button
            type="button"
            onClick={() => { hapticTap(); onOpenSettings() }}
            className="mt-6 w-full max-w-[360px] flex items-center gap-2 rounded-2xl bg-foreground/[0.04] px-4 py-3 text-left active:bg-foreground/[0.07] transition-colors"
          >
            <span className="flex-1 text-caption text-foreground-muted">{depositCaption}</span>
            <span className="shrink-0 text-caption font-medium text-foreground-muted">{t('myAddress.changeMint')}</span>
            <ChevronRight className="w-4 h-4 shrink-0 text-foreground-muted" />
          </button>
        )}
      </div>
    </div>
  )
}

export default MyAddressScreen
