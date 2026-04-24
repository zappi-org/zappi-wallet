/**
 * ReceiveFlow — Unified receive flow container
 * Manages internal step state machine for all receive operations:
 * - Lightning receive (invoice generation + payment subscription)
 * - Ecash receive (NUT-18 payment request via Nostr)
 * - Token receive (QR scan/paste + trust verification)
 * - Cross-mint swap (receive on source mint, swap to target)
 * - Offline P2PK token storage (DLEQ verified, redeemed on online recovery)
 *
 * Business logic stays in MainApp handlers (passed as props).
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useNetwork } from '@/ui/hooks/use-network'
import { useAppStore } from '@/store'
import { useTranslation } from 'react-i18next'
import type { InputInspectionResult } from '@/core/ports/driving/payment.usecase'
import { normalizeMintUrl } from '@/utils/url'
import { translateError } from '@/ui/utils/error-i18n'
import type { ValidatedData, ValidatedCashuToken } from '@/core/domain/input-types'
import type { PendingIncomingReview } from '@/core/types'

/** Check if an error indicates a token was already spent */
function isAlreadySpentError(error?: { code?: string; message?: string } | null): boolean {
  if (error?.code === 'TOKEN_SPENT') return true
  const msg = error?.message?.toLowerCase() || ''
  return msg.includes('already spent') || msg.includes('token spent')
}

function isRedeemFeeTooHighError(error?: { code?: string; message?: string } | null): boolean {
  const msg = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return (
    error?.code === 'REDEEM_FEE_TOO_HIGH' ||
    msg.includes('receive amount is not sufficient after fees') ||
    (msg.includes('after fees') && (msg.includes('not sufficient') || msg.includes('insufficient') || msg.includes('not enough')))
  )
}

function hasConfiguredMint(mints: readonly string[], mintUrl: string): boolean {
  const normalizedMintUrl = normalizeMintUrl(mintUrl)
  return mints.some((mint) => normalizeMintUrl(mint) === normalizedMintUrl)
}

/** Get user-facing error message for token receive failures */
function getTokenErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (isAlreadySpentError(error)) return t('payment.tokenAlreadySpent')
  if (isRedeemFeeTooHighError(error)) return t('receive.tokenReceiveFeeTooHigh')
  if (error?.code === 'SWAP_FEE_TOO_HIGH' || error?.code === 'FEE_TOO_HIGH') return t('receive.swapTokenTooSmall')
  if (error?.code === 'SWAP_ESTIMATE_FAILED') return t('receive.swapEstimateFailed')
  return error?.message || t('payment.tokenReceiveFailed')
}


import { useReceiveRequest } from '@/ui/hooks/use-receive-request'
import { TokenReceiveStep } from './steps/TokenReceiveStep'
import { ReceiveInputStep } from './steps/ReceiveInputStep'
import { ReceiveQRStep } from './steps/ReceiveQRStep'
import { ReceiveCompleteStep } from './steps/ReceiveCompleteStep'
import { TokenConfirmStep } from './steps/TokenConfirmStep'
import { UntrustedMintStep } from './steps/UntrustedMintStep'

// ============= Types =============

export type ReceiveStep =
  | 'token-input'
  | 'amount'
  | 'qr'
  | 'complete'
  | 'token-confirm'
  | 'untrusted-mint'

export type ReceiveMethod = 'ecash' | 'bolt11'

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
  httpEndpoint: string | null
  // Receive request entity
  receiveRequestId: string | null
  // Token receive
  scannedToken: ValidatedCashuToken | null
  isTrustedMint: boolean
  inspection: InputInspectionResult | null
  // Result
  receivedAmount: number
}

export interface ReceiveFlowProps {
  onBack: () => void
  onComplete: () => void
  onRedirect?: (validatedData: ValidatedData) => void
  // MainApp handlers
  onCreateInvoice: (amount: number, mintUrl: string) => Promise<{
    invoice: string
    quoteId: string
    expiry: number
  } | null>
  onPaymentReceived: (amount: number, type: 'lightning' | 'ecash') => void
  onReceiveToken: (token: string) => Promise<{ success: boolean; amount?: number; transactionId?: string; error?: { code?: string; message?: string } }>
  onAddTrustedMint: (mintUrl: string) => Promise<boolean>
  onStoreOfflineToken: (token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing') => Promise<{ success: boolean }>
  onInspectInput?: (tokenStr: string) => Promise<InputInspectionResult>
  incomingReview?: PendingIncomingReview | null
  onResolveIncomingReview?: (params: {
    review: PendingIncomingReview
    transactionId?: string
  }) => Promise<void>
  onRejectIncomingReview?: (review: PendingIncomingReview) => Promise<void>
  // Pre-filled data
  validatedData?: ValidatedData
  initialAmount?: number
  initialMintUrl?: string | null
}

// ============= Component =============

export function ReceiveFlow({
  onBack,
  onComplete,
  onRedirect,
  onCreateInvoice,
  onPaymentReceived,
  onReceiveToken,
  onAddTrustedMint,
  onStoreOfflineToken,
  onInspectInput,
  incomingReview = null,
  onResolveIncomingReview,
  onRejectIncomingReview,
  validatedData: initialValidatedData,
  initialAmount,
  initialMintUrl,
}: ReceiveFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)
  const addPendingQuote = useAppStore((s) => s.addPendingQuote)
  const settings = useAppStore((s) => s.settings)
  const receiveReq = useReceiveRequest()

  // Determine initial step from validatedData
  const getInitialStep = (): ReceiveStep => {
    if (initialValidatedData?.type === 'cashu-token') {
      const isTrusted = hasConfiguredMint(settings.mints, initialValidatedData.mintUrl)
      return isTrusted ? 'token-confirm' : 'untrusted-mint'
    }
    return 'token-input'
  }

  const [state, setState] = useState<ReceiveFlowState>({
    step: getInitialStep(),
    method: 'bolt11',
    selectedMintUrl: initialMintUrl || null,
    amount: initialAmount || (initialValidatedData?.type === 'cashu-token' ? initialValidatedData.amountSats : 0),
    invoice: null,
    quoteId: null,
    quoteExpiry: null,
    ecashRequest: null,
    ecashRequestId: null,
    httpEndpoint: null,
    receiveRequestId: null,
    scannedToken: initialValidatedData?.type === 'cashu-token' ? initialValidatedData : null,
    isTrustedMint: initialValidatedData?.type === 'cashu-token'
      ? hasConfiguredMint(settings.mints, initialValidatedData.mintUrl)
      : false,
    inspection: null,
    receivedAmount: 0,
  })

  const [isLoading, setIsLoading] = useState(false)
  const isProcessingRef = useRef(false)

  // ============= Token inspection helper =============

  const runInspection = useCallback(async (token: ValidatedCashuToken): Promise<InputInspectionResult> => {
    if (onInspectInput) {
      return onInspectInput(token.token)
    }
    return { lockStatus: 'not-supported', proofIntegrity: 'not-supported' }
  }, [onInspectInput])

  // Run inspection for initial token (deeplink / pre-filled data)
  const initialInspectionDone = useRef(false)
  useEffect(() => {
    if (initialInspectionDone.current) return
    if (state.scannedToken && state.inspection === null) {
      initialInspectionDone.current = true
      runInspection(state.scannedToken).then((result) => {
        setState((prev) => ({ ...prev, inspection: result }))
      })
    }
  }, [state.scannedToken, state.inspection, runInspection])

  // ============= Step Transitions =============

  /** Input → create Lightning invoice + use ecash data → QR step (unified) */
  const handleInputNext = useCallback(async (data: {
    amount: number
    mintUrl: string
    ecashRequest?: string
    ecashRequestId?: string
    httpEndpoint?: string
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
      // Always create Lightning invoice
      const invoiceResult = await onCreateInvoice(data.amount, data.mintUrl)

      // If Lightning invoice creation fails but we have ecash request, still proceed
      if (!invoiceResult && !data.ecashRequest) {
        addToast({ type: 'error', message: t('payment.createInvoiceFailed'), duration: 3000 })
        isProcessingRef.current = false
        setIsLoading(false)
        return
      }

      const invoice = invoiceResult?.invoice || null
      const ecashReq = data.ecashRequest || null

      // Persist as ReceiveRequest entity (source of truth for pending display)
      let receiveRequestId: string | null = null
      if (invoiceResult || ecashReq) {
        const requestId = crypto.randomUUID()
        const expiresAt = invoiceResult?.expiry
          ? invoiceResult.expiry * 1000
          : Date.now() + 30 * 60 * 1000

        // Build BIP-321 unified URI if both Lightning + ecash available
        let bip321Uri: string | undefined
        if (invoice && ecashReq) {
          const params = new URLSearchParams()
          params.set('lightning', invoice)
          params.set('cr', ecashReq)
          bip321Uri = `bitcoin:?${params.toString()}`
        }

        try {
          await receiveReq.create({
            requestId,
            accountId: data.mintUrl,
            amount: { value: BigInt(data.amount), unit: 'sat' },
            quoteId: invoiceResult?.quoteId,
            bolt11: invoiceResult?.invoice,
            ecashRequest: data.ecashRequest,
            ecashRequestId: data.ecashRequestId,
            httpEndpoint: data.httpEndpoint || undefined,
            bip321Uri,
            expiresAt,
          })
          receiveRequestId = requestId
        } catch (err) {
          console.error('[ReceiveFlow] Failed to persist ReceiveRequest:', err)
          addToast({ type: 'error', message: translateError(err, t), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }

        if (invoiceResult) {
          addPendingQuote({
            quoteId: invoiceResult.quoteId,
            mintUrl: data.mintUrl,
            amount: data.amount,
            invoice: invoiceResult.invoice,
            expiry: expiresAt,
          })
        }
      }

      setState((prev) => ({
        ...prev,
        step: 'qr',
        method: 'bolt11', // default; actual method determined at payment detection
        amount: data.amount,
        selectedMintUrl: data.mintUrl,
        // Lightning data
        invoice,
        quoteId: invoiceResult?.quoteId || null,
        quoteExpiry: invoiceResult?.expiry || null,
        // Ecash data (always present when Nostr is available)
        ecashRequest: ecashReq,
        ecashRequestId: data.ecashRequestId || null,
        httpEndpoint: data.httpEndpoint || null,
        // ReceiveRequest entity (null if DB write failed)
        receiveRequestId,
      }))
    } catch (err) {
      console.error('[ReceiveFlow] Input next error:', err)
      addToast({ type: 'error', message: translateError(err, t), duration: 3000 })
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [isOnline, onCreateInvoice, addToast, addPendingQuote, t, receiveReq])

  /** Payment received → complete */
  const handlePaymentDetected = useCallback((amount: number, method: 'bolt11' | 'ecash') => {
    onPaymentReceived(amount, method === 'bolt11' ? 'lightning' : 'ecash')
    setState((prev) => {
      if (prev.receiveRequestId) {
        void receiveReq.complete(prev.receiveRequestId, method)
          .catch((err: unknown) => console.error('[ReceiveFlow] Failed to complete ReceiveRequest:', err))
      }
      return {
        ...prev,
        step: 'complete',
        method,
        receivedAmount: amount,
      }
    })
  }, [onPaymentReceived, receiveReq])

  /** Token scanned from TokenReceiveBottomSheet */
  const handleTokenDetected = useCallback(async (token: ValidatedCashuToken) => {
    const isTrusted = hasConfiguredMint(settings.mints, token.mintUrl)

    // Only run inspection when offline (needed for P2PK offline receive decision)
    // Online flow doesn't need inspection because the token is redeemed with the mint immediately.
    const inspection = isOnline ? null : await runInspection(token)

    setState((prev) => ({
      ...prev,
      scannedToken: token,
      isTrustedMint: isTrusted,
      amount: token.amountSats,
      inspection,
      step: isTrusted ? 'token-confirm' : 'untrusted-mint',
    }))
  }, [settings.mints, runInspection, isOnline])

  const resolveIncomingReview = useCallback(async (transactionId?: string) => {
    if (!incomingReview || !onResolveIncomingReview) return

    try {
      await onResolveIncomingReview({ review: incomingReview, transactionId })
    } catch (error) {
      console.error('[ReceiveFlow] Failed to resolve incoming review:', error)
    }
  }, [incomingReview, onResolveIncomingReview])

  const handleRejectToken = useCallback(async () => {
    if (incomingReview && onRejectIncomingReview) {
      await onRejectIncomingReview(incomingReview)
      return
    }

    setState((prev) => ({
      ...prev,
      step: 'token-input',
      scannedToken: null,
      inspection: null,
      isTrustedMint: false,
    }))
  }, [incomingReview, onRejectIncomingReview])

  /** Token confirm → receive at the token mint (or store offline P2PK for later) */
  const handleTokenReceive = useCallback(async () => {
    if (isProcessingRef.current || !state.scannedToken) return

    const token = state.scannedToken
    const sourceMintUrl = token.mintUrl

    // ── Offline flow ──
    if (!isOnline) {
      // Only tokens locked to recipient can be stored offline
      if (!state.inspection || state.inspection.lockStatus !== 'locked-to-recipient') {
        addToast({ type: 'error', message: t('receive.offline.nonP2PKError'), duration: 4000 })
        return
      }

      // Proof integrity failed → reject
      if (state.inspection.proofIntegrity === 'invalid') {
        addToast({ type: 'error', message: t('receive.offline.dleqFailed'), duration: 4000 })
        return
      }

      // Store for later redemption
      isProcessingRef.current = true
      try {
        const dleq = state.inspection.proofIntegrity === 'verified' ? 'valid' : 'missing'
        const storeResult = await onStoreOfflineToken(token.token, token.amountSats, sourceMintUrl, dleq)
        if (storeResult.success) {
          onPaymentReceived(token.amountSats, 'ecash')
          setState((prev) => ({
            ...prev,
            step: 'complete',
            receivedAmount: token.amountSats,
          }))
        } else {
          addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
        }
      } finally {
        isProcessingRef.current = false
      }
      return
    }

    // ── Online flow ──
    isProcessingRef.current = true

    try {
      // Direct receive: token receive never changes mint implicitly.
      const result = await onReceiveToken(token.token)

      if (result.success) {
        const receivedAmount = result.amount ?? token.amountSats
        onPaymentReceived(receivedAmount, 'ecash')
        await resolveIncomingReview(result.transactionId)
        setState((prev) => ({
          ...prev,
          step: 'complete',
          receivedAmount,
          selectedMintUrl: sourceMintUrl,
        }))
      } else {
        addToast({ type: 'error', message: getTokenErrorMessage(result.error, t), duration: 3000 })
      }
    } catch (err) {
      console.error('[ReceiveFlow] Token receive error:', err)
      addToast({ type: 'error', message: getTokenErrorMessage(err instanceof Error ? { message: err.message } : null, t), duration: 3000 })
    } finally {
      isProcessingRef.current = false
    }
  }, [state.scannedToken, state.inspection, isOnline, onReceiveToken, onStoreOfflineToken, onPaymentReceived, addToast, t, resolveIncomingReview])

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
      // Now receive the token (same mint, no swap needed)
      isProcessingRef.current = false // handleTokenReceive checks this
      await handleTokenReceive()
    } catch (err) {
      console.error('[ReceiveFlow] Add trust error:', err)
      addToast({ type: 'error', message: translateError(err, t), duration: 3000 })
      isProcessingRef.current = false
    }
  }, [state.scannedToken, onAddTrustedMint, handleTokenReceive, isOnline, addToast, t])

  // ============= Navigation =============

  const goToStep = useCallback((step: ReceiveStep) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  // ============= Render =============

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {state.step === 'token-input' && (
          <PageTransition key="token-input" variant="page" className="flex-1">
            <TokenReceiveStep
              onBack={onBack}
              onTokenDetected={handleTokenDetected}
              onNext={() => goToStep('amount')}
              mintUrl={state.selectedMintUrl || settings.mints[0]}
              onRedirect={onRedirect}
            />
          </PageTransition>
        )}

        {state.step === 'amount' && (
          <PageTransition key="receive-amount" variant="page" className="flex-1">
            <ReceiveInputStep
              onBack={() => setState(prev => ({ ...prev, step: 'token-input' }))}
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
              onBack={() => goToStep('amount')}
              onPaymentDetected={handlePaymentDetected}
              amount={state.amount}
              mintUrl={state.selectedMintUrl!}
              invoice={state.invoice}
              quoteId={state.quoteId}
              ecashRequest={state.ecashRequest}
              ecashRequestId={state.ecashRequestId}
              httpEndpoint={state.httpEndpoint}
              onReceiveP2PKToken={async (token, _privkey) => {
                const result = await onReceiveToken(token)
                return { amount: result?.amount ?? 0 }
              }}
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
              onBack={() => goToStep('token-input')}
              onReject={handleRejectToken}
              onReceive={handleTokenReceive}
              token={state.scannedToken}
              isOnline={isOnline}
              inspection={state.inspection}
            />
          </PageTransition>
        )}

        {state.step === 'untrusted-mint' && state.scannedToken && (
          <PageTransition key="untrusted-mint" variant="page" className="flex-1">
            <UntrustedMintStep
              onBack={handleRejectToken}
              onReject={handleRejectToken}
              onAddAndReceive={handleAddTrustAndReceive}
              token={state.scannedToken}
              isOnline={isOnline}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
