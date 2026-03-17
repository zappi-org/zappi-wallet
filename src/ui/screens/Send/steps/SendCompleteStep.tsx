/**
 * SendCompleteStep — Send success screen
 * Success character image centered, text at top, two buttons at bottom
 */

import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { hapticSuccess, hapticTap } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import sendSuccessImg from '@/assets/send-success.png'
import { Button } from '@/ui/components/common/Button'
import type { SendableValidatedData } from '../SendFlow'

interface SendCompleteStepProps {
  validatedData: SendableValidatedData
  amount: number
  fee: number
  onComplete: () => void
}

function getDestinationDisplay(data: SendableValidatedData): string {
  switch (data.type) {
    case 'bolt11':
      return data.description || 'Lightning'
    case 'lightning-address':
      return data.address
    case 'lnurl-pay':
      return data.params?.domain || 'LNURL'
    case 'cashu-request':
      return 'eCash'
  }
}

export function SendCompleteStep({
  validatedData,
  amount,
  onComplete,
}: SendCompleteStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const destination = getDestinationDisplay(validatedData)
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
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Text — centered, pushed down a bit */}
      <div className="px-6 pt-24">
        <p className="text-[22px] font-medium leading-relaxed whitespace-pre-line text-center">
          {t('send.complete.message', { destination, amount: formatSats(amount) })}
        </p>
        {(() => { const f = formatFiat(amount); return f ? (
          <p className="text-[15px] text-foreground-muted text-center mt-1">≈ {f}</p>
        ) : null })()}
      </div>

      {/* Success character image — centered with entrance animation */}
      <div className="flex-1 flex items-center justify-center">
        <motion.img
          src={sendSuccessImg}
          alt="Success"
          className="w-80 h-80 object-contain"
          initial={{ scale: 0, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
        />
      </div>

      {/* Bottom button */}
      <div className="p-5 pb-safe">
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
