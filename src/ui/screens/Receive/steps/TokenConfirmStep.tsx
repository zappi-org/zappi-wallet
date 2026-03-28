/**
 * TokenConfirmStep — Confirm receiving a token from a trusted mint
 * Figma layout: left-aligned message at top, flat detail rows near bottom, CTA at bottom
 * Mint row is tappable with ">" to open MintSelectBottomSheet
 *
 * Offline support:
 * - Online: normal receive (same mint or cross-mint swap)
 * - Offline + P2PK + DLEQ valid: "오프라인 수령" with info banner
 * - Offline + P2PK + DLEQ missing: warning banner, allow with user consent
 * - Offline + DLEQ failed: button disabled, rejection banner
 * - Offline + non-P2PK: button disabled, "온라인 필요" banner
 * - Offline: mint change (swap) disabled
 */

import { useState, useCallback, useMemo } from 'react'
import { ArrowLeft, ChevronRight, WifiOff, AlertTriangle, ShieldCheck } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { MintSelectBottomSheet } from '@/ui/components/payment'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { selectP2pkPubkey } from '@/store/selectors'
import { isP2PKLockedToUser } from '@/utils/token'
import type { ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'
import type { DleqResult } from '@/utils/token'

interface TokenConfirmStepProps {
  onBack: () => void
  onReceive: (mintUrl?: string) => Promise<void>
  token: ValidatedCashuToken
  isOnline: boolean
  dleqStatus: DleqResult | null
}

export function TokenConfirmStep({
  onBack,
  onReceive,
  token,
  isOnline,
  dleqStatus,
}: TokenConfirmStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const p2pkPubkey = useAppStore(selectP2pkPubkey)
  const [isReceiving, setIsReceiving] = useState(false)
  const [showMintSelect, setShowMintSelect] = useState(false)
  const [selectedMintUrl, setSelectedMintUrl] = useState(token.mintUrl)

  const allMintUrls = useMemo(
    () => [...new Set([token.mintUrl, ...settings.mints])],
    [token.mintUrl, settings.mints],
  )
  const { getDisplayName } = useMintMetadata(allMintUrls)
  const mintName = getDisplayName(selectedMintUrl)
  const formattedAmount = formatSats(token.amountSats)

  // Offline P2PK check
  const isP2PK = useMemo(() => {
    return p2pkPubkey ? isP2PKLockedToUser(token.token, p2pkPubkey) : false
  }, [token.token, p2pkPubkey])

  // Determine offline receive eligibility
  const offlineState = useMemo(() => {
    if (isOnline) return null // Online = no restrictions

    if (!isP2PK) return 'no-p2pk' as const
    if (dleqStatus === 'failed') return 'dleq-failed' as const
    if (dleqStatus === 'missing') return 'dleq-missing' as const
    return 'ok' as const // P2PK + DLEQ valid
  }, [isOnline, isP2PK, dleqStatus])

  const isReceiveDisabled = offlineState === 'no-p2pk' || offlineState === 'dleq-failed'
  const isSwapDisabled = !isOnline // Swap requires online

  const handleReceive = useCallback(async () => {
    setIsReceiving(true)
    hapticTap()
    try {
      await onReceive(selectedMintUrl)
    } finally {
      setIsReceiving(false)
    }
  }, [onReceive, selectedMintUrl])

  const handleMintSelect = useCallback((mintUrl: string) => {
    setSelectedMintUrl(mintUrl)
    setShowMintSelect(false)
  }, [])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          disabled={isReceiving}
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

      {/* Centered content — same pattern as confirm screens */}
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

        {/* Offline banners */}
        {offlineState === 'ok' && (
          <div className="mt-4 flex items-start gap-2 bg-blue-50 rounded-xl p-3 max-w-[300px]">
            <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-caption text-blue-700">{t('receive.offline.p2pkAccepted')}</p>
          </div>
        )}
        {offlineState === 'dleq-missing' && (
          <div className="mt-4 flex items-start gap-2 bg-amber-50 rounded-xl p-3 max-w-[300px]">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-caption text-amber-700">{t('receive.offline.dleqMissing')}</p>
          </div>
        )}
        {offlineState === 'dleq-failed' && (
          <div className="mt-4 flex items-start gap-2 bg-red-50 rounded-xl p-3 max-w-[300px]">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-caption text-red-700">{t('receive.offline.dleqFailed')}</p>
          </div>
        )}
        {offlineState === 'no-p2pk' && (
          <div className="mt-4 flex items-start gap-2 bg-muted rounded-xl p-3 max-w-[300px]">
            <WifiOff className="w-4 h-4 text-foreground-muted shrink-0 mt-0.5" />
            <p className="text-caption text-foreground">{t('receive.offline.nonP2PKError')}</p>
          </div>
        )}
      </div>

      {/* Detail rows + button at bottom */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        <div className="mb-4">
          {/* Mint row — tappable */}
          <button
            onClick={() => { hapticTap(); setShowMintSelect(true) }}
            disabled={isReceiving || isSwapDisabled}
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
      />
    </div>
  )
}
