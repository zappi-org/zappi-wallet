/**
 * ReceiveCompleteStep — Payment received success screen
 * Figma style: text at top-left, CoinBounce centered, button at bottom
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticSuccess, hapticTap } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { motion } from 'motion/react'
import tokenReceiveSuccessImg from '@/assets/token-receive-success.png'
import { Confetti } from '@/ui/components/payment/Confetti'

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
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
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
    <div className="flex flex-col h-full bg-background relative">
      <Confetti />

      {/* Text at top */}
      <div className="px-6 pt-24">
        <p className="text-title font-medium leading-relaxed whitespace-pre-line text-center">
          {t('receive.complete.message', {
            mint: mintName,
            amount: formatSats(amount),
          })}
        </p>
        {(() => { const f = formatFiat(amount); return f ? (
          <p className="text-body text-foreground-muted text-center mt-1">{f}</p>
        ) : null })()}
      </div>

      {/* Success image centered */}
      <div className="flex-1 flex items-center justify-center">
        <motion.img
          src={tokenReceiveSuccessImg}
          alt=""
          className="w-80 h-80 object-contain"
          initial={{ scale: 0, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
        />
      </div>

      {/* Bottom Action — no border */}
      <div className="p-4 pb-safe">
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
