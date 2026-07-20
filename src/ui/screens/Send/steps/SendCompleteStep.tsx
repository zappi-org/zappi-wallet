/**
 * SendCompleteStep — the fully printed receipt with the Zappi seal stamped on.
 * One continuous story with the sending scene: printing… → stamp = done.
 * pending (in_transit melt): same receipt, no stamp — settlement still confirming.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat, FIAT_CURRENCY_MAP, formatFiatInputForDisplay } from '@/utils/format'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import sendSuccessImg from '@/assets/send-success.png'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { SendReceipt, type SendReceiptRow } from '@/ui/components/payment/SendReceipt'
import type { PaymentRoute } from '@/ui/hooks/use-routing'
import type { SendableValidatedData } from '../SendFlow'
import { getDestinationDisplay } from '../sendDisplayHelpers'

interface SendCompleteStepProps {
  validatedData: SendableValidatedData
  amount: number
  onComplete: () => void
  route?: PaymentRoute
  isFiatMode?: boolean
  fiatAmount?: string
  /** Display name from address book (overrides default recipient display) */
  displayName?: string
  /** Payment left the wallet but settlement is still confirming — no stamp yet. */
  pending?: boolean
  fee?: number
  mintUrl?: string
  memo?: string
}

export function SendCompleteStep({
  validatedData,
  amount,
  onComplete,
  route,
  isFiatMode = false,
  fiatAmount,
  displayName,
  pending = false,
  fee,
  mintUrl,
  memo,
}: SendCompleteStepProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const destination = getDestinationDisplay(validatedData, displayName, { route, t })
  const mintUrls = useMemo(() => (mintUrl ? [mintUrl] : []), [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)

  // Auto-dismiss — longer than the old confetti screen: the receipt is meant
  // to be read, and the stamp itself lands ~0.6s in.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  })
  useEffect(() => {
    const timer = setTimeout(() => onCompleteRef.current(), 8000)
    return () => clearTimeout(timer)
  }, [])

  // Amount display — symbol + grouping in fiat mode, same as the amount step
  const fiatCurrency = useAppStore((s) => s.settings.fiatCurrency) ?? 'USD'
  const currencySymbol = FIAT_CURRENCY_MAP.get(fiatCurrency)?.symbol ?? fiatCurrency
  const mainAmount = isFiatMode && fiatAmount
    ? `${currencySymbol}${formatFiatInputForDisplay(fiatAmount)}`
    : formatSats(amount)
  const subAmount = isFiatMode
    ? formatSats(amount)
    : (formatFiat(amount) || '')

  const rows = useMemo<SendReceiptRow[]>(() => {
    const list: SendReceiptRow[] = [{ label: t('send.receipt.recipient'), value: destination }]
    if (mintUrl) list.push({ label: t('send.confirm.sourceMint'), value: getDisplayName(mintUrl) })
    if (typeof fee === 'number') {
      list.push({ label: t('send.confirm.estimatedFee'), value: formatSats(fee) })
      list.push({ label: t('send.confirm.total'), value: formatSats(amount + fee), strong: true })
    }
    if (memo) list.push({ label: t('send.confirm.memo'), value: memo })
    return list
  }, [destination, mintUrl, getDisplayName, fee, memo, amount, formatSats, t])

  const stampedAt = useMemo(
    () => new Date().toLocaleString(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  )

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={pending ? t('send.sending.title') : t('send.complete.title')} />

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <SendReceipt
          status={pending ? 'pending' : 'done'}
          title={t('send.receipt.title')}
          amount={mainAmount}
          fiat={subAmount || null}
          rows={rows}
          statusLine={pending ? t('send.receipt.settling') : undefined}
          doneLine={pending ? undefined : { left: stampedAt, right: t('send.receipt.completed') }}
          stampSrc={sendSuccessImg}
        />
        <p className="mt-5 text-caption text-foreground-muted">
          {pending ? t('send.sending.networkDelay') : t('send.receipt.kept')}
        </p>
      </div>

      <div className="px-6 pb-app shrink-0">
        <Button
          variant="brand"
          size="xl"
          onClick={() => {
            hapticTap()
            onComplete()
          }}
          className="w-full"
        >
          {t('send.complete.confirm')}
        </Button>
      </div>
    </div>
  )
}
