/**
 * UntrustedMintStep — Warning for tokens from unknown mints
 * Options: add & receive, or swap to my mint
 * Modern layout: bg-[#faf9f6], no border-t
 */

import { useState, useCallback, useMemo } from 'react'
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hapticTap } from '@/utils/haptic'
import { formatSats } from '@/utils/format'
import { MintSelectBottomSheet } from '@/ui/components/payment'
import { Button } from '@/ui/components/common/Button'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import type { ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'

interface UntrustedMintStepProps {
  onBack: () => void
  onAddAndReceive: () => Promise<void>
  onSwapToMyMint: (targetMintUrl: string) => Promise<void>
  token: ValidatedCashuToken
}

export function UntrustedMintStep({
  onBack,
  onAddAndReceive,
  onSwapToMyMint,
  token,
}: UntrustedMintStepProps) {
  const { t } = useTranslation()
  const [isProcessing, setIsProcessing] = useState(false)
  const [showMintSelect, setShowMintSelect] = useState(false)
  const mintUrls = useMemo(() => [token.mintUrl], [token.mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)
  const mintName = getDisplayName(token.mintUrl)

  const handleAddAndReceive = useCallback(async () => {
    setIsProcessing(true)
    hapticTap()
    try {
      await onAddAndReceive()
    } finally {
      setIsProcessing(false)
    }
  }, [onAddAndReceive])

  const handleSwapSelect = useCallback(async (targetMintUrl: string) => {
    setShowMintSelect(false)
    setIsProcessing(true)
    hapticTap()
    try {
      await onSwapToMyMint(targetMintUrl)
    } finally {
      setIsProcessing(false)
    }
  }, [onSwapToMyMint])

  return (
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header — no border */}
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          disabled={isProcessing}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{t('receive.untrusted.title')}</h1>
        <div className="w-11" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-5 gap-5">
        {/* Warning icon */}
        <div className="w-16 h-16 rounded-full bg-accent-warning/10 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-accent-warning" />
        </div>

        {/* Amount */}
        <p className="text-3xl font-bold">{formatSats(token.amountSats)}</p>

        {/* Warning text */}
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-foreground">
            {t('receive.untrusted.warning', { mint: mintName })}
          </p>
          <p className="text-sm text-foreground-muted">
            {t('receive.untrusted.question')}
          </p>
        </div>
      </div>

      {/* Bottom Actions — no border */}
      <div className="p-5 pb-safe space-y-3">
        {/* Swap to my mint */}
        <button
          onClick={() => {
            hapticTap()
            setShowMintSelect(true)
          }}
          disabled={isProcessing}
          className="w-full py-3.5 rounded-xl bg-[#f0f0f0] text-foreground font-medium text-sm active:scale-95 transition-transform disabled:opacity-50 min-h-[44px]"
        >
          {t('receive.untrusted.myMint')}
        </button>

        {/* Add and receive */}
        <Button
          variant="primary"
          size="xl"
          onClick={handleAddAndReceive}
          disabled={isProcessing}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('common.processing')}
            </span>
          ) : (
            t('receive.untrusted.addAndReceive')
          )}
        </Button>
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
