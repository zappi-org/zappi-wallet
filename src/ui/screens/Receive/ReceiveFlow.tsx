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
import { useNetwork } from '@/hooks/use-network'
import { useAppStore } from '@/store'
import { selectP2pkPubkey } from '@/store/selectors'
import { useTranslation } from 'react-i18next'
import { getDecodedToken } from '@cashu/cashu-ts'
import { isP2PKLockedToUser } from '@/utils/token'
import { verifyTokenDleq, type DleqResult } from '@/utils/token'
import { getWalletCache } from '@/data/cache/wallet-cache'
import { formatSats } from '@/utils/format'
import type { ValidatedData, ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'

/** Check if an error indicates a token was already spent */
function isAlreadySpentError(error?: { code?: string; message?: string } | null): boolean {
  if (error?.code === 'TOKEN_SPENT') return true
  const msg = error?.message?.toLowerCase() || ''
  return msg.includes('already spent') || msg.includes('token spent')
}

/** Returns true if swap fee is too high (fee >= amount) and shows a toast */
async function checkSwapFeeTooHigh(
  onEstimateSwapFee: ReceiveFlowProps['onEstimateSwapFee'],
  sourceMint: string,
  targetMint: string,
  amount: number,
  addToast: (toast: { type: 'error'; message: string; duration: number }) => void,
  t: (key: string, opts?: Record<string, string>) => string,
): Promise<boolean> {
  const feeEstimate = await onEstimateSwapFee(sourceMint, targetMint, amount)
  if (feeEstimate && feeEstimate.fee >= amount) {
    addToast({
      type: 'error',
      message: t('receive.swapFeeTooHigh', { fee: formatSats(feeEstimate.fee), amount: formatSats(amount) }),
      duration: 5000,
    })
    return true
  }
  return false
}

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
  httpEndpoint: string | null
  // Token receive
  scannedToken: ValidatedCashuToken | null
  isTrustedMint: boolean
  dleqStatus: DleqResult | null
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
  onSwapReceive: (token: string, sourceMintUrl: string, targetMintUrl: string, amount: number) => Promise<{ success: boolean; amount?: number; error?: { code?: string; message?: string } }>
  onEstimateSwapFee: (fromMintUrl: string, toMintUrl: string, amount: number) => Promise<{ fee: number; totalNeeded: number } | null>
  onStoreOfflineToken: (token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing') => Promise<{ success: boolean }>
  onActivateListening?: () => void
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
  onSwapReceive,
  onEstimateSwapFee,
  onStoreOfflineToken,
  onActivateListening,
  validatedData: initialValidatedData,
  initialAmount,
  initialMintUrl,
}: ReceiveFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)
  const settings = useAppStore((s) => s.settings)
  const p2pkPubkey = useAppStore(selectP2pkPubkey)

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
    httpEndpoint: null,
    scannedToken: initialValidatedData?.type === 'cashu-token' ? initialValidatedData : null,
    isTrustedMint: initialValidatedData?.type === 'cashu-token'
      ? settings.mints.includes(initialValidatedData.mintUrl)
      : false,
    dleqStatus: null,
    receivedAmount: 0,
  })

  const [isLoading, setIsLoading] = useState(false)
  const isProcessingRef = useRef(false)

  // ============= DLEQ verification helper =============

  const runDleqCheck = useCallback(async (token: ValidatedCashuToken): Promise<DleqResult> => {
    try {
      const decoded = getDecodedToken(token.token)
      const walletCache = getWalletCache()

      // Pre-fetch wallet if cached
      let cachedWallet: Awaited<ReturnType<typeof walletCache.getWallet>> | undefined
      try {
        cachedWallet = await walletCache.getWallet(decoded.mint)
      } catch {
        // Wallet not cached or fetch failed — DLEQ will proceed without keyset
      }

      const result = await verifyTokenDleq(decoded, (mintUrl) => {
        // Only return if it's the wallet we already fetched
        if (cachedWallet && mintUrl === decoded.mint) {
          return cachedWallet
        }
        return undefined
      })
      return result
    } catch {
      return 'missing'
    }
  }, [])

  // Run DLEQ check for initial token (deeplink / pre-filled data)
  const initialDleqChecked = useRef(false)
  useEffect(() => {
    if (initialDleqChecked.current) return
    if (state.scannedToken && state.dleqStatus === null) {
      initialDleqChecked.current = true
      runDleqCheck(state.scannedToken).then((result) => {
        setState((prev) => ({ ...prev, dleqStatus: result }))
      })
    }
  }, [state.scannedToken, state.dleqStatus, runDleqCheck])

  // ============= Step Transitions =============

  /** Input → create invoice/request → QR step */
  const handleInputNext = useCallback(async (data: {
    method: ReceiveMethod
    amount: number
    mintUrl: string
    // For ecash: request + requestId already created in step
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
          httpEndpoint: data.httpEndpoint || null,
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
  const handleTokenDetected = useCallback(async (token: ValidatedCashuToken) => {
    const isTrusted = settings.mints.includes(token.mintUrl)

    // Only run DLEQ check when offline (needed for P2PK offline receive decision)
    // Online flow doesn't need DLEQ — tokens are swapped with mint immediately
    const dleqStatus = isOnline ? null : await runDleqCheck(token)

    setState((prev) => ({
      ...prev,
      scannedToken: token,
      isTrustedMint: isTrusted,
      amount: token.amountSats,
      dleqStatus,
      step: isTrusted ? 'token-confirm' : 'untrusted-mint',
    }))
  }, [settings.mints, runDleqCheck, isOnline])

  /** Token confirm → receive (handles same-mint, cross-mint swap, and offline P2PK) */
  const handleTokenReceive = useCallback(async (targetMintUrl?: string) => {
    if (isProcessingRef.current || !state.scannedToken) return

    const token = state.scannedToken
    const sourceMintUrl = token.mintUrl
    const effectiveTargetMint = targetMintUrl || sourceMintUrl
    const isCrossMintSwap = effectiveTargetMint !== sourceMintUrl

    // ── Offline flow ──
    if (!isOnline) {
      // Only P2PK tokens locked to user's key can be stored offline
      if (!p2pkPubkey || !isP2PKLockedToUser(token.token, p2pkPubkey)) {
        addToast({ type: 'error', message: t('receive.offline.nonP2PKError'), duration: 4000 })
        return
      }

      // DLEQ failed → reject
      if (state.dleqStatus === 'failed') {
        addToast({ type: 'error', message: t('receive.offline.dleqFailed'), duration: 4000 })
        return
      }

      // Store for later redemption
      isProcessingRef.current = true
      try {
        const dleq = state.dleqStatus === 'valid' ? 'valid' : 'missing'
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
      let result: { success: boolean; amount?: number; error?: { code?: string; message?: string } }

      if (isCrossMintSwap) {
        // Fee pre-check: estimate Lightning fee before committing
        if (await checkSwapFeeTooHigh(onEstimateSwapFee, sourceMintUrl, effectiveTargetMint, token.amountSats, addToast, t)) return
        // Cross-mint swap: receive on source → swap to target via Lightning
        result = await onSwapReceive(token.token, sourceMintUrl, effectiveTargetMint, token.amountSats)
      } else {
        // Same mint: direct receive
        result = await onReceiveToken(token.token)
      }

      if (result.success) {
        onPaymentReceived(result.amount || token.amountSats, 'ecash')
        setState((prev) => ({
          ...prev,
          step: 'complete',
          receivedAmount: result.amount || token.amountSats,
          selectedMintUrl: effectiveTargetMint,
        }))
      } else {
        const message = isAlreadySpentError(result.error)
          ? t('payment.tokenAlreadySpent')
          : result.error?.message || t('payment.tokenReceiveFailed')
        addToast({ type: 'error', message, duration: 3000 })
      }
    } catch (err) {
      console.error('[ReceiveFlow] Token receive error:', err)
      const message = isAlreadySpentError(err instanceof Error ? { message: err.message } : null)
        ? t('payment.tokenAlreadySpent')
        : t('payment.tokenReceiveFailed')
      addToast({ type: 'error', message, duration: 3000 })
    } finally {
      isProcessingRef.current = false
    }
  }, [state.scannedToken, state.dleqStatus, isOnline, p2pkPubkey, onReceiveToken, onSwapReceive, onEstimateSwapFee, onStoreOfflineToken, onPaymentReceived, addToast, t])

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
      addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
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

      // Fee pre-check: estimate Lightning fee before committing
      if (await checkSwapFeeTooHigh(onEstimateSwapFee, token.mintUrl, targetMintUrl, token.amountSats, addToast, t)) return

      const result = await onSwapReceive(token.token, token.mintUrl, targetMintUrl, token.amountSats)

      if (result.success) {
        onPaymentReceived(result.amount || token.amountSats, 'ecash')
        setState((prev) => ({
          ...prev,
          step: 'complete',
          receivedAmount: result.amount || token.amountSats,
          selectedMintUrl: targetMintUrl,
        }))
      } else {
        const message = isAlreadySpentError(result.error)
          ? t('payment.tokenAlreadySpent')
          : result.error?.message || t('payment.tokenReceiveFailed')
        addToast({ type: 'error', message, duration: 3000 })
      }
    } catch (err) {
      console.error('[ReceiveFlow] Swap to my mint error:', err)
      addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
    } finally {
      isProcessingRef.current = false
    }
  }, [state.scannedToken, onSwapReceive, onEstimateSwapFee, onPaymentReceived, isOnline, addToast, t])

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
              onActivateListening={onActivateListening}
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
              httpEndpoint={state.httpEndpoint}
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
              isOnline={isOnline}
              dleqStatus={state.dleqStatus}
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
              isOnline={isOnline}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
