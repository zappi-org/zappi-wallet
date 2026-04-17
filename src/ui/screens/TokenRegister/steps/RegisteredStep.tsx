import { Button } from '@/ui/components/common/Button'
import { Confetti } from '@/ui/components/payment/Confetti'
import { formatFiatAmount, useFormatSats } from '@/utils/format'
import { motion } from 'motion/react'
import tokenReceiveSuccessImg from '@/assets/token-receive-success.png'
import { mockSatsToUsd } from '../mockData'

export interface RegisteredStepProps {
  amount: number
  onComplete: () => void
}

export function RegisteredStep({ amount, onComplete }: RegisteredStepProps) {
  const formatSats = useFormatSats()
  const fiatLabel = formatFiatAmount(mockSatsToUsd(amount), 'USD')

  return (
    <div className="flex flex-col h-full bg-background relative">
      <Confetti />

      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <motion.img
          src={tokenReceiveSuccessImg}
          alt=""
          className="w-[120px] h-[120px] object-contain mb-6"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        />

        <div className="text-center">
          <p className="text-heading font-semibold text-foreground">
            {formatSats(amount)} 입금되었어요!
          </p>
        </div>

        <p className="text-body text-foreground-muted mt-3">~ {fiatLabel}</p>
      </div>

      <div className="px-6 pb-6 pb-safe shrink-0">
        <Button
          variant="brand"
          size="xl"
          onClick={onComplete}
          className="w-full"
        >
          확인
        </Button>
      </div>
    </div>
  )
}
