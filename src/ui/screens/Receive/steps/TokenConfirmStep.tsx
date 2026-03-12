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
import { useTranslation } from 'react-i18next'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats } from '@/utils/format'
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
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header */}
      <header className="relative flex items-center px-4 py-3">
        <button
          onClick={onBack}
          disabled={isReceiving}
          aria-label={t('common.back')}
          className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10 disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-lg font-semibold pointer-events-none">
          {t('receive.token.title')}
        </h1>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col px-6">
        {/* Main message — left-aligned, top area */}
        <div className="pt-16">
          <p className="text-[24px] font-medium leading-snug whitespace-pre-line">
            {t('receive.token.canReceive', { amount: formattedAmount, mint: mintName })}
          </p>
        </div>

        {/* Offline banners */}
        {offlineState === 'ok' && (
          <div className="mt-6 flex items-start gap-2 bg-blue-50 rounded-xl p-4">
            <ShieldCheck className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-sm text-blue-700">{t('receive.offline.p2pkAccepted')}</p>
          </div>
        )}
        {offlineState === 'dleq-missing' && (
          <div className="mt-6 flex items-start gap-2 bg-amber-50 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700">{t('receive.offline.dleqMissing')}</p>
          </div>
        )}
        {offlineState === 'dleq-failed' && (
          <div className="mt-6 flex items-start gap-2 bg-red-50 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{t('receive.offline.dleqFailed')}</p>
          </div>
        )}
        {offlineState === 'no-p2pk' && (
          <div className="mt-6 flex items-start gap-2 bg-gray-100 rounded-xl p-4">
            <WifiOff className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">{t('receive.offline.nonP2PKError')}</p>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Detail rows */}
        <div className="space-y-4 mb-4 px-1">
          {/* Mint row — tappable (disabled offline) */}
          <button
            onClick={() => {
              hapticTap()
              setShowMintSelect(true)
            }}
            disabled={isReceiving || isSwapDisabled}
            className="w-full flex items-center justify-between min-h-[44px] -mx-1 px-1 rounded-lg hover:bg-black/5 active:bg-black/5 transition-colors disabled:opacity-50"
          >
            <span className="text-[15px] text-foreground-muted">{t('receive.token.receiveMint')}</span>
            <span className="flex items-center gap-0.5">
              <span className="text-[15px] font-semibold truncate max-w-[180px]">{mintName}</span>
              {!isSwapDisabled && <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />}
            </span>
          </button>

          <div className={`flex items-center justify-between ${!isSwapDisabled ? 'pr-[18px]' : ''}`}>
            <span className="text-[15px] text-foreground-muted">{t('receive.token.amount')}</span>
            <span className="text-[15px] font-semibold">{formattedAmount}</span>
          </div>
          {token.memo && (
            <div className={`flex items-center justify-between ${!isSwapDisabled ? 'pr-[18px]' : ''}`}>
              <span className="text-[15px] text-foreground-muted">{t('common.memo')}</span>
              <span className="text-[15px] font-semibold truncate max-w-[200px]">{token.memo}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={handleReceive}
          loading={isReceiving}
          disabled={isReceiveDisabled}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
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
