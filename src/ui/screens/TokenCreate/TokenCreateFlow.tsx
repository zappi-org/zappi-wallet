import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { AmountStep } from './steps/AmountStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { CreatedStep } from './steps/CreatedStep'

type Step = 'amount' | 'confirm' | 'created'

export interface TokenCreateFlowProps {
  onBack: () => void
  onComplete: () => void
  /** Mint used for token creation. Falls back to active mint from the store. */
  mintUrl: string
}

export function TokenCreateFlow({ onBack, onComplete, mintUrl }: TokenCreateFlowProps) {
  const [step, setStep] = useState<Step>('amount')
  const [amount, setAmount] = useState(0)
  const [memo, setMemo] = useState('')
  const [senderPaysFee, setSenderPaysFee] = useState(false)

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {step === 'amount' && (
          <PageTransition key="amount" variant="page" className="flex-1">
            <AmountStep
              onBack={onBack}
              mintUrl={mintUrl}
              initialAmount={amount}
              initialMemo={memo}
              initialSenderPaysFee={senderPaysFee}
              onNext={(data) => {
                setAmount(data.amount)
                setMemo(data.memo)
                setSenderPaysFee(data.senderPaysFee)
                setStep('confirm')
              }}
            />
          </PageTransition>
        )}
        {step === 'confirm' && (
          <PageTransition key="confirm" variant="page" className="flex-1">
            <ConfirmStep
              amount={amount}
              memo={memo}
              senderPaysFee={senderPaysFee}
              mintUrl={mintUrl}
              onBack={() => setStep('amount')}
              onConfirm={() => setStep('created')}
            />
          </PageTransition>
        )}
        {step === 'created' && (
          <PageTransition key="created" variant="page" className="flex-1">
            <CreatedStep
              amount={amount}
              memo={memo}
              senderPaysFee={senderPaysFee}
              mintUrl={mintUrl}
              onClose={onComplete}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}

export default TokenCreateFlow
