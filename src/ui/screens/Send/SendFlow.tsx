/**
 * SendFlow — Unified send flow container
 * Manages internal step state machine for all send operations:
 * - Lightning send (bolt11, lightning-address, lnurl-pay)
 * - Ecash send (NUT-18 cashu-request via Nostr DM)
 * - Token create (create + QR share)
 *
 * Business logic stays in MainApp handlers (passed as props).
 * This component is purely UI + step management.
 */

import { useState, useCallback, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useNetwork } from '@/hooks/use-network'
import { useAppStore } from '@/store'
import { useTranslation } from 'react-i18next'
import { InsufficientBalanceError } from '@/core/errors/cashu'
import { translateError } from '@/core/errors/translate'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
import {
  validateInput,
  type ValidatedData,
  type ValidatedBolt11,
  type ValidatedLightningAddress,
  type ValidatedLnurlPay,
  type ValidatedCashuRequest,
  type ValidatedMyWallet,
} from '@/ui/components/scanner/InputValidator'
import {
  selectRoute,
  selectSourceMint,
  findCommonMints,
  estimateRouteFee,
  PaymentRoute,
  ROUTE_LABELS,
  type RouteSelection,
  type RouteContext,
  type RouteExecutionResult,
} from '@/services/payment/routing'
import { getBalances as cocoGetBalances } from '@/coco/cashuService'

// ============= Helpers =============

function getAddressOrInvoice(data: SendableValidatedData): string | undefined {
  switch (data.type) {
    case 'bolt11': return data.invoice
    case 'lightning-address': return data.address
    case 'lnurl-pay': return data.lnurl
    default: return undefined
  }
}

import { SendInputStep } from './steps/SendInputStep'
import { TokenCreateStep } from './steps/TokenCreateStep'
import { TokenCreatedStep } from './steps/TokenCreatedStep'
import { SendConfirmStep } from './steps/SendConfirmStep'
import { SendingStep } from './steps/SendingStep'
import { SendCompleteStep } from './steps/SendCompleteStep'

// ============= Types =============

export type SendStep =
  | 'input'
  | 'token-create'
  | 'token-created'
  | 'confirm'
  | 'sending'
  | 'complete'

/** Validated data types that are "sendable" (not token, not amount) */
export type SendableValidatedData =
  | ValidatedBolt11
  | ValidatedLightningAddress
  | ValidatedLnurlPay
  | ValidatedCashuRequest
  | ValidatedMyWallet

export interface SendFlowState {
  step: SendStep
  selectedMintUrl: string | null
  destination: string
  validatedData: SendableValidatedData | null
  amount: number
  memo: string
  createdToken: string | null
  createdTxId: string | null
  createdOperationId: string | null
  fee: number
  error: string | null
  // NUT-18 specific
  dmSent: boolean
  // Routing
  routeSelection: RouteSelection | null
}

export interface SendFlowProps {
  onBack: () => void
  onComplete: () => void
  // Routing-based send handler (primary)
  onExecuteRoute: (selection: RouteSelection, context: RouteContext) => Promise<RouteExecutionResult | null>
  // Token create handler (for token-create step only, not routing)
  onCreateEcashToken: (amount: number, mintUrl?: string, options?: { p2pkPubkey?: string; memo?: string }) => Promise<{ token: string; txId: string; operationId: string } | null>
  onCompleteEcashSend?: (txId: string) => Promise<void>
  onCancelEcashToken?: (txId: string) => Promise<void>
  // Pre-filled data from scanner
  validatedData?: ValidatedData
  initialAmount?: number
  initialMintUrl?: string | null
  // Direct entry to token-create step (from HomeScreen token button)
  initialStep?: 'input' | 'token-create'
}

// ============= Component =============

export function SendFlow({
  onBack,
  onComplete,
  onExecuteRoute,
  onCreateEcashToken,
  onCompleteEcashSend: _onCompleteEcashSend,
  onCancelEcashToken,
  validatedData: initialValidatedData,
  initialAmount,
  initialMintUrl,
  initialStep = 'input',
}: SendFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)

  // Determine initial destination from validatedData
  const getInitialDestination = (): string => {
    if (!initialValidatedData) return ''
    switch (initialValidatedData.type) {
      case 'bolt11': return initialValidatedData.invoice
      case 'lightning-address': return initialValidatedData.address
      case 'lnurl-pay': return initialValidatedData.lnurl
      case 'cashu-request': return initialValidatedData.request
      default: return ''
    }
  }

  const getInitialAmount = (): number => {
    if (initialAmount) return initialAmount
    if (!initialValidatedData) return 0
    switch (initialValidatedData.type) {
      case 'bolt11': return initialValidatedData.amountSats
      case 'cashu-request': return initialValidatedData.parsed.amount || 0
      default: return 0
    }
  }

  const isSendableData = (data?: ValidatedData): data is SendableValidatedData => {
    if (!data) return false
    return ['bolt11', 'lightning-address', 'lnurl-pay', 'cashu-request', 'my-wallet'].includes(data.type)
  }

  // Flow state
  const [state, setState] = useState<SendFlowState>({
    step: initialStep,
    selectedMintUrl: initialMintUrl || null,
    destination: getInitialDestination(),
    validatedData: isSendableData(initialValidatedData) ? initialValidatedData : null,
    amount: getInitialAmount(),
    memo: '',
    createdToken: null,
    createdTxId: null,
    createdOperationId: null,
    fee: 0,
    error: null,
    dmSent: false,
    routeSelection: null,
  })

  // Loading state for async operations
  const [isLoading, setIsLoading] = useState(false)

  // Prevent double-tap
  const isProcessingRef = useRef(false)

  // ============= Step Transitions =============

  /** Input step → validate & get fee quote → confirm step */
  const handleInputNext = useCallback(async (data: {
    destination: string
    amount: number
    selectedMintUrl: string
    validatedData?: SendableValidatedData
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
      // If no validatedData, detect and validate the destination
      let validated = data.validatedData
      if (!validated) {
        const detected = detectInputType(data.destination)
        if (detected.type === 'unknown') {
          addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }
        const result = await validateInput(detected)
        if (!result.valid) {
          addToast({ type: 'error', message: result.error, duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }
        if (!isSendableData(result.data)) {
          addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }
        validated = result.data
      }

      // Route selection + fee estimation
      let fee = 0
      let routeSel: RouteSelection | null = null

      try {
        const balances = await cocoGetBalances()
        const route = selectRoute({
          validatedData: validated,
          senderMints: balances,
          amount: data.amount,
          privacyMode: useAppStore.getState().settings.senderPrivacyMode ?? false,
          lightningInvoice: validated.type === 'cashu-request' ? validated.parsed.lightningInvoice : undefined,
        })

        if (route === PaymentRoute.CANNOT_SEND) {
          addToast({ type: 'error', message: t('payment.cannotSend'), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }

        // Determine source + target mints
        const commonMints = validated.type === 'cashu-request' && validated.parsed.mints.length > 0
          ? findCommonMints(Object.keys(balances).filter((m) => balances[m] > 0), validated.parsed.mints)
          : []
        const sourceMint = selectSourceMint(route, balances, data.amount, commonMints) || data.selectedMintUrl

        let targetMint: string | undefined
        if (route === PaymentRoute.TOKEN_TRANSFER || route === PaymentRoute.LN_INTERNAL) {
          targetMint = commonMints[0]
        } else if (route === PaymentRoute.LN_CROSS_MINT || route === PaymentRoute.MINT_AND_DM) {
          targetMint = validated.type === 'cashu-request' ? validated.parsed.mints[0]
            : validated.type === 'my-wallet' ? validated.targetMintUrl
            : undefined
        }

        // Resolve invoice for LN routes
        let invoice: string | undefined
        if (validated.type === 'bolt11') invoice = validated.invoice
        else if (validated.type === 'cashu-request') invoice = validated.parsed.lightningInvoice

        // Fee estimation
        const feeEstimate = await estimateRouteFee(route, sourceMint, data.amount, targetMint, invoice)
        fee = feeEstimate.fee

        routeSel = {
          route,
          amount: data.amount,
          sourceMintUrl: sourceMint,
          targetMintUrl: targetMint,
          invoice,
          estimatedFee: fee,
          reason: ROUTE_LABELS[route],
        }

        console.log(`[SendFlow] Route selected: #${route} ${ROUTE_LABELS[route]} (fee: ${fee} sat)`)
      } catch (err) {
        console.error('[SendFlow] Route selection / fee estimation failed:', err)
        addToast({ type: 'error', message: t('payment.feeEstimateFailed'), duration: 3000 })
        isProcessingRef.current = false
        setIsLoading(false)
        return
      }

      setState((prev) => ({
        ...prev,
        step: 'confirm',
        destination: data.destination,
        amount: data.amount,
        selectedMintUrl: data.selectedMintUrl,
        validatedData: validated!,
        fee,
            routeSelection: routeSel,
        error: null,
      }))
    } catch (err) {
      console.error('[SendFlow] Input validation error:', err)
      addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [isOnline, addToast, t])

  /** Confirm step → execute send via routing layer */
  const handleConfirmSend = useCallback(async () => {
    if (isProcessingRef.current || !state.validatedData || !state.selectedMintUrl || !state.routeSelection) return

    if (!isOnline) {
      addToast({ type: 'error', message: t('common.offlineRequired'), duration: 3000 })
      return
    }
    isProcessingRef.current = true

    setState((prev) => ({ ...prev, step: 'sending', error: null }))

    try {
      const { validatedData, routeSelection, memo } = state

      // Build route context
      const storeState = useAppStore.getState()
      const context: RouteContext = {
        parsedCreq: validatedData.type === 'cashu-request' ? validatedData.parsed : undefined,
        nostrPrivkey: storeState.nostrPrivkey || undefined,
        relays: storeState.settings.relays || [],
        memo: memo || (validatedData.type === 'cashu-request' ? validatedData.parsed.description : undefined),
        addressOrInvoice: getAddressOrInvoice(validatedData),
      }

      const result = await onExecuteRoute(routeSelection, context)

      if (result?.success) {
        if (result.transportUsed === 'nostr') {
          setState((prev) => ({ ...prev, dmSent: true }))
        }
        setState((prev) => ({ ...prev, step: 'complete' }))
      } else {
        setState((prev) => ({
          ...prev,
          step: 'confirm',
          error: t('payment.sendFailed'),
        }))
        addToast({ type: 'error', message: t('payment.sendFailed'), duration: 3000 })
      }
    } catch (err) {
      console.error('[SendFlow] Send error:', err)
      const message = err instanceof InsufficientBalanceError
        ? translateError(err)
        : t('payment.sendFailed')
      setState((prev) => ({ ...prev, step: 'confirm', error: message }))
      addToast({ type: 'error', message, duration: err instanceof InsufficientBalanceError ? 4000 : 3000 })
    } finally {
      isProcessingRef.current = false
    }
  }, [state, onExecuteRoute, isOnline, addToast, t])

  /** Token create step → create token */
  const handleTokenCreate = useCallback(async (data: {
    amount: number
    mintUrl: string
    memo: string
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
      const result = await onCreateEcashToken(data.amount, data.mintUrl, {
        memo: data.memo || undefined,
      })

      if (result) {
        setState((prev) => ({
          ...prev,
          step: 'token-created',
          createdToken: result.token,
          createdTxId: result.txId,
          createdOperationId: result.operationId,
          amount: data.amount,
          selectedMintUrl: data.mintUrl,
          memo: data.memo,
        }))
      } else {
        addToast({ type: 'error', message: t('payment.tokenCreateFailed'), duration: 3000 })
      }
    } catch (err) {
      console.error('[SendFlow] Token create error:', err)
      const message = err instanceof InsufficientBalanceError
        ? translateError(err)
        : t('errors.generic')
      addToast({ type: 'error', message, duration: err instanceof InsufficientBalanceError ? 4000 : 3000 })
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [isOnline, onCreateEcashToken, addToast, t])

  /** Token created → cancel (reclaim token via SDK rollback) */
  const handleTokenCancel = useCallback(async () => {
    if (!state.createdTxId) return

    try {
      // SDK rollback이 proof 회수 + 이벤트 발행을 원자적으로 처리
      await onCancelEcashToken?.(state.createdTxId)
      setState((prev) => ({
        ...prev,
        step: 'token-create',
        createdToken: null,
        createdTxId: null,
        createdOperationId: null,
      }))
    } catch {
      addToast({ type: 'error', message: t('payment.tokenReclaimFailed'), duration: 3000 })
    }
  }, [state.createdTxId, onCancelEcashToken, addToast, t])

  // ============= Navigation helpers =============

  const goToStep = useCallback((step: SendStep) => {
    setState((prev) => ({ ...prev, step, error: null }))
  }, [])


  // ============= Render =============

  return (
    <div className="h-dvh bg-background text-foreground font-sans flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {state.step === 'input' && (
          <PageTransition key="send-input" variant="page" className="flex-1">
            <SendInputStep
              onBack={onBack}
              onNext={handleInputNext}
              onGoToTokenCreate={() => goToStep('token-create')}
              initialDestination={state.destination}
              initialAmount={state.amount}
              initialMintUrl={state.selectedMintUrl}
              initialValidatedData={state.validatedData}
              isLoading={isLoading}
            />
          </PageTransition>
        )}

        {state.step === 'token-create' && (
          <PageTransition key="token-create" variant="page" className="flex-1">
            <TokenCreateStep
              onBack={onBack}
              onNext={handleTokenCreate}
              initialAmount={state.amount}
              initialMintUrl={state.selectedMintUrl}
              isLoading={isLoading}
            />
          </PageTransition>
        )}

        {state.step === 'token-created' && (
          <PageTransition key="token-created" variant="page" className="flex-1">
            <TokenCreatedStep
              token={state.createdToken!}
              amount={state.amount}
              operationId={state.createdOperationId ?? undefined}
              onCancel={handleTokenCancel}
              onComplete={onComplete}
            />
          </PageTransition>
        )}

        {state.step === 'confirm' && (
          <PageTransition key="send-confirm" variant="page" className="flex-1">
            <SendConfirmStep
              onBack={() => {
                setState((prev) => ({
                  ...prev,
                  step: 'input',
                  validatedData: null,
                  destination: '',
                  fee: 0,
                                error: null,
                }))
              }}
              onConfirm={handleConfirmSend}
              validatedData={state.validatedData!}
              amount={state.amount}
              fee={state.fee}
              mintUrl={state.selectedMintUrl!}
              error={state.error}
              route={state.routeSelection?.route}
            />
          </PageTransition>
        )}

        {state.step === 'sending' && (
          <PageTransition key="sending" variant="fade" className="flex-1">
            <SendingStep
              validatedData={state.validatedData!}
              amount={state.amount}
            />
          </PageTransition>
        )}

        {state.step === 'complete' && (
          <PageTransition key="send-complete" variant="fade" className="flex-1">
            <SendCompleteStep
              validatedData={state.validatedData!}
              amount={state.amount}
              onComplete={onComplete}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
