/**
 * SendCompleteStep — Send success screen
 * Figma 270:1056: text at top-left, orbital animation with check overlay centered,
 * two buttons at bottom ("세부정보" + "확인")
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { hapticSuccess, hapticTap } from '@/utils/haptic'
import { SendingAnimation } from '@/ui/components/payment'
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
      return data.parsed.description || 'eCash'
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
      {/* Text at top — left-aligned per Figma */}
      <div className="px-6 pt-14">
        <p className="text-[22px] font-medium leading-relaxed">
          {t('send.complete.message', { destination, amount: amount.toLocaleString() })}
        </p>
      </div>

      {/* Animation centered with check overlay */}
      <div className="flex-1 flex items-center justify-center -mt-10">
        <SendingAnimation showCheck scale={1.35} />
      </div>

      {/* Two buttons at bottom per Figma */}
      <div className="flex gap-3 p-5 pb-safe">
        <button
          onClick={() => {
            hapticTap()
            onComplete()
          }}
          className="flex-1 py-4 rounded-xl bg-[#f0f0f0] text-foreground font-medium text-base active:scale-95 transition-transform min-h-[44px]"
        >
          {t('send.complete.details')}
        </button>
        <Button
          variant="primary"
          size="xl"
          onClick={() => {
            hapticTap()
            onComplete()
          }}
          className="flex-1 !bg-[#3b7df5] !text-white !rounded-lg !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.complete.confirm')}
        </Button>
      </div>
    </div>
  )
}
