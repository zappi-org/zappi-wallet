/**
 * ReceiveCompleteStep — Payment received success screen
 * Figma style: text at top-left, CoinBounce centered, button at bottom
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { hapticSuccess, hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { motion } from 'motion/react'
import tokenReceiveSuccessImg from '@/assets/token-receive-success.png'
import { Confetti } from '@/ui/components/payment/Confetti'

interface ReceiveCompleteStepProps {
  amount: number
  mintUrl: string | null
  /** True when the settled payment was verified to fulfill a ReceiveRequest the user created. */
  wasRequestFulfilled?: boolean
  onComplete: () => void
}

export function ReceiveCompleteStep({
  amount,
  mintUrl: _mintUrl,
  wasRequestFulfilled = false,
  onComplete,
}: ReceiveCompleteStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const hasTriggeredHaptic = useRef(false)

  // Haptic on mount
  useEffect(() => {
    if (!hasTriggeredHaptic.current) {
      hasTriggeredHaptic.current = true
      hapticSuccess()
    }
  }, [])

  // Auto-dismiss after 5 seconds
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  })
  useEffect(() => {
    const timer = setTimeout(() => onCompleteRef.current(), 5000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="flex flex-col h-full bg-background relative">
      <Confetti />

      {/* Centered content — same structure as SendCompleteStep */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {/* Character — small, with entrance animation */}
        <motion.img
          src={tokenReceiveSuccessImg}
          alt=""
          className="w-[120px] h-[120px] object-contain mb-6"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        />

        {/* Sentence */}
        <div className="text-center">
          <p className="text-heading font-semibold whitespace-pre-line break-keep break-words">
            {t(
              wasRequestFulfilled
                ? 'receive.complete.requestFulfilledMessage'
                : 'receive.complete.fullMessage',
              { amount: formatSats(amount) },
            )}
          </p>
        </div>

        {(() => { const f = formatFiat(amount); return f ? (
          <p className="text-body text-foreground-muted mt-3">{f}</p>
        ) : null })()}
      </div>

      {/* Bottom button */}
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
          {t('receive.complete.done')}
        </Button>
      </div>
    </div>
  )
}
