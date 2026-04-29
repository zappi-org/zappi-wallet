import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { useFormatFiat, useFormatSats } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticError } from '@/ui/utils/haptic'
import { translateError } from '@/ui/utils/error-i18n'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRightLeft, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { ValidatedCashuToken } from '@/core/domain/input-types'

export interface ConfirmUntrustedStepProps {
  token: ValidatedCashuToken
  onBack: () => void
  onAddAndReceive: () => Promise<void>
  /** Undefined when user has no configured target mint. */
  onSwapToMyMint?: () => Promise<void>
}

export function ConfirmUntrustedStep({
  token,
  onBack,
  onAddAndReceive,
  onSwapToMyMint,
}: ConfirmUntrustedStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const addToast = useAppStore((s) => s.addToast)

  const mintUrl = token.mintUrl
  const amount = token.amountSats

  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const mintName = getDisplayName(mintUrl)
  const mintIconUrl = getIconUrl(mintUrl)

  const fiatLabel = formatFiat(amount)

  const [busy, setBusy] = useState<'add' | 'swap' | null>(null)

  const runAsync = useCallback(
    async (kind: 'add' | 'swap', action: () => Promise<void>) => {
      if (busy) return
      setBusy(kind)
      try {
        await action()
      } catch (error) {
        hapticError()
        addToast({ type: 'error', message: translateError(error, t) })
      } finally {
        setBusy(null)
      }
    },
    [busy, addToast, t],
  )

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.untrusted.title')} onBack={onBack} />

      {/* Content — centered warning */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-4">
        <AlertTriangle className="w-12 h-12 text-accent-warning" strokeWidth={1.8} />

        <p className="text-heading font-semibold text-foreground text-center whitespace-pre-line">
          {t('send.untrusted.warningNeedConfirm', { amount: formatSats(amount) })}
        </p>
        {fiatLabel && <p className="text-body text-foreground-muted">~ {fiatLabel}</p>}

        {/* Origin card */}
        <div className="flex items-center gap-2.5 bg-white border border-border/50 rounded-card px-4 py-3 max-w-[280px] shadow-sm">
          <MintIcon
            iconUrl={mintIconUrl}
            imgSize="w-6 h-6"
            className="w-9 h-9 rounded-[10px] bg-accent-warning/10"
          />
          <p className="text-caption text-foreground-muted leading-snug">
            <span className="font-semibold text-foreground">{mintName}</span>
            {' · '}
            <span className="text-accent-warning font-medium">{t('send.untrusted.unregistered')}</span>
          </p>
        </div>

        {onSwapToMyMint && (
          <p className="text-caption text-foreground-muted text-center leading-relaxed max-w-[280px] whitespace-pre-line">
            {t('tokenRegister.unknownMintHint')}
          </p>
        )}
      </div>

      {/* Vertical choice cards */}
      <div className="px-5 pb-6 pb-safe shrink-0 space-y-2.5">
        <button
          onClick={() => runAsync('add', onAddAndReceive)}
          disabled={busy !== null}
          className="w-full bg-brand rounded-card px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform shadow-lg shadow-brand/25 disabled:opacity-60"
        >
          <div className="w-10 h-10 rounded-[10px] bg-white/20 flex items-center justify-center shrink-0">
            <Plus className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-body font-bold text-white truncate">
              {busy === 'add' ? t('tokenRegister.receiving') : t('send.untrusted.addAndReceive')}
            </p>
            <p className="text-caption text-white/70 mt-0.5">
              {t('send.untrusted.addAndReceiveSub')}
            </p>
          </div>
        </button>

        {onSwapToMyMint && (
          <button
            onClick={() => runAsync('swap', onSwapToMyMint)}
            disabled={busy !== null}
            className="w-full bg-muted rounded-card px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            <div className="w-10 h-10 rounded-[10px] bg-foreground/[0.06] flex items-center justify-center shrink-0">
              <ArrowRightLeft className="w-5 h-5 text-foreground" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-body font-bold text-foreground truncate">
                {busy === 'swap' ? t('tokenRegister.swapping') : t('tokenRegister.receiveToMyMint')}
              </p>
              <p className="text-caption text-foreground-muted mt-0.5">
                {t('tokenRegister.swapFeeHint')}
              </p>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}
