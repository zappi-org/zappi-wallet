import { useCallback, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { AmountStep } from './steps/AmountStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { CreatedStep } from './steps/CreatedStep'

type Step = 'amount' | 'confirm' | 'created'

export interface TokenCreateResult {
  token: string
  txId: string
  operationId: string
}

export interface TokenCreateFlowProps {
  onBack: () => void
  onComplete: () => void
  /** Mint used for token creation. Falls back to active mint from the store. */
  mintUrl: string
  /** Execute token creation via PaymentUseCase.send. Returns null on failure. */
  onCreateToken: (
    amount: number,
    mintUrl: string,
    memo?: string,
  ) => Promise<TokenCreateResult | null>
  /** Reclaim a created-but-not-yet-claimed token. */
  onCancelToken?: (txId: string) => Promise<void> | void
  /** Live reclaim/receive fee quote (swap fee from input_fee_ppk). */
  onQuoteReclaim?: (txId: string) => Promise<number | null>
  /** Live send fee estimate (pre-create swap fee). */
  onEstimateFee?: (mintUrl: string, amount: number) => Promise<number | null>
}

export function TokenCreateFlow({
  onBack,
  onComplete,
  mintUrl,
  onCreateToken,
  onCancelToken,
  onQuoteReclaim,
  onEstimateFee,
}: TokenCreateFlowProps) {
  const [step, setStep] = useState<Step>('amount')
  const [selectedMintUrl, setSelectedMintUrl] = useState(mintUrl)
  const [amount, setAmount] = useState(0)
  const [memo, setMemo] = useState('')
  const [senderPaysFee, setSenderPaysFee] = useState(false)
  const [createdToken, setCreatedToken] = useState<string>('')
  const [createdTxId, setCreatedTxId] = useState<string>('')

  const handleCreate = useCallback(async () => {
    const result = await onCreateToken(amount, selectedMintUrl, memo || undefined)
    if (!result) {
      throw new Error('token_create_failed')
    }
    setCreatedToken(result.token)
    setCreatedTxId(result.txId)
    setStep('created')
  }, [amount, memo, selectedMintUrl, onCreateToken])

  const handleCancel = useCallback(async () => {
    if (!createdTxId || !onCancelToken) return
    await onCancelToken(createdTxId)
    onComplete()
  }, [createdTxId, onCancelToken, onComplete])

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {step === 'amount' && (
          <PageTransition key="amount" variant="page" className="flex-1">
            <AmountStep
              onBack={onBack}
              mintUrl={selectedMintUrl}
              onChangeMint={setSelectedMintUrl}
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
              mintUrl={selectedMintUrl}
              onBack={() => setStep('amount')}
              onConfirm={handleCreate}
              onEstimateFee={onEstimateFee}
            />
          </PageTransition>
        )}
        {step === 'created' && (
          <PageTransition key="created" variant="page" className="flex-1">
            <CreatedStep
              amount={amount}
              memo={memo}
              senderPaysFee={senderPaysFee}
              mintUrl={selectedMintUrl}
              tokenString={createdToken}
              txId={createdTxId}
              onClose={onComplete}
              onCancelToken={onCancelToken ? handleCancel : undefined}
              onQuoteReclaim={onQuoteReclaim}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}

export default TokenCreateFlow
