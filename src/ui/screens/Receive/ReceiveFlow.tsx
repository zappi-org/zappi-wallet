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
import { formatSats } from '@/utils/format'
import { translateError } from '@/ui/utils/error-i18n'
import type { ValidatedData, ValidatedCashuToken } from '@/core/domain/input-types'

/** Check if an error indicates a token was already spent */
function isAlreadySpentError(error?: { code?: string; message?: string } | null): boolean {
  if (error?.code === 'TOKEN_SPENT') return true
  const msg = error?.message?.toLowerCase() || ''
  return msg.includes('already spent') || msg.includes('token spent')
}

/** Get user-facing error message for token receive failures */
function getTokenErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  t: (key: string) => string,
): string {
  if (isAlreadySpentError(error)) return t('payment.tokenAlreadySpent')
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
  onReceiveToken: (token: string) => Promise<{ success: boolean; amount?: number; error?: { code?: string; message?: string } }>
  onAddTrustedMint: (mintUrl: string) => Promise<boolean>
  onSwapReceive: (token: string, sourceMintUrl: string, targetMintUrl: string, amount: number) => Promise<{ success: boolean; amount?: number; error?: { code?: string; message?: string } }>
  onEstimateSwapFee: (fromMintUrl: string, toMintUrl: string, amount: number) => Promise<{ fee: number; totalNeeded: number } | null>
  onStoreOfflineToken: (token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing') => Promise<{ success: boolean }>
  onInspectInput?: (tokenStr: string) => Promise<InputInspectionResult>
  onEstimateRedeemFee?: (token: string) => Promise<{ grossAmount: number; fee: number; netAmount: number } | null>
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
  onSwapReceive,
  onEstimateSwapFee: _onEstimateSwapFee,
  onStoreOfflineToken,
  onInspectInput,
  onEstimateRedeemFee,
  validatedData: initialValidatedData,
  initialAmount,
  initialMintUrl,
}: ReceiveFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)
  const settings = useAppStore((s) => s.settings)
  const receiveReq = useReceiveRequest()

  // Determine initial step from validatedData
  const getInitialStep = (): ReceiveStep => {
    if (initialValidatedData?.type === 'cashu-token') {
      const isTrusted = settings.mints.includes(initialValidatedData.mintUrl)
      return isTrusted ? 'token-confirm' : 'untrusted-mint'
    }
    return 'token-input'
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
    httpEndpoint: null,
    receiveRequestId: null,
    scannedToken: initialValidatedData?.type === 'cashu-token' ? initialValidatedData : null,
    isTrustedMint: initialValidatedData?.type === 'cashu-token'
      ? settings.mints.includes(initialValidatedData.mintUrl)
      : false,
    inspection: null,
    receivedAmount: 0,
  })

  const [isLoading, setIsLoading] = useState(false)
  const isProcessingRef = useRef(false)

  // ============= Redeem fee estimation =============

  const [redeemFeeEstimate, setRedeemFeeEstimate] = useState<{
    grossAmount: number
    fee: number
    netAmount: number
  } | null>(null)

  useEffect(() => {
    if (!state.scannedToken || !onEstimateRedeemFee) return
    setRedeemFeeEstimate(null)
    onEstimateRedeemFee(state.scannedToken.token)
      .then((estimate) => setRedeemFeeEstimate(estimate))
      .catch(() => setRedeemFeeEstimate(null))
  }, [state.scannedToken, onEstimateRedeemFee])

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
      if (invoiceResult) {
        const requestId = crypto.randomUUID()

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
            quoteId: invoiceResult.quoteId,
            bolt11: invoiceResult.invoice,
            ecashRequest: data.ecashRequest,
            ecashRequestId: data.ecashRequestId,
            httpEndpoint: data.httpEndpoint || undefined,
            bip321Uri,
          })
          receiveRequestId = requestId
        } catch (err) {
          console.error('[ReceiveFlow] Failed to persist ReceiveRequest:', err)
        }
      }

      setState((prev) => ({
        ...prev,
        step: 'qr',
        method: 'lightning', // default; actual method determined at payment detection
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
  }, [isOnline, onCreateInvoice, addToast, t, receiveReq])

  /** Payment received → complete */
  const handlePaymentDetected = useCallback((amount: number, method: 'lightning' | 'ecash') => {
    onPaymentReceived(amount, method)
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
    const isTrusted = settings.mints.includes(token.mintUrl)

    // Only run inspection when offline (needed for P2PK offline receive decision)
    // Online flow doesn't need inspection — tokens are swapped with mint immediately
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

  /**
   * 크로스민트 스왑 실행 + 결과 처리 (성공/실패 복구) 공통 함수.
   * handleTokenReceive(크로스민트 분기)와 handleSwapToMyMint 양쪽에서 사용한다.
   */
  const executeCrossMintSwap = useCallback(async (
    token: ValidatedCashuToken,
    sourceMintUrl: string,
    targetMintUrl: string,
  ): Promise<void> => {
    const result = await onSwapReceive(token.token, sourceMintUrl, targetMintUrl, token.amountSats)

    if (result.success) {
      onPaymentReceived(result.amount || token.amountSats, 'ecash')
      setState((prev) => ({
        ...prev,
        step: 'complete',
        receivedAmount: result.amount || token.amountSats,
        selectedMintUrl: targetMintUrl,
      }))
    } else if (!isAlreadySpentError(result.error)) {
      // 스왑 실패했지만 토큰은 소스 민트에 수령됨.
      // 소스 민트가 settings에 없으면 자동 추가해 UI에서 잔액이 보이도록 한다.
      if (!settings.mints.includes(sourceMintUrl)) {
        await onAddTrustedMint(sourceMintUrl)
      }
      onPaymentReceived(token.amountSats, 'ecash')
      setState((prev) => ({
        ...prev,
        step: 'complete',
        receivedAmount: token.amountSats,
        selectedMintUrl: sourceMintUrl,
      }))
      addToast({
        type: 'error',
        message: t('receive.swapFailedButReceived', { amount: formatSats(token.amountSats) }),
        duration: 5000,
      })
    } else {
      addToast({ type: 'error', message: getTokenErrorMessage(result.error, t), duration: 3000 })
    }
  }, [onSwapReceive, onAddTrustedMint, onPaymentReceived, settings.mints, addToast, t])

  /** Token confirm → receive (handles same-mint, cross-mint swap, and offline P2PK) */
  const handleTokenReceive = useCallback(async (targetMintUrl?: string) => {
    if (isProcessingRef.current || !state.scannedToken) return

    const token = state.scannedToken
    const sourceMintUrl = token.mintUrl
    const effectiveTargetMint = targetMintUrl || sourceMintUrl
    const isCrossMintSwap = effectiveTargetMint !== sourceMintUrl

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
      if (isCrossMintSwap) {
        // Cross-mint swap: receive on source → swap to target via Lightning
        // fee check는 onSwapReceive 내부에서 redeem 이후에 수행된다.
        await executeCrossMintSwap(token, sourceMintUrl, effectiveTargetMint)
        return
      }

      // Same mint: direct receive
      const result = await onReceiveToken(token.token)

      if (result.success) {
        onPaymentReceived(result.amount || token.amountSats, 'ecash')
        setState((prev) => ({
          ...prev,
          step: 'complete',
          receivedAmount: result.amount || token.amountSats,
          selectedMintUrl: effectiveTargetMint,
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
  }, [state.scannedToken, state.inspection, isOnline, onReceiveToken, executeCrossMintSwap, onStoreOfflineToken, onPaymentReceived, addToast, t])

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

  /** Untrusted mint → swap to my mint (no need to add source as trusted) */
  const handleSwapToMyMint = useCallback(async (targetMintUrl: string) => {
    if (isProcessingRef.current || !state.scannedToken) return

    if (!isOnline) {
      addToast({ type: 'error', message: t('common.offlineRequired'), duration: 3000 })
      return
    }
    isProcessingRef.current = true

    try {
      const token = state.scannedToken

      await executeCrossMintSwap(token, token.mintUrl, targetMintUrl)
    } catch (err) {
      console.error('[ReceiveFlow] Swap to my mint error:', err)
      addToast({ type: 'error', message: translateError(err, t), duration: 3000 })
    } finally {
      isProcessingRef.current = false
    }
  }, [state.scannedToken, executeCrossMintSwap, isOnline, addToast, t])

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
              onReceive={handleTokenReceive}
              token={state.scannedToken}
              isOnline={isOnline}
              inspection={state.inspection}
              initialMintUrl={initialMintUrl}
              feeEstimate={redeemFeeEstimate}
            />
          </PageTransition>
        )}

        {state.step === 'untrusted-mint' && state.scannedToken && (
          <PageTransition key="untrusted-mint" variant="page" className="flex-1">
            <UntrustedMintStep
              onBack={() => goToStep('token-input')}
              onAddAndReceive={handleAddTrustAndReceive}
              onSwapToMyMint={handleSwapToMyMint}
              token={state.scannedToken}
              isOnline={isOnline}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
