import { toNumber } from '@/core/domain/amount'
import type { ValidatedCashuToken, ValidatedData } from '@/core/domain/input-types'
import type { BaseError } from '@/core/errors/base'
import { UnknownError } from '@/core/errors/base'
import { TokenSpentError } from '@/core/errors/cashu'
import type { PendingIncomingReview } from '@/core/types'
import { useAppStore } from '@/store'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useTrustRegistry } from '@/ui/hooks/use-trust-registry'
import { translateError } from '@/ui/utils/error-i18n'
import { AnimatePresence } from 'motion/react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmTrustedStep } from '@/ui/screens/Receive/redeem/ConfirmTrustedStep'
import { ConfirmUntrustedStep } from '@/ui/screens/Receive/redeem/ConfirmUntrustedStep'
import { RegisteredStep } from './steps/RegisteredStep'
import { RegisterInputStep } from './steps/RegisterInputStep'
type Step = 'input' | 'confirm-trusted' | 'confirm-untrusted' | 'registered'

export interface TokenReceiveOutcome {
  success: boolean
  amount?: number
  transactionId?: string
  error?: BaseError
}

export interface TokenRegisterFlowProps {
  onBack: () => void
  onComplete: () => void
  /** Redeem a cashu token — returns amount on success. */
  onReceiveToken: (token: string) => Promise<TokenReceiveOutcome>
  /** Add a mint to the trust registry (with any UI-side validation). */
  onAddTrustedMint: (mintUrl: string) => Promise<boolean>
  /**
   * DEAD: cross-mint swap — UI entry points removed. Kept for potential
   * future re-enablement (see ZAP swap-receive plumbing).
   */
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
  /** DEAD: target mint for "swap to my mint" flow — UI removed. */
  targetMintUrl?: string
  /**
   * Check whether a pasted token matches one of the user's own pending sends.
   * Returns { txId, amount } when matched (self-token), null otherwise.
   */
  onCheckSelfToken?: (
    token: string,
  ) => Promise<{ txId: string; amount: number } | null>
  /** Reclaim a self-owned pending send (used when register flow detects own token). */
  onReclaimOwnToken?: (txId: string) => Promise<{ amount: number }>
  /** Pre-filled token string when entering via universal router. */
  initialToken?: string
  /** Delegate non-cashu-token input back to the universal router. */
  onRouteValidated?: (data: ValidatedData) => void
  /**
   * Incoming review (ZAP-52): when a token arrives via gift-wrap from an
   * untrusted mint, the queue surfaces it here for the user's explicit
   * accept/reject decision instead of auto-trusting the mint.
   */
  incomingReview?: PendingIncomingReview | null
  onResolveIncomingReview?: (params: { transactionId?: string }) => Promise<void>
  onRejectIncomingReview?: () => Promise<void>
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
  initialToken = '',
  onRouteValidated,
  incomingReview = null,
  onResolveIncomingReview,
  onRejectIncomingReview,
}: TokenRegisterFlowProps) {
  const { isTrusted } = useTrustRegistry()
  const addToast = useAppStore((s) => s.addToast)
  const {t} = useTranslation()
  // When entering via incoming review, skip input and land directly on the
  // appropriate confirm step with the queued token pre-loaded.
  const initialValidated = incomingReview?.token ?? null
  const initialStep: Step = initialValidated
    ? (isTrusted(initialValidated.mintUrl) ? 'confirm-trusted' : 'confirm-untrusted')
    : 'input'
  const [step, setStep] = useState<Step>(initialStep)
  const [validated, setValidated] = useState<ValidatedCashuToken | null>(initialValidated)
  const [receivedAmount, setReceivedAmount] = useState(0)

  const handleValidated = useCallback(
    async (token: ValidatedCashuToken) => {
      // Self-owned token (user is re-registering a pending send they created) →
      // reclaim instead of redeem to avoid a duplicate "등록함" timeline entry.
      if (onCheckSelfToken && onReclaimOwnToken) {
        const match = await onCheckSelfToken(token.token)
        if (match) {
          try {
            const result = await onReclaimOwnToken(match.txId)
            setReceivedAmount(result.amount)
            setStep('registered')
            return
          } catch (error) {
            console.error('[TokenRegister] Reclaim failed:', error)
            addToast({type: 'error', message: translateError(error,t)})
          }
        }
      }

      setValidated(token)
      setStep(isTrusted(token.mintUrl) ? 'confirm-trusted' : 'confirm-untrusted')
    },
    [isTrusted, onCheckSelfToken, onReclaimOwnToken,addToast, t],
  )

  const finalizeReceive = useCallback(async (result: TokenReceiveOutcome, fallbackAmount: number) => {
    if (onResolveIncomingReview) {
      await onResolveIncomingReview({ transactionId: result.transactionId })
    }
    setReceivedAmount(result.amount ?? fallbackAmount)
    setStep('registered')
  }, [onResolveIncomingReview])

  const handleReceive = useCallback(async (receiveMintUrl?: string) => {
    if (!validated) return
    const target = receiveMintUrl ?? validated.mintUrl
    // DEAD: swap branch — confirm steps now always pass sourceMintUrl since
    // swap UI was removed. Kept for potential future re-enablement.
    const result = target === validated.mintUrl
      ? await onReceiveToken(validated.token)
      : await onSwapReceive(
          validated.token,
          validated.mintUrl,
          target,
          toNumber(validated.amount),
        )
    if (!result.success) {
      if (result.error instanceof TokenSpentError) {
        throw result.error
      }
      throw result.error ?? new UnknownError('redeem_failed') 
    }
    await finalizeReceive(result, toNumber(validated.amount))
  }, [validated, onReceiveToken, onSwapReceive, finalizeReceive])

  const handleAddAndReceive = useCallback(async () => {
    if (!validated) return
    const added = await onAddTrustedMint(validated.mintUrl)
    if (!added) throw new Error('add_trust_failed')

    const result = await onReceiveToken(validated.token)
    if (!result.success) {
      if (result.error instanceof TokenSpentError) {
        throw result.error
      }
      throw result.error ?? new UnknownError('redeem_failed')
    }
    await finalizeReceive(result, toNumber(validated.amount))
  }, [validated, onAddTrustedMint, onReceiveToken, finalizeReceive])

  // DEAD: swap-to-my-mint handler — no UI invokes it after swap option was
  // removed from ConfirmUntrustedStep. Kept for potential future re-enablement.
  const _handleSwapToMyMint = useCallback(async () => {
    if (!validated) return
    if (!targetMintUrl) throw new Error('no_target_mint')
    const result = await onSwapReceive(
      validated.token,
      validated.mintUrl,
      targetMintUrl,
      toNumber(validated.amount),
    )
    if (!result.success) {
      throw result.error ?? new Error('swap_failed')
    }
    await finalizeReceive(result, toNumber(validated.amount))
  }, [validated, targetMintUrl, onSwapReceive, finalizeReceive])
  void _handleSwapToMyMint

  // In incoming-review mode the user cannot return to the input step (the
  // queue chose this token); back out becomes "reject".
  const handleConfirmBack = useCallback(() => {
    if (incomingReview && onRejectIncomingReview) {
      void onRejectIncomingReview()
      return
    }
    setStep('input')
  }, [incomingReview, onRejectIncomingReview])

  // Reject = exit the register flow entirely. In incoming-review mode the
  // queued token is marked rejected; otherwise we leave the register screen.
  const handleReject = useCallback(() => {
    if (incomingReview && onRejectIncomingReview) {
      void onRejectIncomingReview()
      return
    }
    onBack()
  }, [incomingReview, onRejectIncomingReview, onBack])

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {step === 'input' && (
          <PageTransition key="input" variant="page" className="flex-1">
            <RegisterInputStep
              onBack={onBack}
              initialToken={validated?.token ?? initialToken}
              onNext={handleValidated}
              onRouteValidated={onRouteValidated}
            />
          </PageTransition>
        )}

        {step === 'confirm-trusted' && validated && (
          <PageTransition key="confirm-trusted" variant="page" className="flex-1">
            <ConfirmTrustedStep
              token={validated}
              onBack={handleConfirmBack}
              onReceive={handleReceive}
              onReject={handleReject}
              onEstimateRedeemFee={onEstimateRedeemFee}
            />
          </PageTransition>
        )}

        {step === 'confirm-untrusted' && validated && (
          <PageTransition key="confirm-untrusted" variant="page" className="flex-1">
            <ConfirmUntrustedStep
              token={validated}
              onBack={handleConfirmBack}
              onAddAndReceive={handleAddAndReceive}
              onReject={handleReject}
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
