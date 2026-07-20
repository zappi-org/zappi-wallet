/** Torn receipt at rest — mirror of SendCompleteStep, no auto-dismiss:
 *  the counterparty often wants to see this screen. */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import tokenReceiveSuccessImg from '@/assets/token-receive-success.png'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { PaymentReceipt } from '@/ui/components/payment/PaymentReceipt'
import { buildReceiveRows, type ReceiveReceiptMethod } from './ReceiveReceiptStep'

export interface ReceiveCompleteStepProps {
  amount: number
  mintUrl: string | null
  memo?: string
  method: ReceiveReceiptMethod
  receivedAt: number
  onMakeAnother?: () => void
  onExit: () => void
}

export function ReceiveCompleteStep({ amount, mintUrl, memo, method, receivedAt, onMakeAnother, onExit }: ReceiveCompleteStepProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const mintUrls = useMemo(() => (mintUrl ? [mintUrl] : []), [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)

  const rows = useMemo(
    () => buildReceiveRows(t, method, mintUrl ? getDisplayName(mintUrl) : null, memo),
    [t, method, mintUrl, getDisplayName, memo],
  )
  const stampedAt = useMemo(
    () => new Date(receivedAt).toLocaleString(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [receivedAt, i18n.language],
  )

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('receive.title')} />
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <PaymentReceipt
          status="done"
          title={t('receive.receipt.title')}
          amount={`+${formatSats(amount)}`}
          fiat={formatFiat(amount) || null}
          rows={rows}
          doneLine={{ left: stampedAt, right: t('receive.receipt.completed') }}
          stampSrc={tokenReceiveSuccessImg}
        />
      </div>
      <div className="flex gap-3 px-6 pb-app shrink-0">
        {onMakeAnother && (
          <Button variant="secondary" size="xl" onClick={() => { hapticTap(); onMakeAnother() }} className="flex-none px-6">
            {t('receive.request.makeAnother')}
          </Button>
        )}
        <Button variant="brand" size="xl" onClick={() => { hapticTap(); onExit() }} className="flex-1">
          {t('receive.request.exit')}
        </Button>
      </div>
    </div>
  )
}
