/**
 * ReceiveReceiptStep — the arrival moment. Detection means settlement is
 * already final (quote watcher redeems before signalling; token redeem
 * returns after completion), so the receipt prints briefly and tears —
 * no long fake-progress like send needs.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import tokenReceiveSuccessImg from '@/assets/token-receive-success.png'
import { PaymentReceipt, type PaymentReceiptRow } from '@/ui/components/payment/PaymentReceipt'

export type ReceiveReceiptMethod = 'bolt11' | 'ecash' | 'redeem'

// eslint-disable-next-line react-refresh/only-export-components
export function buildReceiveRows(
  t: TFunction,
  method: ReceiveReceiptMethod,
  mintName: string | null,
  memo?: string,
): PaymentReceiptRow[] {
  const rows: PaymentReceiptRow[] = [{
    label: t('receive.receipt.method'),
    value: method === 'bolt11' ? t('receive.receipt.methodLightning') : t('receive.receipt.methodEcash'),
  }]
  if (mintName) rows.push({ label: t('receive.receipt.toMint'), value: mintName, strong: true })
  if (memo) rows.push({ label: t('receive.receipt.memo'), value: memo })
  return rows
}

export interface ReceiveReceiptStepProps {
  amount: number
  mintUrl: string | null
  memo?: string
  method: ReceiveReceiptMethod
  onDone: () => void
}

const PRINT_MS = 1400
const DWELL_AFTER_STAMP_MS = 1600

export function ReceiveReceiptStep({ amount, mintUrl, memo, method, onDone }: ReceiveReceiptStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const mintUrls = useMemo(() => (mintUrl ? [mintUrl] : []), [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)

  const [status, setStatus] = useState<'printing' | 'finishing'>('printing')
  useEffect(() => {
    const id = setTimeout(() => setStatus('finishing'), PRINT_MS)
    return () => clearTimeout(id)
  }, [])

  // Effect-scoped dwell so an unmount mid-dwell cancels onDone.
  const [stamped, setStamped] = useState(false)
  useEffect(() => {
    if (!stamped) return
    const id = setTimeout(onDone, DWELL_AFTER_STAMP_MS)
    return () => clearTimeout(id)
  }, [stamped, onDone])

  const rows = useMemo(
    () => buildReceiveRows(t, method, mintUrl ? getDisplayName(mintUrl) : null, memo),
    [t, method, mintUrl, getDisplayName, memo],
  )

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <PaymentReceipt
          status={status}
          title={t('receive.receipt.title')}
          amount={`+${formatSats(amount)}`}
          fiat={formatFiat(amount) || null}
          rows={rows}
          statusLine={t('receive.receipt.receiving')}
          stampSrc={tokenReceiveSuccessImg}
          onStampComplete={() => setStamped(true)}
        />
      </div>
    </div>
  )
}
