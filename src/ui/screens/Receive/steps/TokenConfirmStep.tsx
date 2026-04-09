/**
 * TokenConfirmStep — Confirm receiving a token from a trusted mint
 *
 * Two layouts:
 * 1. Same-mint: simple confirm with single "받기" button + mint change option
 * 2. Cross-mint: two-card choice (receive at token mint vs swap to active mint)
 *
 * Offline support:
 * - Online: normal receive (same mint or cross-mint swap)
 * - Offline + P2PK + DLEQ valid: "오프라인 수령" with info banner
 * - Offline + P2PK + DLEQ missing: warning banner, allow with user consent
 * - Offline + DLEQ failed: button disabled, rejection banner
 * - Offline + non-P2PK: button disabled, "온라인 필요" banner
 * - Offline: mint change (swap) disabled
 */

import { useState, useCallback, useMemo, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight, WifiOff, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { MintSelectBottomSheet } from '@/ui/components/payment'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import type { ValidatedCashuToken } from '@/core/domain/input-types'
import type { InputInspectionResult } from '@/core/ports/driving/payment.usecase'

// Offline state banner config
const OFFLINE_BANNERS: Record<string, { icon: ReactNode; bg: string; textColor: string; key: string }> = {
  ok: { icon: <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />, bg: 'bg-blue-50', textColor: 'text-blue-700', key: 'receive.offline.p2pkAccepted' },
  'dleq-missing': { icon: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />, bg: 'bg-amber-50', textColor: 'text-amber-700', key: 'receive.offline.dleqMissing' },
  'dleq-failed': { icon: <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />, bg: 'bg-red-50', textColor: 'text-red-700', key: 'receive.offline.dleqFailed' },
  'no-p2pk': { icon: <WifiOff className="w-4 h-4 text-foreground-muted shrink-0 mt-0.5" />, bg: 'bg-muted', textColor: 'text-foreground', key: 'receive.offline.nonP2PKError' },
}

interface TokenConfirmStepProps {
  onBack: () => void
  onReceive: (mintUrl?: string) => Promise<void>
  token: ValidatedCashuToken
  isOnline: boolean
  inspection: InputInspectionResult | null
  /** The mint the user was on when they initiated receive */
  initialMintUrl?: string | null
}

export function TokenConfirmStep({
  onBack,
  onReceive,
  token,
  isOnline,
  inspection,
  initialMintUrl,
}: TokenConfirmStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const [isReceiving, setIsReceiving] = useState(false)
  const [swapLoading, setSwapLoading] = useState(false)
  const [showMintSelect, setShowMintSelect] = useState(false)
  const [selectedMintUrl, setSelectedMintUrl] = useState(token.mintUrl)

  const isCrossMint = !!initialMintUrl && initialMintUrl !== token.mintUrl
  const isProcessing = isReceiving || swapLoading

  const allMintUrls = useMemo(
    () => [...new Set([token.mintUrl, ...settings.mints])],
    [token.mintUrl, settings.mints],
  )
  const { getDisplayName, getIconUrl } = useMintMetadata(allMintUrls)
  const tokenMintName = getDisplayName(token.mintUrl)
  const activeMintName = initialMintUrl ? getDisplayName(initialMintUrl) : ''
  const mintName = getDisplayName(selectedMintUrl)
  const tokenMintIconUrl = getIconUrl(token.mintUrl)
  const activeMintIconUrl = initialMintUrl ? getIconUrl(initialMintUrl) : undefined
  const formattedAmount = formatSats(token.amountSats)

  // Determine offline receive eligibility from inspection result
  const offlineState = useMemo(() => {
    if (isOnline) return null
    if (!inspection || inspection.lockStatus !== 'locked-to-recipient') return 'no-p2pk' as const
    if (inspection.proofIntegrity === 'invalid') return 'dleq-failed' as const
    if (inspection.proofIntegrity === 'unverifiable') return 'dleq-missing' as const
    return 'ok' as const
  }, [isOnline, inspection])

  const isReceiveDisabled = offlineState === 'no-p2pk' || offlineState === 'dleq-failed'
  const isSwapDisabled = !isOnline

  // Same-mint: receive directly
  const handleReceive = useCallback(async () => {
    setIsReceiving(true)
    hapticTap()
    try {
      await onReceive(selectedMintUrl)
    } finally {
      setIsReceiving(false)
    }
  }, [onReceive, selectedMintUrl])

  // Cross-mint: receive at token's original mint (no swap)
  const handleReceiveDirect = useCallback(async () => {
    setIsReceiving(true)
    hapticTap()
    try {
      await onReceive()
    } finally {
      setIsReceiving(false)
    }
  }, [onReceive])

  // Cross-mint: swap to active mint
  const handleReceiveViaSwap = useCallback(async () => {
    if (!initialMintUrl) return
    setSwapLoading(true)
    hapticTap()
    try {
      await onReceive(initialMintUrl)
    } finally {
      setSwapLoading(false)
    }
  }, [onReceive, initialMintUrl])

  const handleMintSelect = useCallback((mintUrl: string) => {
    setSelectedMintUrl(mintUrl)
    setShowMintSelect(false)
  }, [])

  const banner = offlineState ? OFFLINE_BANNERS[offlineState] : null

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          disabled={isProcessing}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10 disabled:opacity-50"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">
          {t('receive.token.title')}
        </h1>
        <div className="w-10" />
      </header>

      {isCrossMint ? (
        /* ============= Cross-mint: two-card choice ============= */
        <>
          <div className="flex-1 flex flex-col items-center justify-center px-8">
            <p className="text-heading font-semibold text-center whitespace-pre-line">
              {t('receive.token.crossMintQuestion', { amount: formattedAmount })}
            </p>
            {formatFiat(token.amountSats) && (
              <p className="text-body text-foreground-muted mt-3">{formatFiat(token.amountSats)}</p>
            )}

            {/* Origin card */}
            <div className="flex items-center gap-2.5 bg-white border border-border/50 rounded-[14px] px-4 py-3 mt-5 max-w-[280px] shadow-sm">
              <MintIcon iconUrl={tokenMintIconUrl} className="w-9 h-9 rounded-[10px] bg-brand/10" />
              <p className="text-caption text-foreground-muted leading-snug">
                <span className="font-semibold text-foreground">{tokenMintName}</span>
                {t('receive.token.tokenFromSuffix')}
              </p>
            </div>

            {/* Offline banner */}
            {!isOnline && (
              <div className="mt-4 flex items-center gap-2 bg-muted rounded-xl p-3 max-w-[300px]">
                <WifiOff className="w-4 h-4 text-foreground-muted shrink-0" />
                <p className="text-caption text-foreground">{t('receive.offline.nonP2PKError')}</p>
              </div>
            )}
          </div>

          <div className="px-5 pb-6 pb-safe shrink-0 space-y-2.5">
            {/* Receive at token mint (primary) */}
            <button
              onClick={handleReceiveDirect}
              disabled={isProcessing || isReceiveDisabled}
              className="w-full bg-brand rounded-[14px] px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform disabled:opacity-50 shadow-lg shadow-brand/25"
            >
              {isReceiving ? (
                <div className="w-10 h-10 rounded-[10px] bg-white/20 flex items-center justify-center shrink-0">
                  <Loader2 className="w-5 h-5 animate-spin text-white" />
                </div>
              ) : (
                <MintIcon iconUrl={tokenMintIconUrl} className="w-10 h-10 rounded-[10px] bg-white/20" />
              )}
              <div className="flex-1 min-w-0 text-left">
                <p className="text-body font-bold text-white truncate">
                  {t('receive.token.receiveDirectly', { mint: tokenMintName })}
                </p>
                <p className="text-caption text-white/70 mt-0.5">
                  {t('receive.token.receiveDirectlySub')}
                </p>
              </div>
            </button>

            {/* Swap to active mint (secondary) */}
            <button
              onClick={handleReceiveViaSwap}
              disabled={isProcessing || isSwapDisabled}
              className="w-full bg-muted rounded-[14px] px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {swapLoading ? (
                <div className="w-10 h-10 rounded-[10px] bg-foreground/[0.06] flex items-center justify-center shrink-0">
                  <Loader2 className="w-5 h-5 animate-spin text-foreground" />
                </div>
              ) : (
                <MintIcon iconUrl={activeMintIconUrl} className="w-10 h-10 rounded-[10px] bg-foreground/[0.06]" />
              )}
              <div className="flex-1 min-w-0 text-left">
                <p className="text-body font-bold text-foreground truncate">
                  {t('receive.token.receiveViaSwap', { mint: activeMintName })}
                </p>
                <p className="text-caption text-foreground-muted mt-0.5">
                  {t('receive.token.receiveViaSwapSub')}
                </p>
              </div>
            </button>
          </div>
        </>
      ) : (
        /* ============= Same-mint: existing single-button layout ============= */
        <>
          <div className="flex-1 flex flex-col items-center justify-center px-8">
            <div className="text-center">
              <p className="text-heading font-semibold whitespace-pre-line">
                <Trans
                  i18nKey="receive.token.fullConfirmQuestion"
                  values={{ mint: mintName, amount: formattedAmount }}
                  components={{ b: <span className="text-brand" /> }}
                />
              </p>
            </div>

            {formatFiat(token.amountSats) && (
              <p className="text-body text-foreground-muted mt-3">{formatFiat(token.amountSats)}</p>
            )}

            {/* Offline banner */}
            {banner && (
              <div className={`mt-4 flex items-start gap-2 ${banner.bg} rounded-xl p-3 max-w-[300px]`}>
                {banner.icon}
                <p className={`text-caption ${banner.textColor}`}>{t(banner.key)}</p>
              </div>
            )}
          </div>

          <div className="px-6 pb-6 pb-safe shrink-0">
            <div className="mb-4">
              {/* Mint row — tappable */}
              <button
                onClick={() => { hapticTap(); setShowMintSelect(true) }}
                disabled={isProcessing || isSwapDisabled}
                className="w-full flex items-center justify-between py-2.5 border-b border-border/50 disabled:opacity-50"
              >
                <span className="text-body text-foreground-muted">{t('receive.token.receiveMint')}</span>
                <span className="flex items-center gap-0.5">
                  <span className="text-body font-medium text-foreground truncate max-w-[180px]">{mintName}</span>
                  {!isSwapDisabled && <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />}
                </span>
              </button>
              {token.memo && (
                <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                  <span className="text-body text-foreground-muted">{t('common.memo')}</span>
                  <span className="text-body font-medium text-foreground truncate max-w-[200px]">{token.memo}</span>
                </div>
              )}
            </div>
            <Button
              variant="brand"
              size="xl"
              onClick={handleReceive}
              loading={isReceiving}
              disabled={isReceiveDisabled}
              className="w-full"
            >
              {!isOnline && offlineState === 'ok'
                ? t('receive.offline.receiveOffline')
                : !isOnline && offlineState === 'dleq-missing'
                  ? t('receive.offline.acceptAnyway')
                  : t('receive.token.receive')}
            </Button>
          </div>

          {/* Mint Select Bottom Sheet */}
          <MintSelectBottomSheet
            isOpen={showMintSelect}
            onClose={() => setShowMintSelect(false)}
            onSelect={handleMintSelect}
            selectedMintUrl={selectedMintUrl}
            allowEmpty
          />
        </>
      )}
    </div>
  )
}
