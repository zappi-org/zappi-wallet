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
import { planRouteSelection } from './sendRouteHelpers'

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
  // Cross-flow redirect (e.g. cashu-token pasted in Send → redirect to Receive)
  onRedirect?: (validatedData: ValidatedData) => void
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
  onRedirect,
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
      const privacyMode = useAppStore.getState().settings.senderPrivacyMode ?? false
      const routeSelection = planRouteSelection({
        validated,
        amount,
        sourceMintUrl: mintUrl,
        balances,
        privacyMode,
      })
      const { route } = routeSelection

      if (route === PaymentRoute.CANNOT_SEND) {
        addToast({ type: 'error', message: t('payment.cannotSend'), duration: 3000 })
        return null
      }

      // Fee estimation
      const feeEstimate = await routing.estimateRouteFee(
        route,
        routeSelection.sourceMintUrl,
        amount,
        routeSelection.targetMintUrl,
        routeSelection.invoice,
      )
      const fee = feeEstimate.fee

      const finalizedRouteSelection: RouteSelection = {
        ...routeSelection,
        estimatedFee: fee,
      }

      console.log(`[SendFlow] Route selected: #${route} ${ROUTE_LABELS[route]} (fee: ${fee} sat)`)
      return { fee, routeSelection: finalizedRouteSelection }
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
    mintUrl?: string
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
      const sourceMintUrl = data.mintUrl ?? state.selectedMintUrl

      if (data.amountFromInvoice && data.amountFromInvoice > 0 && sourceMintUrl) {
        // Balance check before auto-advance
        const mintBalance = useAppStore.getState().balance?.byMint?.[sourceMintUrl] || 0
        if (data.amountFromInvoice > mintBalance) {
          const { formatSats: fmtSats } = await import('@/utils/format')
          addToast({ type: 'error', message: `${t('payment.insufficientBalance')} (${t('send.confirm.requestAmount', '요청')} ${fmtSats(data.amountFromInvoice)} / ${t('common.balance')} ${fmtSats(mintBalance)})`, duration: 4000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }

        const routeResult = await performRouteSelection(validated, data.amountFromInvoice, sourceMintUrl)
        if (!routeResult) {
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }

        setState((prev) => ({
          ...prev,
          step: 'confirm',
          selectedMintUrl: sourceMintUrl,
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
        selectedMintUrl: sourceMintUrl,
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
              onRedirect={onRedirect}
              initialDestination={state.destination}
              initialAddress={initialDestination}
              initialValidatedData={state.validatedData}
              mintUrl={state.selectedMintUrl || ''}
              onMintChange={(mintUrl) => setState((prev) => ({ ...prev, selectedMintUrl: mintUrl }))}
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
              displayName={initialDisplayName}
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
              route={state.routeSelection?.route}
              displayName={initialDisplayName}
            />
          </PageTransition>
        )}

        {state.step === 'complete' && (
          <PageTransition key="send-complete" variant="fade" className="flex-1">
            <SendCompleteStep
              validatedData={state.validatedData!}
              amount={state.amount}
              onComplete={onComplete}
              route={state.routeSelection?.route}
              isFiatMode={state.isFiatMode}
              fiatAmount={state.fiatAmount}
              displayName={initialDisplayName}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
