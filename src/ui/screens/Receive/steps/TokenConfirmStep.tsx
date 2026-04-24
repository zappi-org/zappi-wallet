/**
 * TokenConfirmStep — Confirm receiving a token from a configured mint
 *
 * Token receive keeps the decision simple:
 * - Configured mint: receive at the token's original mint, or do not receive
 * - Unconfigured mint decisions are handled by UntrustedMintStep
 *
 * Offline support:
 * - Offline + P2PK + DLEQ valid: "오프라인 수령" with info banner
 * - Offline + P2PK + DLEQ missing: warning banner, allow with user consent
 * - Offline + DLEQ failed: button disabled, rejection banner
 * - Offline + non-P2PK: button disabled, "온라인 필요" banner
 */

import { useState, useCallback, useMemo, type ReactNode } from 'react'
import { ArrowLeft, WifiOff, AlertTriangle, ShieldCheck } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
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
  onReject: () => void | Promise<void>
  onReceive: () => Promise<void>
  token: ValidatedCashuToken
  isOnline: boolean
  inspection: InputInspectionResult | null
}

export function TokenConfirmStep({
  onBack,
  onReject,
  onReceive,
  token,
  isOnline,
  inspection,
}: TokenConfirmStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const [isReceiving, setIsReceiving] = useState(false)
  const [rejectLoading, setRejectLoading] = useState(false)

  const { getDisplayName } = useMintMetadata([token.mintUrl])
  const mintName = getDisplayName(token.mintUrl)
  const formattedAmount = formatSats(token.amountSats)
  const isProcessing = isReceiving || rejectLoading

  // Determine offline receive eligibility from inspection result
  const offlineState = useMemo(() => {
    if (isOnline) return null
    if (!inspection || inspection.lockStatus !== 'locked-to-recipient') return 'no-p2pk' as const
    if (inspection.proofIntegrity === 'invalid') return 'dleq-failed' as const
    if (inspection.proofIntegrity === 'unverifiable') return 'dleq-missing' as const
    return 'ok' as const
  }, [isOnline, inspection])

  const isReceiveDisabled = offlineState === 'no-p2pk' || offlineState === 'dleq-failed'

  const handleReceive = useCallback(async () => {
    setIsReceiving(true)
    hapticTap()
    try {
      await onReceive()
    } finally {
      setIsReceiving(false)
    }
  }, [onReceive])

  const handleReject = useCallback(async () => {
    setRejectLoading(true)
    hapticTap()
    try {
      await onReject()
    } finally {
      setRejectLoading(false)
    }
  }, [onReject])

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

        {banner && (
          <div className={`mt-4 flex items-start gap-2 ${banner.bg} rounded-xl p-3 max-w-[300px]`}>
            {banner.icon}
            <p className={`text-caption ${banner.textColor}`}>{t(banner.key)}</p>
          </div>
        )}

        {token.memo && (
          <div className="mt-5 w-full max-w-[300px] rounded-2xl bg-background-card px-4 py-3">
            <p className="text-overline font-semibold uppercase tracking-wide text-foreground-muted">
              {t('common.memo')}
            </p>
            <p className="mt-1 break-words text-body font-medium text-foreground">
              {token.memo}
            </p>
          </div>
        )}
      </div>

      <div className="px-6 pb-6 pb-safe shrink-0">
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
              : t('receive.token.receiveDirectly', { mint: mintName })}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={handleReject}
          loading={rejectLoading}
          disabled={isProcessing}
          className="w-full mt-2"
        >
          {t('receive.token.reject')}
        </Button>
      </div>
    </div>
  )
}
