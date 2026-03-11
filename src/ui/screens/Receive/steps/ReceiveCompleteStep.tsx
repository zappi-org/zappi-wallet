/**
 * ReceiveCompleteStep — Payment received success screen
 * Figma style: text at top-left, CoinBounce centered, button at bottom
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticSuccess, hapticTap } from '@/utils/haptic'
import { CoinBounceAnimation } from '@/ui/components/payment'
import { Button } from '@/ui/components/common/Button'

interface ReceiveCompleteStepProps {
  amount: number
  mintUrl: string | null
  onComplete: () => void
}

export function ReceiveCompleteStep({
  amount,
  mintUrl,
  onComplete,
}: ReceiveCompleteStepProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)
  const mintName = mintUrl ? getDisplayName(mintUrl) : ''
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
          {t('receive.complete.message', {
            mint: mintName,
            amount: amount.toLocaleString(),
          })}
        </p>
      </div>

      {/* Animation centered */}
      <div className="flex-1 flex items-center justify-center">
        <CoinBounceAnimation />
      </div>

      {/* Bottom Action — no border */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={() => {
            hapticTap()
            onComplete()
          }}
          className="w-full !bg-[#3b7df5] !text-white !rounded-lg !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('receive.complete.done')}
        </Button>
      </div>
    </div>
  )
}
