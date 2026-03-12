/**
 * SendCompleteStep — Send success screen
 * Success character image centered, text at top, two buttons at bottom
 */

import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { hapticSuccess, hapticTap } from '@/utils/haptic'
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
      {/* Text at top — left-aligned */}
      <div className="px-6 pt-14">
        <p className="text-[22px] font-medium leading-relaxed">
          {t('send.complete.message', { destination, amount: amount.toLocaleString() })}
        </p>
      </div>

      {/* Success character image — centered with entrance animation */}
      <div className="flex-1 flex items-center justify-center -mt-6">
        <motion.img
          src="/send-success.png"
          alt="Success"
          className="w-64 h-64 object-contain"
          initial={{ scale: 0, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
        />
      </div>

      {/* Bottom button */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={() => {
            hapticTap()
            onComplete()
          }}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.complete.confirm')}
        </Button>
      </div>
    </div>
  )
}
