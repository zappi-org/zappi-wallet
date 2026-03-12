/**
 * UntrustedMintStep — Warning for tokens from unknown mints
 * Figma layout: left-aligned warning text at top, two side-by-side choice buttons at bottom
 * Design system: matches SendConfirmStep patterns (header, text sizes, padding)
 *
 * Offline: both buttons disabled (swap and addTrustedMint both require online)
 */

import { useState, useCallback, useMemo } from 'react'
import { ArrowLeft, AlertTriangle, Loader2, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats } from '@/utils/format'
import { MintSelectBottomSheet } from '@/ui/components/payment'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import type { ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'

interface UntrustedMintStepProps {
  onBack: () => void
  onAddAndReceive: () => Promise<void>
  onSwapToMyMint: (targetMintUrl: string) => Promise<void>
  token: ValidatedCashuToken
  isOnline: boolean
}

export function UntrustedMintStep({
  onBack,
  onAddAndReceive,
  onSwapToMyMint,
  token,
  isOnline,
}: UntrustedMintStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const [swapLoading, setSwapLoading] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [showMintSelect, setShowMintSelect] = useState(false)
  const isProcessing = swapLoading || addLoading
  const mintUrls = useMemo(() => [token.mintUrl], [token.mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)
  const mintName = getDisplayName(token.mintUrl)
  const formattedAmount = formatSats(token.amountSats)

  const buttonsDisabled = isProcessing || !isOnline

  const handleAddAndReceive = useCallback(async () => {
    setAddLoading(true)
    hapticTap()
    try {
      await onAddAndReceive()
    } finally {
      setAddLoading(false)
    }
  }, [onAddAndReceive])

  const handleSwapSelect = useCallback(async (targetMintUrl: string) => {
    setShowMintSelect(false)
    setSwapLoading(true)
    hapticTap()
    try {
      await onSwapToMyMint(targetMintUrl)
    } finally {
      setSwapLoading(false)
    }
  }, [onSwapToMyMint])

  return (
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header */}
      <header className="relative flex items-center px-4 py-3">
        <button
          onClick={onBack}
          disabled={isProcessing}
          aria-label={t('common.back')}
          className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10 disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-lg font-semibold pointer-events-none">
          {t('receive.untrusted.title')}
        </h1>
      </header>

      {/* Content — centered warning */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-6">
        <AlertTriangle className="w-12 h-12 text-accent-warning" />

        <p className="text-[22px] font-medium leading-relaxed text-center whitespace-pre-line">
          {t('receive.untrusted.warningFrom', { mint: mintName })}
          {'\n'}
          {t('receive.untrusted.warningNeedConfirm', { amount: formattedAmount })}
        </p>

        <p className="text-[15px] text-foreground-muted text-center leading-relaxed whitespace-pre-line">
          {t('receive.untrusted.explanation')}
        </p>

        {/* Offline banner */}
        {!isOnline && (
          <div className="flex items-center gap-2 bg-gray-100 rounded-xl p-4">
            <WifiOff className="w-5 h-5 text-gray-500 shrink-0" />
            <p className="text-sm text-gray-700">{t('receive.offline.untrustedNeedsOnline')}</p>
          </div>
        )}
      </div>

      {/* Two side-by-side choice buttons */}
      <div className="p-5 pb-safe">
        <div className="flex gap-3">
          {/* Left: Swap to my mint (secondary) */}
          <button
            onClick={() => {
              hapticTap()
              setShowMintSelect(true)
            }}
            disabled={buttonsDisabled}
            className="flex-1 bg-[#f0f0f0] rounded-[14px] px-4 py-5 flex flex-col justify-between min-h-[140px] active:scale-[0.97] transition-transform disabled:opacity-50"
          >
            {swapLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-foreground" />
            ) : (
              <p className="text-[18px] font-semibold leading-tight text-left whitespace-pre-line">
                {t('receive.untrusted.myMint')}
              </p>
            )}
            <p className="text-[13px] text-foreground-muted text-left mt-2">
              {t('receive.untrusted.myMintSub')}
            </p>
          </button>

          {/* Right: Add and receive (primary-ish) */}
          <button
            onClick={handleAddAndReceive}
            disabled={buttonsDisabled}
            className="flex-1 bg-[#3b7df5] rounded-[14px] px-4 py-5 flex flex-col justify-between min-h-[140px] active:scale-[0.97] transition-transform disabled:opacity-50 shadow-lg shadow-[#3b7df5]/25"
          >
            {addLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-white" />
            ) : (
              <p className="text-[18px] font-semibold leading-tight text-left text-white whitespace-pre-line">
                {t('receive.untrusted.addAndReceive')}
              </p>
            )}
            <p className="text-[13px] text-white/70 text-left mt-2">
              {t('receive.untrusted.addAndReceiveSub')}
            </p>
          </button>
        </div>
      </div>

      {/* Mint Select for swap */}
      <MintSelectBottomSheet
        isOpen={showMintSelect}
        onClose={() => setShowMintSelect(false)}
        onSelect={handleSwapSelect}
        selectedMintUrl={null}
        buttonLabel={t('receive.untrusted.receiveWithMint')}
        infoText={t('receive.untrusted.feeNote')}
      />
    </div>
  )
}
