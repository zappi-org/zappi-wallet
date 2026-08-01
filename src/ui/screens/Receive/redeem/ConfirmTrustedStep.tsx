import zappiLogo from '@/assets/zappi.webp'
import { toNumber } from '@/core/domain/amount'
import type { ValidatedCashuToken } from '@/core/domain/input-types'
import { useAppStore } from '@/store'
import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { translateError } from '@/ui/utils/error-i18n'
import { hapticError } from '@/ui/utils/haptic'
import { useFormatFiat, useFormatSats } from '@/utils/format'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConfirmTrustedStepProps {
  token: ValidatedCashuToken
  onBack: () => void
  onReceive: (receiveMintUrl: string) => Promise<void>
  onReject: () => void
  onEstimateRedeemFee?: (
    token: string,
  ) => Promise<{ grossAmount: number; fee: number; netAmount: number } | null>
}

/**
 * Memo size — the same length-based shrink, expressed in scale tokens instead
 * of an inline px value, so it still honours the reader's font size.
 */
function memoSizeClassFor(memo: string): string {
  const len = memo.length
  if (len > 20) return 'text-caption'
  if (len > 13) return 'text-body'
  if (len > 9) return 'text-subtitle'
  return 'text-title-sm'
}

export function ConfirmTrustedStep({
  token,
  onBack,
  onReceive,
  onReject,
  onEstimateRedeemFee,
}: ConfirmTrustedStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const addToast = useAppStore((s) => s.addToast)

  const sourceMintUrl = token.mintUrl
  const amount = toNumber(token.amount)
  const memo = token.memo ?? ''

  const mintUrls = useMemo(() => [sourceMintUrl], [sourceMintUrl])
  const { getDisplayName, getIconUrl, getMetadata } = useMintMetadata(mintUrls)
  const sourceMintName = getDisplayName(sourceMintUrl)
  const sourceMintSubName = getMetadata(sourceMintUrl)?.name
  const sourceMintIconUrl = getIconUrl(sourceMintUrl)

  const [fee, setFee] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!onEstimateRedeemFee) return
    let cancelled = false
    onEstimateRedeemFee(token.token)
      .then((estimate) => {
        if (!cancelled && estimate) setFee(estimate.fee)
      })
      .catch(() => {
        /* ignore; UI shows fee as '—' */
      })
    return () => {
      cancelled = true
    }
  }, [token.token, onEstimateRedeemFee])

  const netAmount = fee !== null ? Math.max(0, amount - fee) : amount
  const fiatLabel = formatFiat(amount)
  const memoSizeClass = memo ? memoSizeClassFor(memo) : ''

  const handleReceive = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await onReceive(sourceMintUrl)
    } catch (error) {
      hapticError()
      addToast({ type: 'error', message: translateError(error, t) })
      // Keep busy until the receipt replaces this screen.
      setBusy(false)
    }
  }, [busy, onReceive, sourceMintUrl, addToast, t])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('receive.token.title')} onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 pt-2">
        <h2 className="pt-9 text-heading font-semibold text-foreground text-center">
          {t('receive.redeem.confirmSentence', { amount: formatSats(toNumber(token.amount)) })}
        </h2>

        {/* Hero card — the Figma composition, laid out in flow instead of at
            absolute pixel offsets: at 200% text zoom the old version stacked
            the amount on top of the memo and silently clipped both. */}
        <div className="bg-surface-redeem relative rounded-card p-5 mt-12 min-h-[201px] max-w-[380px] mx-auto overflow-hidden">
          {/* Mint header — token's origin mint (not the receive target) */}
          <div className="flex items-center gap-2">
            <MintIcon
              iconUrl={sourceMintIconUrl}
              imgSize="w-[24px] h-[24px]"
              className="w-[35px] h-[35px] rounded-full bg-white/20"
            />
            <div className="flex flex-col leading-tight">
              <span className="text-subtitle font-semibold text-white">
                {sourceMintName}
              </span>
              {sourceMintSubName && sourceMintSubName !== sourceMintName && (
                <span className="text-caption text-white">
                  {sourceMintSubName}
                </span>
              )}
            </div>
          </div>

          {/* Zappi keeps its Figma proportion (18.7% of the card, 71px floor)
              and now anchors the row instead of a fixed top offset. */}
          <div className="mt-2.5 flex items-end gap-4">
            <img
              src={zappiLogo}
              alt=""
              className="w-[max(71px,18.7%)] aspect-square shrink-0 pointer-events-none"
            />

            <div className={`min-w-0 flex-1 ${memo ? 'text-right' : 'text-center'}`}>
              {memo && (
                <p className={`${memoSizeClass} mb-1.5 text-center font-medium leading-snug text-white line-clamp-2 break-keep`}>
                  {memo}
                </p>
              )}
              <p className="text-amount-lg font-semibold text-white">
                {formatSats(amount)}
              </p>
              {fiatLabel && (
                <p className="text-subtitle text-white">
                  ({fiatLabel})
                </p>
              )}
            </div>

            {/* Mirrors the logo's width so a memo-less amount reads centered on
                the CARD, not on the leftover space — without letting the two
                overlap the way the old absolute layout could. */}
            {!memo && <div className="w-[max(71px,18.7%)] shrink-0" aria-hidden />}
          </div>
        </div>
      </div>

      <BottomActionBar gap="none" className="px-6">
        {/* Detail rows */}
        <div className="mb-4">
          <div className="flex justify-between items-center py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">{t('receive.token.receiveMint')}</span>
            <span className="text-body font-medium text-foreground">{sourceMintName}</span>
          </div>
          {fee !== null && fee > 0 && (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('token.reclaim.summaryFee')}</span>
              <span className="text-body font-medium text-foreground">
                -{formatSats(fee)}
              </span>
            </div>
          )}
          <div className="flex justify-between py-2.5">
            <span className="text-body font-bold text-foreground">{t('receive.token.netAmount')}</span>
            <span className="text-body font-bold text-foreground">
              +{formatSats(netAmount)}
            </span>
          </div>
        </div>

        <Button
          variant="brand"
          size="xl"
          onClick={handleReceive}
          loading={busy}
          disabled={busy}
          className="w-full"
        >
          {busy ? t('tokenRegister.receiving') : t('receive.token.receive')}
        </Button>

        <Button
          variant="ghost"
          size="lg"
          onClick={onReject}
          disabled={busy}
          className="w-full mt-2"
        >
          {t('receive.token.reject')}
        </Button>
      </BottomActionBar>
    </div>
  )
}
