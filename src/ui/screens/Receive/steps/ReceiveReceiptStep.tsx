/**
 * ReceiveReceiptStep — the arrival moment as one continuous scene. Detection
 * means settlement is already final (quote watcher redeems before signalling;
 * token redeem returns after completion), so the receipt mounts at 'finishing'
 * — fast feed, tear, stamp — with no fake printing crawl and no dwell. The
 * action buttons fade in on the stamp, on the same surface, so there is no
 * second screen to swap to.
 */
import { useMemo, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { hapticSuccess, hapticTap } from '@/ui/utils/haptic'
import { fadeTransition } from '@/ui/utils/motion'
import tokenReceiveSuccessImg from '@/assets/token-receive-success.png'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
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
  receivedAt: number
  onMakeAnother?: () => void
  onExit: () => void
}

export function ReceiveReceiptStep({ amount, mintUrl, memo, method, receivedAt, onMakeAnother, onExit }: ReceiveReceiptStepProps) {
  const { t, i18n } = useTranslation()
  const reduceMotion = useReducedMotion()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const mintUrls = useMemo(() => (mintUrl ? [mintUrl] : []), [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)

  // Detection means settlement is already final — feed out fast and stamp; no
  // fake printing crawl, no dwell, no second screen. Buttons fade in on stamp.
  const [stamped, setStamped] = useState(false)

  const rows = useMemo(
    () => buildReceiveRows(t, method, mintUrl ? getDisplayName(mintUrl) : null, memo),
    [t, method, mintUrl, getDisplayName, memo],
  )
  const stampedAt = useMemo(
    () => new Date(receivedAt).toLocaleString(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [receivedAt, i18n.language],
  )

  return (
    <div className="flex h-full flex-col bg-background">
      <ScreenHeader title={t('receive.title')} />
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <PaymentReceipt
          status={stamped ? 'done' : 'finishing'}
          title={t('receive.receipt.title')}
          amount={`+${formatSats(amount)}`}
          fiat={formatFiat(amount) || null}
          rows={rows}
          statusLine={stamped ? undefined : t('receive.receipt.receiving')}
          doneLine={stamped ? { left: stampedAt, right: t('receive.receipt.completed') } : undefined}
          stampSrc={tokenReceiveSuccessImg}
          onStampComplete={() => { if (!stamped) { setStamped(true); hapticSuccess() } }}
        />
      </div>
      <AnimatePresence>
        {stamped && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={fadeTransition(reduceMotion, 0.2)}
            className="flex gap-3 px-6 pb-app shrink-0"
          >
            {onMakeAnother && (
              <Button variant="secondary" size="xl" onClick={() => { hapticTap(); onMakeAnother() }} className="flex-none px-6">
                {t('receive.request.makeAnother')}
              </Button>
            )}
            <Button variant="brand" size="xl" onClick={() => { hapticTap(); onExit() }} className="flex-1">
              {t('receive.request.exit')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
