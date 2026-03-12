/**
 * ReceiveFlow — Unified receive flow container
 * Manages internal step state machine for all receive operations:
 * - Lightning receive (invoice generation + payment subscription)
 * - Ecash receive (NUT-18 payment request via Nostr)
 * - Token receive (QR scan/paste + trust verification)
 *
 * Business logic stays in MainApp handlers (passed as props).
 */

import { useState, useCallback, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useNetwork } from '@/hooks/use-network'
import { useAppStore } from '@/store'
import { useTranslation } from 'react-i18next'
import type { ValidatedData, ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'

import { TokenReceiveStep } from './steps/TokenReceiveStep'
import { ReceiveInputStep } from './steps/ReceiveInputStep'
import { ReceiveQRStep } from './steps/ReceiveQRStep'
import { ReceiveCompleteStep } from './steps/ReceiveCompleteStep'
import { TokenConfirmStep } from './steps/TokenConfirmStep'
import { UntrustedMintStep } from './steps/UntrustedMintStep'

// ============= Types =============

export type ReceiveStep =
  | 'token-receive'
  | 'input'
  | 'qr'
  | 'complete'
  | 'token-confirm'
  | 'untrusted-mint'

export type ReceiveMethod = 'ecash' | 'lightning'

export interface ReceiveFlowState {
  step: ReceiveStep
  method: ReceiveMethod
  selectedMintUrl: string | null
  amount: number
  // Lightning
  invoice: string | null
  quoteId: string | null
  quoteExpiry: number | null
  // Ecash (NUT-18)
  ecashRequest: string | null
  ecashRequestId: string | null
  // Token receive
  scannedToken: ValidatedCashuToken | null
  isTrustedMint: boolean
  // Result
  receivedAmount: number
}

export interface ReceiveFlowProps {
  onBack: () => void
  onComplete: () => void
  // MainApp handlers
  onCreateInvoice: (amount: number, mintUrl: string) => Promise<{
    invoice: string
    quoteId: string
    expiry: number
  } | null>
  onSubscribeToQuote: (
    mintUrl: string,
    quoteId: string,
    amount: number,
    onPaid: () => void,
    onError?: (error: Error) => void
  ) => Promise<(() => void) | null>
  onPaymentReceived: (amount: number, type: 'lightning' | 'ecash') => void
  onReceiveToken: (token: string) => Promise<{ success: boolean; amount?: number; error?: { code?: string; message?: string } }>
  onAddTrustedMint: (mintUrl: string) => Promise<boolean>
  // Pre-filled data
  validatedData?: ValidatedData
  initialAmount?: number
  initialMintUrl?: string | null
}

// ============= Component =============

export function ReceiveFlow({
  onBack,
  onComplete,
  onCreateInvoice,
  onSubscribeToQuote,
  onPaymentReceived,
  onReceiveToken,
  onAddTrustedMint,
  validatedData: initialValidatedData,
  initialAmount,
  initialMintUrl,
}: ReceiveFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)
  const settings = useAppStore((s) => s.settings)

  // Determine initial step from validatedData
  const getInitialStep = (): ReceiveStep => {
    if (initialValidatedData?.type === 'cashu-token') {
      const isTrusted = settings.mints.includes(initialValidatedData.mintUrl)
      return isTrusted ? 'token-confirm' : 'untrusted-mint'
    }
    return 'token-receive'
  }

  const [state, setState] = useState<ReceiveFlowState>({
    step: getInitialStep(),
    method: 'lightning',
    selectedMintUrl: initialMintUrl || null,
    amount: initialAmount || (initialValidatedData?.type === 'cashu-token' ? initialValidatedData.amountSats : 0),
    invoice: null,
    quoteId: null,
    quoteExpiry: null,
    ecashRequest: null,
    ecashRequestId: null,
    scannedToken: initialValidatedData?.type === 'cashu-token' ? initialValidatedData : null,
    isTrustedMint: initialValidatedData?.type === 'cashu-token'
      ? settings.mints.includes(initialValidatedData.mintUrl)
      : false,
    receivedAmount: 0,
  })

  const [isLoading, setIsLoading] = useState(false)
  const isProcessingRef = useRef(false)

  // ============= Step Transitions =============

  /** Input → create invoice/request → QR step */
  const handleInputNext = useCallback(async (data: {
    method: ReceiveMethod
    amount: number
    mintUrl: string
    // For ecash: request + requestId already created in step
    ecashRequest?: string
    ecashRequestId?: string
  }) => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true
    setIsLoading(true)

    if (!isOnline) {
      addToast({ type: 'error', message: t('common.offlineRequired'), duration: 3000 })
      isProcessingRef.current = false
      setIsLoading(false)
      return
    }

    try {
      if (data.method === 'lightning') {
        // Create Lightning invoice
        const result = await onCreateInvoice(data.amount, data.mintUrl)
        if (!result) {
          addToast({ type: 'error', message: t('payment.createInvoiceFailed'), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }

        setState((prev) => ({
          ...prev,
          step: 'qr',
          method: 'lightning',
          amount: data.amount,
          selectedMintUrl: data.mintUrl,
          invoice: result.invoice,
          quoteId: result.quoteId,
          quoteExpiry: result.expiry,
        }))
      } else {
        // Ecash: request is already created in ReceiveInputStep
        setState((prev) => ({
          ...prev,
          step: 'qr',
          method: 'ecash',
          amount: data.amount,
          selectedMintUrl: data.mintUrl,
          ecashRequest: data.ecashRequest || null,
          ecashRequestId: data.ecashRequestId || null,
        }))
      }
    } catch (err) {
      console.error('[ReceiveFlow] Input next error:', err)
      addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [isOnline, onCreateInvoice, addToast, t])

  /** Payment received → complete */
  const handlePaymentDetected = useCallback((amount: number) => {
    onPaymentReceived(amount, state.method)
    setState((prev) => ({
      ...prev,
      step: 'complete',
      receivedAmount: amount,
    }))
  }, [state.method, onPaymentReceived])

  /** Token scanned from TokenReceiveBottomSheet */
  const handleTokenDetected = useCallback((token: ValidatedCashuToken) => {
    const isTrusted = settings.mints.includes(token.mintUrl)
    setState((prev) => ({
      ...prev,
      scannedToken: token,
      isTrustedMint: isTrusted,
      amount: token.amountSats,
      step: isTrusted ? 'token-confirm' : 'untrusted-mint',
    }))
  }, [settings.mints])

  /** Token confirm → receive */
  const handleTokenReceive = useCallback(async (_mintUrl?: string) => {
    if (isProcessingRef.current || !state.scannedToken) return

    if (!isOnline) {
      addToast({ type: 'error', message: t('common.offlineRequired'), duration: 3000 })
      return
    }

    isProcessingRef.current = true

    try {
      const result = await onReceiveToken(state.scannedToken.token)
      if (result.success) {
        onPaymentReceived(result.amount || state.scannedToken.amountSats, 'ecash')
        setState((prev) => ({
          ...prev,
          step: 'complete',
          receivedAmount: result.amount || state.scannedToken!.amountSats,
        }))
      } else {
        // Check if token was already spent
        const errorMsg = result.error?.message?.toLowerCase() || ''
        const isAlreadySpent = errorMsg.includes('already spent') || errorMsg.includes('token spent')
        const message = isAlreadySpent
          ? t('payment.tokenAlreadySpent')
          : t('payment.tokenReceiveFailed')
        addToast({ type: 'error', message, duration: 3000 })
      }
    } catch (err) {
      console.error('[ReceiveFlow] Token receive error:', err)
      const errMsg = err instanceof Error ? err.message.toLowerCase() : ''
      const isAlreadySpent = errMsg.includes('already spent') || errMsg.includes('token spent')
      const message = isAlreadySpent
        ? t('payment.tokenAlreadySpent')
        : (err instanceof Error ? err.message : t('payment.tokenReceiveFailed'))
      addToast({ type: 'error', message, duration: 3000 })
    } finally {
      isProcessingRef.current = false
    }
  }, [state.scannedToken, onReceiveToken, onPaymentReceived, isOnline, addToast, t])

  /** Untrusted mint → add trust & receive */
  const handleAddTrustAndReceive = useCallback(async () => {
    if (isProcessingRef.current || !state.scannedToken) return

    if (!isOnline) {
      addToast({ type: 'error', message: t('common.offlineRequired'), duration: 3000 })
      return
    }
    isProcessingRef.current = true

    try {
      const success = await onAddTrustedMint(state.scannedToken.mintUrl)
      if (!success) {
        addToast({ type: 'error', message: t('payment.mintAddFailed'), duration: 3000 })
        isProcessingRef.current = false
        return
      }
      // Now receive the token
      await handleTokenReceive()
    } catch (err) {
      console.error('[ReceiveFlow] Add trust error:', err)
      addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
      isProcessingRef.current = false
    }
  }, [state.scannedToken, onAddTrustedMint, handleTokenReceive, isOnline, addToast, t])

  /** Untrusted mint → swap to my mint */
  const handleSwapToMyMint = useCallback(async (_targetMintUrl: string) => {
    // For now, just add the source mint as trusted and receive
    // Cross-mint swap is a future enhancement
    // The token will be received to the source mint, then user can swap manually
    await handleAddTrustAndReceive()
  }, [handleAddTrustAndReceive])

  // ============= Navigation =============

  const goToStep = useCallback((step: ReceiveStep) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  // ============= Render =============

  return (
    <div className="h-dvh bg-background text-foreground font-sans flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {state.step === 'token-receive' && (
          <PageTransition key="token-receive" variant="page" className="flex-1">
            <TokenReceiveStep
              onBack={onBack}
              onTokenDetected={handleTokenDetected}
              onGoToCreateRequest={() => goToStep('input')}
            />
          </PageTransition>
        )}

        {state.step === 'input' && (
          <PageTransition key="receive-input" variant="page" className="flex-1">
            <ReceiveInputStep
              onBack={() => goToStep('token-receive')}
              onNext={handleInputNext}
              initialAmount={state.amount}
              initialMintUrl={state.selectedMintUrl}
              isLoading={isLoading}
            />
          </PageTransition>
        )}

        {state.step === 'qr' && (
          <PageTransition key="receive-qr" variant="page" className="flex-1">
            <ReceiveQRStep
              onBack={() => goToStep('input')}
              onPaymentDetected={handlePaymentDetected}
              method={state.method}
              amount={state.amount}
              mintUrl={state.selectedMintUrl!}
              invoice={state.invoice}
              quoteId={state.quoteId}
              ecashRequest={state.ecashRequest}
              ecashRequestId={state.ecashRequestId}
              onSubscribeToQuote={onSubscribeToQuote}
            />
          </PageTransition>
        )}

        {state.step === 'complete' && (
          <PageTransition key="receive-complete" variant="fade" className="flex-1">
            <ReceiveCompleteStep
              amount={state.receivedAmount}
              mintUrl={state.selectedMintUrl}
              onComplete={onComplete}
            />
          </PageTransition>
        )}

        {state.step === 'token-confirm' && state.scannedToken && (
          <PageTransition key="token-confirm" variant="page" className="flex-1">
            <TokenConfirmStep
              onBack={() => goToStep('token-receive')}
              onReceive={handleTokenReceive}
              token={state.scannedToken}
            />
          </PageTransition>
        )}

        {state.step === 'untrusted-mint' && state.scannedToken && (
          <PageTransition key="untrusted-mint" variant="page" className="flex-1">
            <UntrustedMintStep
              onBack={() => goToStep('token-receive')}
              onAddAndReceive={handleAddTrustAndReceive}
              onSwapToMyMint={handleSwapToMyMint}
              token={state.scannedToken}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
