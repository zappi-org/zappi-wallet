/**
 * UntrustedMintStep — Warning for tokens from unknown mints
 *
 * Unknown mint tokens can only be accepted by explicitly adding the mint.
 * Reject remains available offline because it does not touch the token.
 */

import { useState, useCallback, useMemo } from 'react'
import { ArrowLeft, AlertTriangle, Loader2, WifiOff, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { MintIcon } from '@/ui/components/common/MintIcon'
import type { ValidatedCashuToken } from '@/core/domain/input-types'

interface UntrustedMintStepProps {
  onBack: () => void | Promise<void>
  onReject: () => void | Promise<void>
  onAddAndReceive: () => Promise<void>
  token: ValidatedCashuToken
  isOnline: boolean
}

export function UntrustedMintStep({
  onBack,
  onReject,
  onAddAndReceive,
  token,
  isOnline,
}: UntrustedMintStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const [addLoading, setAddLoading] = useState(false)
  const [rejectLoading, setRejectLoading] = useState(false)
  const isProcessing = addLoading || rejectLoading

  const allMintUrls = useMemo(
    () => [...new Set([token.mintUrl, ...settings.mints])],
    [token.mintUrl, settings.mints],
  )
  const { getDisplayName, getIconUrl } = useMintMetadata(allMintUrls)
  const mintName = getDisplayName(token.mintUrl)
  const mintIconUrl = getIconUrl(token.mintUrl)
  const formattedAmount = formatSats(token.amountSats)

  const addButtonDisabled = isProcessing || !isOnline

  const handleAddAndReceive = useCallback(async () => {
    setAddLoading(true)
    hapticTap()
    try {
      await onAddAndReceive()
    } finally {
      setAddLoading(false)
    }
  }, [onAddAndReceive])

  const handleReject = useCallback(async () => {
    setRejectLoading(true)
    hapticTap()
    try {
      await onReject()
    } finally {
      setRejectLoading(false)
    }
  }, [onReject])

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
          {t('receive.untrusted.title')}
        </h1>
        <div className="w-10" />
      </header>

      {/* Content — centered warning */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-4">
        <AlertTriangle className="w-12 h-12 text-accent-warning" />

        <p className="text-heading font-semibold text-center whitespace-pre-line">
          {t('receive.untrusted.warningNeedConfirm', { amount: formattedAmount })}
        </p>
        {(() => { const f = formatFiat(token.amountSats); return f ? (
          <p className="text-body text-foreground-muted">{f}</p>
        ) : null })()}

        {/* Origin card */}
        <div className="flex items-center gap-2.5 bg-white border border-border/50 rounded-[14px] px-4 py-3 max-w-[280px] shadow-sm">
          <MintIcon iconUrl={mintIconUrl} className="w-9 h-9 rounded-[10px] bg-accent-warning/10" />
          <p className="text-caption text-foreground-muted leading-snug">
            <span className="font-semibold text-foreground">{mintName}</span>
            {' · '}
            <span className="text-accent-warning font-medium">{t('receive.untrusted.unregistered')}</span>
          </p>
        </div>

        <p className="text-caption text-foreground-muted text-center leading-relaxed whitespace-pre-line max-w-[280px]">
          {t('receive.untrusted.explanation')}
        </p>

        {/* Offline banner */}
        {!isOnline && (
          <div className="flex items-center gap-2 bg-muted rounded-xl p-3 max-w-[300px]">
            <WifiOff className="w-4 h-4 text-foreground-muted shrink-0" />
            <p className="text-caption text-foreground">{t('receive.offline.untrustedNeedsOnline')}</p>
          </div>
        )}
      </div>

      {/* Vertical choice cards */}
      <div className="px-5 pb-6 pb-safe shrink-0 space-y-2.5">
        {/* Add mint and receive (primary) */}
        <button
          onClick={handleAddAndReceive}
          disabled={addButtonDisabled}
          className="w-full bg-brand rounded-[14px] px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform disabled:opacity-50 shadow-lg shadow-brand/25"
        >
          <div className="w-10 h-10 rounded-[10px] bg-white/20 flex items-center justify-center shrink-0">
            {addLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-white" />
            ) : (
              <Plus className="w-5 h-5 text-white" strokeWidth={2} />
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-body font-bold text-white truncate">
              {t('receive.untrusted.addAndReceive')}
            </p>
            <p className="text-caption text-white/70 mt-0.5">
              {t('receive.untrusted.addAndReceiveSub')}
            </p>
          </div>
        </button>

        <button
          onClick={handleReject}
          disabled={isProcessing}
          className="w-full bg-background border border-border rounded-[14px] px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          <div className="w-10 h-10 rounded-[10px] bg-foreground/[0.04] flex items-center justify-center shrink-0">
            {rejectLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-foreground" />
            ) : (
              <X className="w-5 h-5 text-foreground" strokeWidth={1.8} />
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-body font-bold text-foreground truncate">
              {t('receive.untrusted.reject')}
            </p>
            <p className="text-caption text-foreground-muted mt-0.5">
              {t('receive.untrusted.rejectSub')}
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}
