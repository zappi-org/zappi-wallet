/**
 * SendCompleteStep — Send success screen
 */

import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useTranslation, Trans } from 'react-i18next'
import { hapticSuccess, hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import sendSuccessImg from '@/assets/send-success.png'
import { Button } from '@/ui/components/common/Button'
import { Confetti } from '@/ui/components/payment/Confetti'
import type { PaymentRoute } from '@/ui/hooks/use-routing'
import type { SendableValidatedData } from '../SendFlow'
import { getDestinationDisplay, shouldShowRecipientInMainMessage } from '../sendDisplayHelpers'

interface SendCompleteStepProps {
  validatedData: SendableValidatedData
  amount: number
  onComplete: () => void
  route?: PaymentRoute
  isFiatMode?: boolean
  fiatAmount?: string
  /** Display name from address book (overrides default recipient display) */
  displayName?: string
}

export function SendCompleteStep({
  validatedData,
  amount,
  onComplete,
  route,
  isFiatMode = false,
  fiatAmount,
  displayName,
}: SendCompleteStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const destination = getDestinationDisplay(validatedData, displayName, { route, t })
  const showRecipientInMain = shouldShowRecipientInMainMessage(validatedData)
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

  // Main amount display — respect fiat mode
  const mainAmount = isFiatMode && fiatAmount
    ? `${fiatAmount}`
    : formatSats(amount)
  const subAmount = isFiatMode
    ? formatSats(amount)
    : (formatFiat(amount) || '')

  return (
    <div className="flex flex-col h-full bg-background relative">
      <Confetti />

      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {/* Character — small, with entrance animation */}
        <motion.img
          src={sendSuccessImg}
          alt="Success"
          className="w-[120px] h-[120px] object-contain mb-6"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        />

        {/* Sentence — single Trans for natural word order per language */}
        <div className="text-center">
          <p className="text-heading font-semibold text-foreground whitespace-pre-line">
            <Trans
              i18nKey={showRecipientInMain ? 'send.complete.fullMessage' : 'send.complete.fullRequestMessage'}
              values={{ recipient: destination, amount: mainAmount }}
              components={{ b: <span className="text-brand" /> }}
            />
          </p>
        </div>

        {subAmount && (
          <p className="text-body text-foreground-muted mt-3">{subAmount}</p>
        )}
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
          {t('send.complete.confirm')}
        </Button>
      </div>
    </div>
  )
}
