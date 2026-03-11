/**
 * TokenConfirmStep — Confirm receiving a token from a trusted mint
 * Modern layout: bg-[#faf9f6], flat detail panel, no border-t
 */

import { useState, useCallback } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hapticTap } from '@/utils/haptic'
import { formatSats } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import type { ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'

interface TokenConfirmStepProps {
  onBack: () => void
  onReceive: () => Promise<void>
  token: ValidatedCashuToken
}

function getMintDisplayName(mintUrl: string): string {
  try {
    return new URL(mintUrl).hostname
  } catch {
    return mintUrl
  }
}

export function TokenConfirmStep({
  onBack,
  onReceive,
  token,
}: TokenConfirmStepProps) {
  const { t } = useTranslation()
  const [isReceiving, setIsReceiving] = useState(false)
  const mintName = getMintDisplayName(token.mintUrl)

  const handleReceive = useCallback(async () => {
    setIsReceiving(true)
    hapticTap()
    try {
      await onReceive()
    } finally {
      setIsReceiving(false)
    }
  }, [onReceive])

  return (
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header — no border */}
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          disabled={isReceiving}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{t('receive.token.title')}</h1>
        <div className="w-11" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-5 gap-6">
        {/* Amount */}
        <p className="text-4xl font-bold">{formatSats(token.amountSats)}</p>

        <p className="text-foreground-muted text-center">
          {t('receive.token.canReceive', { mint: mintName })}
        </p>

        {/* Details — flat panel */}
        <div className="w-full max-w-sm bg-[#f0f0f0] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground-muted">{t('receive.token.receiveMint')}</span>
            <span className="font-medium text-sm truncate max-w-[180px]">{mintName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground-muted">{t('receive.token.amount')}</span>
            <span className="font-medium text-sm">{formatSats(token.amountSats)}</span>
          </div>
          {token.memo && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground-muted">{t('common.memo')}</span>
              <span className="font-medium text-sm">{token.memo}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action — no border */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={handleReceive}
          disabled={isReceiving}
          className="w-full !bg-[#3b7df5] !text-white !rounded-lg !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {isReceiving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('payment.receiving')}
            </span>
          ) : (
            t('receive.token.receive')
          )}
        </Button>
      </div>
    </div>
  )
}
