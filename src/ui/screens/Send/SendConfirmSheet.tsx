/**
 * SendConfirmSheet — Bottom-sheet review before sending.
 * Slides up over the amount screen (which stays visible behind a scrim).
 * Reuses the same data as the former full-screen confirm: recipient display,
 * fee, source mint. Handles the recipient send paths and the direct-transfer
 * (bearer token) branch.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { PaymentRoute } from '@/ui/hooks/use-routing'
import type { SendableValidatedData } from './SendFlow'
import { getConfirmDisplayInfo } from './sendDisplayHelpers'
import { getMintBalance } from '@/utils/url'

/** Direct-transfer fee: a resolved amount, still resolving ('pending'), or failed ('unavailable'). */
type FeeQuote = number | 'pending' | 'unavailable'

interface SendConfirmSheetProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  directTransfer?: boolean
  validatedData?: SendableValidatedData | null
  amount: number
  /** Estimated fee; null while the route/fee is still resolving (confirm stays disabled). */
  fee: number | null
  mintUrl: string
  error?: string | null
  route?: PaymentRoute
  displayName?: string
  /** Direct-transfer fee estimate (recipient sends pass a resolved fee instead). */
  onEstimateFee?: (mintUrl: string, amount: number) => Promise<number | null>
  /** Tappable source mint (recipient sends). */
  onChangeMint?: () => void
}

export function SendConfirmSheet({
  open,
  onClose,
  onConfirm,
  directTransfer = false,
  validatedData,
  amount,
  fee,
  mintUrl,
  error,
  route,
  displayName,
  onEstimateFee,
  onChangeMint,
}: SendConfirmSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  // Primitive selector — the sheet stays mounted (open=false) for the whole flow;
  // subscribing to the whole byMint map re-renders it on every wallet refresh.
  const mintBalance = useAppStore((s) => getMintBalance(mintUrl, s.balance.byMint))
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  const mintName = getDisplayName(mintUrl)
  const mintIcon = getIconUrl(mintUrl)

  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  // Direct-transfer branch estimates its own fee; recipient sends pass `fee`.
  const [directFeeQuote, setDirectFeeQuote] = useState<FeeQuote>('pending')
  useEffect(() => {
    if (!open || !directTransfer) {
      setDirectFeeQuote('pending')
      return
    }
    if (!onEstimateFee) {
      setDirectFeeQuote(0)
      return
    }
    if (amount <= 0) {
      setDirectFeeQuote('unavailable')
      return
    }

    let cancelled = false
    setDirectFeeQuote('pending')
    onEstimateFee(mintUrl, amount)
      .then((value) => {
        if (cancelled) return
        setDirectFeeQuote(value === null ? 'unavailable' : Math.max(0, Math.ceil(value)))
      })
      .catch(() => {
        if (!cancelled) setDirectFeeQuote('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [open, directTransfer, onEstimateFee, mintUrl, amount])

  const effectiveFee = directTransfer ? (typeof directFeeQuote === 'number' ? directFeeQuote : null) : fee
  const total = effectiveFee === null ? null : amount + effectiveFee
  const isOverBalance = total !== null && total > mintBalance
  const feeUnavailable = directTransfer && directFeeQuote === 'unavailable'
  const canConfirm = effectiveFee !== null && !isOverBalance

  const recipientName = useMemo(() => {
    if (directTransfer) return t('send.direct.label')
    if (!validatedData) return ''
    return getConfirmDisplayInfo(validatedData, route, t, displayName).recipient
  }, [directTransfer, validatedData, route, t, displayName])

  const title = directTransfer ? t('send.direct.createCta') : t('send.confirm.title')
  const confirmLabel = directTransfer ? t('send.direct.createCta') : t('send.confirm.send')

  const handleConfirm = async () => {
    if (busy || !canConfirm) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    // Composed on the shared BottomSheet (backdrop / slide / dialog-a11y /
    // reduced-motion), configured as an in-flow absolute overlay that slides
    // over the amount screen: spring, no drag, own handle + left-aligned title.
    <BottomSheet
      isOpen={open}
      onClose={onClose}
      variant="absolute"
      backdropZClass="z-40"
      sheetZClass="z-50"
      backdropClassName="bg-black/40"
      backdropOpacity={1}
      backdropTransition={{ duration: 0.18 }}
      sheetClassName="bg-background rounded-t-3xl px-6 pt-3 pb-app"
      transition={{ type: 'spring', damping: 32, stiffness: 320 }}
      disableDrag
      scrollable={false}
      showHandle={false}
      ariaLabelledBy="send-confirm-title"
    >
      <div className="w-10 h-1 rounded-full bg-foreground/15 mx-auto mb-4" />
      <h3 id="send-confirm-title" className="text-title font-bold text-foreground mb-4">
        {title}
      </h3>

      <div className="mb-4">
        <div className="flex justify-between py-3 border-b border-border/50">
          <span className="text-body text-foreground-muted">{t('send.confirm.recipient')}</span>
          <span className="text-body font-medium text-foreground truncate max-w-[200px]">{recipientName}</span>
        </div>
        <div className="flex justify-between py-3 border-b border-border/50">
          <span className="text-body text-foreground-muted">{t('common.amount')}</span>
          <span className="text-body font-medium text-foreground">{formatSats(amount)}</span>
        </div>
        <div className="flex justify-between py-3 border-b border-border/50">
          <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
          <span className="text-body font-medium text-foreground">
            {effectiveFee === null ? '—' : formatSats(effectiveFee)}
          </span>
        </div>
        <div className="flex justify-between py-3 border-b border-border/50">
          <span className="text-body font-bold text-foreground">{t('send.confirm.total')}</span>
          <span className="text-right">
            <span className="block text-body font-bold text-foreground">
              {total === null ? '—' : formatSats(total)}
            </span>
            {total !== null && formatFiat(total) && (
              <span className="block text-caption text-foreground-muted">≈ {formatFiat(total)}</span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={
            onChangeMint
              ? () => {
                  hapticTap()
                  onChangeMint()
                }
              : undefined
          }
          disabled={!onChangeMint}
          className="w-full flex items-center justify-between py-3"
        >
          <span className="text-body text-foreground-muted">{t('send.confirm.sourceMint')}</span>
          <span className="flex items-center gap-1.5 text-body font-medium text-foreground truncate max-w-[200px]">
            <MintIcon iconUrl={mintIcon} imgSize="w-5 h-5" className="w-5 h-5" circle />
            {mintName}
            {onChangeMint && <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />}
          </span>
        </button>
      </div>

      {(error || feeUnavailable || isOverBalance) && (
        <div className="px-4 py-3 bg-accent-danger/10 rounded-xl text-accent-danger text-caption mb-4">
          {error || (feeUnavailable ? t('send.confirm.feeUnavailable') : t('payment.insufficientBalance'))}
        </div>
      )}

      <Button
        variant="brand"
        size="xl"
        onClick={handleConfirm}
        loading={busy}
        disabled={!canConfirm}
        className="w-full"
      >
        {confirmLabel}
      </Button>
    </BottomSheet>
  )
}
