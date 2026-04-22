/**
 * SendFlow — Unified send flow container
 * Manages internal step state machine for all send operations:
 * - Lightning send (bolt11, lightning-address, lnurl-pay)
 * - Ecash send (NUT-18 cashu-request via Nostr DM)
 *
 * destination → amount → confirm → sending → complete
 *
 * Token creation lives in the Token tab (TokenCreateFlow), not here.
 */

import { useState, useCallback, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useNetwork } from '@/ui/hooks/use-network'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import { useAppStore } from '@/store'
import { useTranslation } from 'react-i18next'
import type {
  ValidatedData,
  ValidatedBolt11,
  ValidatedLightningAddress,
  ValidatedLnurlPay,
  ValidatedCashuRequest,
  ValidatedMyWallet,
} from '@/core/domain/input-types'
import { useRouting, PaymentRoute, ROUTE_LABELS } from '@/ui/hooks/use-routing'
import type { RouteSelection, RouteContext, RouteExecutionResult } from '@/core/domain/routing'
import { translateError } from '@/ui/utils/error-i18n'

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
import { SendAmountStep } from './steps/SendAmountStep'
import { SendConfirmStep } from './steps/SendConfirmStep'
import { SendingStep } from './steps/SendingStep'
import { SendCompleteStep } from './steps/SendCompleteStep'

// ============= Types =============

export type SendStep =
  | 'destination'
  | 'amount'
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
  isFiatMode: boolean
  fiatAmount: string
  skippedAmount: boolean
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
  // Cross-mint swap handler (my-wallet type)
  onMintSwap?: (fromMintUrl: string, toMintUrl: string, amount: number) => Promise<{ success: boolean; amount?: number; fee?: number; transactionId?: string } | null>
  onEstimateSwapFee?: (fromMintUrl: string, toMintUrl: string, amount: number) => Promise<{ fee: number; totalNeeded: number } | null>
  // Pre-filled data from scanner
  validatedData?: ValidatedData
  initialAmount?: number
  initialMintUrl?: string | null
  initialDestination?: string
  initialDisplayName?: string
  // Universal router — delegates non-sendable input (cashu-token, amount-only) elsewhere
  onRouteValidated?: (data: ValidatedData) => void
}

// ============= Component =============

export function SendFlow({
  onBack,
  onComplete,
  onExecuteRoute,
  onMintSwap,
  onEstimateSwapFee: _onEstimateSwapFee,
  validatedData: initialValidatedData,
  initialAmount,
  initialMintUrl,
  initialDestination,
  initialDisplayName,
  onRouteValidated,
}: SendFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)
  const inputParser = useInputParser()
  const routing = useRouting()

  // Determine initial destination from validatedData or initialDestination
  const getInitialDestination = (): string => {
    if (initialDisplayName) return initialDisplayName
    if (initialDestination) return initialDestination
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

  // Skip destination when validated data is already provided (from address book / scanner)
  const getInitialStep = (): SendStep =>
    initialValidatedData && isSendableData(initialValidatedData) ? 'amount' : 'destination'

  // Flow state
  const [state, setState] = useState<SendFlowState>({
    step: getInitialStep(),
    selectedMintUrl: initialMintUrl || null,
    destination: getInitialDestination(),
    validatedData: isSendableData(initialValidatedData) ? initialValidatedData : null,
    amount: getInitialAmount(),
    memo: '',
    isFiatMode: false,
    fiatAmount: '',
    skippedAmount: false,
    fee: 0,
    error: null,
    dmSent: false,
    routeSelection: null,
  })

  // Loading state for async operations
  const [isLoading, setIsLoading] = useState(false)

  // Prevent double-tap
  const isProcessingRef = useRef(false)

  // ============= Route Selection Logic =============

  /** Perform route selection + fee estimation (shared between destination auto-advance and amount next) */
  const performRouteSelection = useCallback(async (
    validated: SendableValidatedData,
    amount: number,
    mintUrl: string,
  ): Promise<{ fee: number; routeSelection: RouteSelection } | null> => {
    try {
      const balances = useAppStore.getState().balance.byMint
      const route = routing.selectRoute({
        validatedData: validated,
        senderMints: balances,
        amount,
        privacyMode: useAppStore.getState().settings.senderPrivacyMode ?? false,
        lightningInvoice: validated.type === 'cashu-request' ? validated.parsed.lightningInvoice : undefined,
      })

      if (route === PaymentRoute.CANNOT_SEND) {
        addToast({ type: 'error', message: t('payment.cannotSend'), duration: 3000 })
        return null
      }

      // Determine source + target mints
      const receiverMints = validated.type === 'cashu-request' ? validated.parsed.mints
        : []
      const commonMints = receiverMints.length > 0
        ? routing.findCommonMints(Object.keys(balances).filter((m) => balances[m] > 0), receiverMints)
        : []
      // User's selected mint takes priority
      const sourceMint = mintUrl

      let targetMint: string | undefined
      if (route === PaymentRoute.TOKEN_TRANSFER || route === PaymentRoute.LN_INTERNAL) {
        // Prefer source mint as target (same mint = no cross-mint fee)
        const sourceNorm = sourceMint.replace(/\/+$/, '').toLowerCase()
        const sourceAsTarget = commonMints.find((m) => m.replace(/\/+$/, '').toLowerCase() === sourceNorm)
        targetMint = sourceAsTarget || commonMints[0]
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
      const feeEstimate = await routing.estimateRouteFee(route, sourceMint, amount, targetMint, invoice)
      const fee = feeEstimate.fee

      const routeSelection: RouteSelection = {
        route,
        amount,
        sourceMintUrl: sourceMint,
        targetMintUrl: targetMint,
        invoice,
        estimatedFee: fee,
        reason: ROUTE_LABELS[route],
      }

      console.log(`[SendFlow] Route selected: #${route} ${ROUTE_LABELS[route]} (fee: ${fee} sat)`)
      return { fee, routeSelection }
    } catch (err) {
      console.error('[SendFlow] Route selection / fee estimation failed:', err)
      addToast({ type: 'error', message: translateError(err, t), duration: 3000 })
      return null
    }
  }, [addToast, t, routing])

  // ============= Step Transitions =============

  /** Destination step → advance to amount (or confirm if invoice has amount) */
  const handleDestinationNext = useCallback(async (data: {
    destination: string
    validatedData?: SendableValidatedData
    amountFromInvoice?: number
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
      // Validate destination if no validatedData provided
      let validated = data.validatedData
      if (!validated) {
        const detected = inputParser.detectAndClassify(data.destination)
        if (detected.type === 'unknown') {
          addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }
        try {
          const result = await inputParser.validateAsync(detected)
          if (!isSendableData(result)) {
            addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
            isProcessingRef.current = false
            setIsLoading(false)
            return
          }
          validated = result
        } catch (err) {
          addToast({ type: 'error', message: err instanceof Error ? err.message : t('scanner.unrecognizedFormat'), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }
      }

      // If invoice has amount → check balance, then skip amount step
      if (data.amountFromInvoice && data.amountFromInvoice > 0 && state.selectedMintUrl) {
        // Balance check before auto-advance
        const mintBalance = useAppStore.getState().balance?.byMint?.[state.selectedMintUrl] || 0
        if (data.amountFromInvoice > mintBalance) {
          const { formatSats: fmtSats } = await import('@/utils/format')
          addToast({ type: 'error', message: `${t('payment.insufficientBalance')} (${t('send.confirm.requestAmount', '요청')} ${fmtSats(data.amountFromInvoice)} / ${t('common.balance')} ${fmtSats(mintBalance)})`, duration: 4000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }

        const routeResult = await performRouteSelection(validated, data.amountFromInvoice, state.selectedMintUrl)
        if (!routeResult) {
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }

        setState((prev) => ({
          ...prev,
          step: 'confirm',
          destination: data.destination,
          validatedData: validated!,
          amount: data.amountFromInvoice!,
          skippedAmount: true,
          fee: routeResult.fee,
          routeSelection: routeResult.routeSelection,
          error: null,
        }))
        return
      }

      // Destination with no pre-set amount → go to amount step
      setState((prev) => ({
        ...prev,
        step: 'amount',
        destination: data.destination,
        validatedData: validated!,
        error: null,
      }))
    } catch (err) {
      console.error('[SendFlow] Destination validation error:', err)
      addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [isOnline, addToast, t, state.selectedMintUrl, performRouteSelection, inputParser])

  /** Amount step → route selection + confirm */
  const handleAmountNext = useCallback(async (data: { amount: number; memo: string; isFiatMode: boolean; fiatAmount: string }) => {
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
      if (!state.validatedData || !state.selectedMintUrl) {
        addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
        isProcessingRef.current = false
        setIsLoading(false)
        return
      }

      const routeResult = await performRouteSelection(state.validatedData, data.amount, state.selectedMintUrl)
      if (!routeResult) {
        isProcessingRef.current = false
        setIsLoading(false)
        return
      }

      setState((prev) => ({
        ...prev,
        step: 'confirm',
        amount: data.amount,
        memo: data.memo,
        isFiatMode: data.isFiatMode,
        fiatAmount: data.fiatAmount,
        fee: routeResult.fee,
        routeSelection: routeResult.routeSelection,
        error: null,
      }))
    } catch (err) {
      console.error('[SendFlow] Amount next error:', err)
      addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [isOnline, state.validatedData, state.selectedMintUrl, performRouteSelection, addToast, t])

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

      // Phase 5: my-wallet 타입은 SwapUseCase 경유 (cross-mint invoice 자체 생성)
      if (validatedData.type === 'my-wallet' && onMintSwap && routeSelection.targetMintUrl) {
        const swapResult = await onMintSwap(
          routeSelection.sourceMintUrl,
          routeSelection.targetMintUrl,
          routeSelection.amount,
        )
        if (swapResult?.success) {
          setState((prev) => ({ ...prev, step: 'complete' }))
        } else {
          setState((prev) => ({ ...prev, step: 'confirm', error: t('payment.swapFailed') }))
        }
        return
      }

      const result = await onExecuteRoute(routeSelection, context)

      if (result?.success) {
        setState((prev) => ({
          ...prev,
          step: 'complete',
          ...(result.transportUsed === 'nostr' ? { dmSent: true } : {}),
        }))
      } else {
        // MainApp already shows error toast via handleExecuteRoute
        setState((prev) => ({
          ...prev,
          step: 'confirm',
          error: t('payment.sendFailed'),
        }))
      }
    } catch (err) {
      console.error('[SendFlow] Send error:', err)
      const message = (err as { code?: string }).code === 'INSUFFICIENT_BALANCE'
        ? ((err as { message?: string }).message ?? t('payment.insufficientBalance'))
        : t('payment.sendFailed')
      setState((prev) => ({ ...prev, step: 'confirm', error: message }))
      // Only show toast for errors not already handled by MainApp
      if ((err as { code?: string }).code === 'INSUFFICIENT_BALANCE') {
        addToast({ type: 'error', message, duration: 4000 })
      }
    } finally {
      isProcessingRef.current = false
    }
  }, [state, onExecuteRoute, onMintSwap, isOnline, addToast, t])

  // ============= Render =============

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {state.step === 'destination' && (
          <PageTransition key="send-destination" variant="page" className="flex-1">
            <SendInputStep
              onBack={onBack}
              onNext={handleDestinationNext}
              initialDestination={state.destination}
              initialAddress={initialDestination}
              initialValidatedData={state.validatedData}
              mintUrl={state.selectedMintUrl || ''}
              isLoading={isLoading}
              onRouteValidated={onRouteValidated}
            />
          </PageTransition>
        )}

        {state.step === 'amount' && (
          <PageTransition key="send-amount" variant="page" className="flex-1">
            <SendAmountStep
              onBack={() => {
                if (getInitialStep() === 'amount') {
                  onBack()
                } else {
                  setState((prev) => ({ ...prev, step: 'destination', error: null }))
                }
              }}
              onNext={handleAmountNext}
              mintUrl={state.selectedMintUrl || ''}
              destination={state.destination}
              validatedData={state.validatedData || undefined}
              initialAmount={state.amount}
              initialMemo={state.memo}
              initialFiatMode={state.isFiatMode}
              initialFiatAmount={state.fiatAmount}
              isLoading={isLoading}
            />
          </PageTransition>
        )}

        {state.step === 'confirm' && (
          <PageTransition key="send-confirm" variant="page" className="flex-1">
            <SendConfirmStep
              onBack={() => {
                setState((prev) => ({
                  ...prev,
                  step: prev.skippedAmount ? 'destination' : 'amount',
                  fee: 0,
                  routeSelection: null,
                  skippedAmount: false,
                  error: null,
                }))
              }}
              onConfirm={handleConfirmSend}
              validatedData={state.validatedData!}
              amount={state.amount}
              fee={state.fee}
              displayName={initialDisplayName || (state.destination !== getAddressOrInvoice(state.validatedData!) ? state.destination : undefined)}
              mintUrl={state.selectedMintUrl!}
              error={state.error}
              route={state.routeSelection?.route}
              isFiatMode={state.isFiatMode}
              fiatAmount={state.fiatAmount}
              userMemo={state.memo}
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
              isFiatMode={state.isFiatMode}
              fiatAmount={state.fiatAmount}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
