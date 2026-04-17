import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { RegisterInputStep, type MockPath } from './steps/RegisterInputStep'
import { ConfirmTrustedStep } from './steps/ConfirmTrustedStep'
import { ConfirmUntrustedStep } from './steps/ConfirmUntrustedStep'
import { RegisteredStep } from './steps/RegisteredStep'
import {
  MOCK_REGISTER_AMOUNT,
  MOCK_REGISTER_MEMO,
} from './mockData'

type Step = 'input' | 'confirm-trusted' | 'confirm-untrusted' | 'registered'

export interface TokenRegisterFlowProps {
  onBack: () => void
  onComplete: () => void
}

export function TokenRegisterFlow({ onBack, onComplete }: TokenRegisterFlowProps) {
  const [step, setStep] = useState<Step>('input')
  const [token, setToken] = useState('')
  const [path, setPath] = useState<MockPath>('trusted-memo')

  const memo = path === 'trusted-memo' ? MOCK_REGISTER_MEMO : ''

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {step === 'input' && (
          <PageTransition key="input" variant="page" className="flex-1">
            <RegisterInputStep
              onBack={onBack}
              initialToken={token}
              initialPath={path}
              onNext={(nextPath) => {
                setToken(token)
                setPath(nextPath)
                setStep(nextPath === 'untrusted' ? 'confirm-untrusted' : 'confirm-trusted')
              }}
            />
          </PageTransition>
        )}

        {step === 'confirm-trusted' && (
          <PageTransition key="confirm-trusted" variant="page" className="flex-1">
            <ConfirmTrustedStep
              amount={MOCK_REGISTER_AMOUNT}
              memo={memo}
              onBack={() => setStep('input')}
              onReceive={() => setStep('registered')}
            />
          </PageTransition>
        )}

        {step === 'confirm-untrusted' && (
          <PageTransition key="confirm-untrusted" variant="page" className="flex-1">
            <ConfirmUntrustedStep
              amount={MOCK_REGISTER_AMOUNT}
              onBack={() => setStep('input')}
              onAddAndReceive={() => setStep('registered')}
              onSwapToMyMint={() => setStep('registered')}
            />
          </PageTransition>
        )}

        {step === 'registered' && (
          <PageTransition key="registered" variant="fade" className="flex-1">
            <RegisteredStep
              amount={MOCK_REGISTER_AMOUNT}
              onComplete={onComplete}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}

export default TokenRegisterFlow
