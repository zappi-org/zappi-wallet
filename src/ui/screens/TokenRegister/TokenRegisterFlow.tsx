import { useCallback, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useTrustRegistry } from '@/ui/hooks/use-trust-registry'
import type { ValidatedCashuToken } from '@/core/domain/input-types'
import { RegisterInputStep } from './steps/RegisterInputStep'
import { ConfirmTrustedStep } from './steps/ConfirmTrustedStep'
import { ConfirmUntrustedStep } from './steps/ConfirmUntrustedStep'
import { RegisteredStep } from './steps/RegisteredStep'

type Step = 'input' | 'confirm-trusted' | 'confirm-untrusted' | 'registered'

export interface TokenReceiveOutcome {
  success: boolean
  amount?: number
  error?: { code?: string; message?: string }
}

export interface TokenRegisterFlowProps {
  onBack: () => void
  onComplete: () => void
  /** Redeem a cashu token — returns amount on success. */
  onReceiveToken: (token: string) => Promise<TokenReceiveOutcome>
  /** Add a mint to the trust registry (with any UI-side validation). */
  onAddTrustedMint: (mintUrl: string) => Promise<boolean>
  /** Cross-mint swap: redeem on source mint, swap to target. */
  onSwapReceive: (
    token: string,
    sourceMintUrl: string,
    targetMintUrl: string,
    amount: number,
  ) => Promise<TokenReceiveOutcome>
  /** Redeem fee preview (input_fee_ppk based). */
  onEstimateRedeemFee?: (
    token: string,
  ) => Promise<{ grossAmount: number; fee: number; netAmount: number } | null>
  /** Target mint for "swap to my mint" flow — usually user's active mint. */
  targetMintUrl?: string
  /**
   * Check whether a pasted token matches one of the user's own pending sends.
   * Returns { txId, amount } when matched (self-token), null otherwise.
   */
  onCheckSelfToken?: (
    token: string,
  ) => Promise<{ txId: string; amount: number } | null>
  /** Reclaim a self-owned pending send (used when register flow detects own token). */
  onReclaimOwnToken?: (txId: string) => Promise<{ amount: number } | null>
}

export function TokenRegisterFlow({
  onBack,
  onComplete,
  onReceiveToken,
  onAddTrustedMint,
  onSwapReceive,
  onEstimateRedeemFee,
  targetMintUrl,
  onCheckSelfToken,
  onReclaimOwnToken,
}: TokenRegisterFlowProps) {
  const [step, setStep] = useState<Step>('input')
  const [validated, setValidated] = useState<ValidatedCashuToken | null>(null)
  const [receivedAmount, setReceivedAmount] = useState(0)
  const { isTrusted } = useTrustRegistry()

  const handleValidated = useCallback(
    async (token: ValidatedCashuToken) => {
      // Self-owned token (user is re-registering a pending send they created) →
      // reclaim instead of redeem to avoid a duplicate "등록함" timeline entry.
      if (onCheckSelfToken && onReclaimOwnToken) {
        const match = await onCheckSelfToken(token.token)
        if (match) {
          const result = await onReclaimOwnToken(match.txId)
          setReceivedAmount(result?.amount ?? match.amount)
          setStep('registered')
          return
        }
      }

      setValidated(token)
      setStep(isTrusted(token.mintUrl) ? 'confirm-trusted' : 'confirm-untrusted')
    },
    [isTrusted, onCheckSelfToken, onReclaimOwnToken],
  )

  const handleReceive = useCallback(async () => {
    if (!validated) return
    const result = await onReceiveToken(validated.token)
    if (!result.success) {
      throw new Error(result.error?.message ?? 'redeem_failed')
    }
    setReceivedAmount(result.amount ?? validated.amountSats)
    setStep('registered')
  }, [validated, onReceiveToken])

  const handleAddAndReceive = useCallback(async () => {
    if (!validated) return
    const added = await onAddTrustedMint(validated.mintUrl)
    if (!added) throw new Error('add_trust_failed')
    const result = await onReceiveToken(validated.token)
    if (!result.success) {
      throw new Error(result.error?.message ?? 'redeem_failed')
    }
    setReceivedAmount(result.amount ?? validated.amountSats)
    setStep('registered')
  }, [validated, onAddTrustedMint, onReceiveToken])

  const handleSwapToMyMint = useCallback(async () => {
    if (!validated) return
    if (!targetMintUrl) throw new Error('no_target_mint')
    const result = await onSwapReceive(
      validated.token,
      validated.mintUrl,
      targetMintUrl,
      validated.amountSats,
    )
    if (!result.success) {
      throw new Error(result.error?.message ?? 'swap_failed')
    }
    setReceivedAmount(result.amount ?? validated.amountSats)
    setStep('registered')
  }, [validated, targetMintUrl, onSwapReceive])

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {step === 'input' && (
          <PageTransition key="input" variant="page" className="flex-1">
            <RegisterInputStep
              onBack={onBack}
              initialToken={validated?.token ?? ''}
              onNext={handleValidated}
            />
          </PageTransition>
        )}

        {step === 'confirm-trusted' && validated && (
          <PageTransition key="confirm-trusted" variant="page" className="flex-1">
            <ConfirmTrustedStep
              token={validated}
              onBack={() => setStep('input')}
              onReceive={handleReceive}
              onEstimateRedeemFee={onEstimateRedeemFee}
            />
          </PageTransition>
        )}

        {step === 'confirm-untrusted' && validated && (
          <PageTransition key="confirm-untrusted" variant="page" className="flex-1">
            <ConfirmUntrustedStep
              token={validated}
              onBack={() => setStep('input')}
              onAddAndReceive={handleAddAndReceive}
              onSwapToMyMint={targetMintUrl ? handleSwapToMyMint : undefined}
            />
          </PageTransition>
        )}

        {step === 'registered' && (
          <PageTransition key="registered" variant="fade" className="flex-1">
            <RegisteredStep amount={receivedAmount} onComplete={onComplete} />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}

export default TokenRegisterFlow
