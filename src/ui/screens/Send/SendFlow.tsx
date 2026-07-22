/**
 * SendFlow — Unified send flow container
 * Manages internal step state machine for all send operations:
 * - Lightning send (bolt11, lightning-address, lnurl-pay)
 * - Ecash send (NUT-18 cashu-request via Nostr DM)
 *
 * destination → amount → confirm → sending → complete
 *
 * The direct-transfer branch (bearer token, no recipient) runs
 * amount → confirm → created inside this same flow.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useNetwork } from '@/ui/hooks/use-network'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import { useAppStore } from '@/store'
import { isSameMintUrl } from '@/utils/url'
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
    case 'bolt11':
      return data.invoice
    case 'lightning-address':
      return data.address
    case 'lnurl-pay':
      return data.lnurl
    default:
      return undefined
  }
}

/** Extract embedded amount from validated data. */
function getAmountFromData(data: SendableValidatedData): number {
  if (data.type === 'bolt11' && data.amountSats > 0) return data.amountSats
  if (data.type === 'cashu-request' && data.parsed?.amount && data.parsed.amount > 0) {
    return data.parsed.amount
  }
  return 0
}

import { SendInputStep } from './steps/SendInputStep'
import { SendAmountStep, type SendAmountDraft } from './steps/SendAmountStep'
import { SendCompleteStep } from './steps/SendCompleteStep'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { planRouteSelection } from './sendRouteHelpers'
import { DirectReceiptStep } from './steps/DirectReceiptStep'

// ============= Types =============

export type SendStep = 'destination' | 'amount' | 'confirm' | 'sending' | 'complete' | 'created'

/**
 * MAX-resolution outcome. `reported` tells the caller whether the failure was
 * already toasted upstream (route-selection path) so it shows exactly one toast.
 */
type RouteFeeQuote = number | 'unavailable'

export interface StableFeeEstimate {
  fee: number
  availableBalance: number
}

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
  fee: RouteFeeQuote
  quotedBalance: number | null
  error: string | null
  // NUT-18 specific
  dmSent: boolean
  // The route executed but settlement is still confirming (in_transit melt) —
  // the complete screen shows a quieter "sending" variant instead of success.
  completePending: boolean
  // Actual fee from a settled execution result — null while only a quote exists.
  settledFee: number | null
  // Routing
  routeSelection: RouteSelection | null
  // Direct transfer (bearer token creation, no recipient)
  directTransfer: boolean
  createdToken: string
  createdTxId: string
}

/**
 * Mint selection request — sent by SendInputStep (e.g. NIP-19 common-mint pick).
 * On select, auto-advance to the next step. (Confirm-step mint changes flow
 * through the amount scene's own onChangeMint, not this sheet.)
 */
export interface MintSelectionRequest {
  destination: string
  validatedData: SendableValidatedData
  commonMintUrls: string[]
  infoText?: string
}

export interface SendFlowProps {
  onBack: () => void
  onComplete: () => void
  // Routing-based send handler (primary)
  onExecuteRoute: (selection: RouteSelection, context: RouteContext) => Promise<RouteExecutionResult | null>
  onResolveInvoice: (selection: RouteSelection, context: RouteContext) => Promise<string | null>
  // Cross-mint swap handler (my-wallet type)
  onMintSwap?: (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ) => Promise<{
    success: boolean
    amount?: number
    fee?: number
    transactionId?: string
  } | null>
  onEstimateSwapFee?: (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ) => Promise<{ fee: number; totalNeeded: number } | null>
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
  // Direct transfer (bearer token) — creates a token with no recipient
  onCreateToken: (
    amount: number,
    mintUrl: string,
    memo?: string,
  ) => Promise<{ token: string; txId: string; operationId: string } | null>
  onEstimateCreateFee?: (mintUrl: string, amount: number) => Promise<StableFeeEstimate | null>
  onQuoteReclaim?: (txId: string) => Promise<number | null>
  onReclaimToken?: (txId: string) => Promise<void>
  directMintUrl?: string | null
  /** Minimum ms the sending scene stays up after the result lands (tests pass 0). */
  sendingDwellMs?: number
}

// ============= Component =============

export function SendFlow({
  onBack,
  onComplete,
  onExecuteRoute,
  onResolveInvoice,
  onMintSwap,
  onEstimateSwapFee: _onEstimateSwapFee,
  onRedirect,
  validatedData: initialValidatedData,
  initialAmount,
  initialMintUrl,
  initialDestination,
  initialDisplayName,
  onRouteValidated,
  onCreateToken,
  onEstimateCreateFee,
  onQuoteReclaim,
  onReclaimToken,
  directMintUrl,
  sendingDwellMs = 1400,
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
      case 'bolt11':
        return initialValidatedData.invoice
      case 'lightning-address':
        return initialValidatedData.address
      case 'lnurl-pay':
        return initialValidatedData.lnurl
      case 'cashu-request':
        return initialValidatedData.request
      default:
        return ''
    }
  }

  const getInitialAmount = (): number => {
    if (initialAmount) return initialAmount
    if (!initialValidatedData) return 0
    switch (initialValidatedData.type) {
      case 'bolt11':
        return initialValidatedData.amountSats
      case 'cashu-request':
        return initialValidatedData.parsed.amount || 0
      default:
        return 0
    }
  }

  const isSendableData = (data?: ValidatedData): data is SendableValidatedData => {
    if (!data) return false
    return ['bolt11', 'lightning-address', 'lnurl-pay', 'cashu-request', 'my-wallet'].includes(data.type)
  }

  // Skip destination when validated data is already provided (from address book / scanner).
  // If the data carries an embedded amount, skip straight to confirm (camera shortcut).
  const getInitialStep = (): SendStep => {
    if (!initialValidatedData || !isSendableData(initialValidatedData)) return 'destination'
    if (getInitialAmount() > 0) return 'confirm'
    return 'amount'
  }

  // Flow state
  const [state, setState] = useState<SendFlowState>(() => {
    const base: SendFlowState = {
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
      quotedBalance: null,
      error: null,
      dmSent: false,
      completePending: false,
      settledFee: null,
      routeSelection: null,
      directTransfer: false,
      createdToken: '',
      createdTxId: '',
    }
    return base
  })

  // Loading state for async operations
  const [isLoading, setIsLoading] = useState(false)

  // The domain result usually lands mid-print — hold the receipt scene for a
  // beat so the outcome doesn't cut the animation off the moment it starts.
  // On success the beat is the finish choreography: fast feed-out → tear → stamp.
  const sendingDwellTimerRef = useRef<number | null>(null)
  const [sendingFinishing, setSendingFinishing] = useState(false)

  const completeSendingAfterDwell = useCallback(
    (complete: () => void, options?: { finish?: boolean }) => {
      if (options?.finish) setSendingFinishing(true)
      if (sendingDwellTimerRef.current) window.clearTimeout(sendingDwellTimerRef.current)
      sendingDwellTimerRef.current = window.setTimeout(() => {
        sendingDwellTimerRef.current = null
        complete()
      }, sendingDwellMs)
    },
    [sendingDwellMs],
  )

  useEffect(() => {
    return () => {
      if (sendingDwellTimerRef.current) window.clearTimeout(sendingDwellTimerRef.current)
    }
  }, [])

  // Sending watchdog — after 45s the status row offers an exit; the transfer
  // itself keeps running via the pending-transfer poller.
  const [sendingSlow, setSendingSlow] = useState(false)
  useEffect(() => {
    if (state.step !== 'sending') {
      setSendingSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSendingSlow(true), 45_000)
    return () => window.clearTimeout(timer)
  }, [state.step])

  // Mint selection sheet (lifted from SendInputStep so it's reachable from any step)
  const [mintSelection, setMintSelection] = useState<MintSelectionRequest | null>(null)

  // Prevent double-tap
  const isProcessingRef = useRef(false)

  // Route-quote freshness: every mint change and every new quote bumps this;
  // a quote may commit only if the epoch is unchanged since it started
  const routeEpochRef = useRef(0)

  // Explicit user retry must bypass the estimate gate's failure cooldown —
  // otherwise "다시 확인" replays the cached rejection for 5s and feels broken.
  const feeRetryFreshRef = useRef(false)

  // Effective display name — resolved once, used by all steps
  const effectiveDisplayName = useMemo(() => {
    if (initialDisplayName) return initialDisplayName
    if (state.validatedData && state.destination !== getAddressOrInvoice(state.validatedData)) {
      return state.destination
    }
    return undefined
  }, [initialDisplayName, state.destination, state.validatedData])

  // ============= Route Selection Logic =============

  /** Perform route selection + fee estimation (shared between destination auto-advance and amount next) */
  const performRouteSelection = useCallback(
    async (
      validated: SendableValidatedData,
      amount: number,
      mintUrl: string,
    ): Promise<{
      fee: RouteFeeQuote
      quotedBalance: number | null
      routeSelection: RouteSelection
      error?: string
    } | null> => {
      try {
        const balances = useAppStore.getState().balance.byMint
        const privacyMode = useAppStore.getState().settings.senderPrivacyMode ?? false
        let routeSelection = planRouteSelection({
          validated,
          amount,
          sourceMintUrl: mintUrl,
          balances,
          privacyMode,
        })
        const { route } = routeSelection

        if (route === PaymentRoute.CANNOT_SEND) {
          addToast({
            type: 'error',
            message: t('payment.cannotSend'),
            duration: 3000,
          })
          return null
        }

        let fee: RouteFeeQuote
        let quotedBalance: number | null = null
        let quoteError: string | undefined
        try {
          if (
            !routeSelection.invoice &&
            (route === PaymentRoute.LN_INTERNAL ||
              route === PaymentRoute.LN_CROSS_MINT ||
              route === PaymentRoute.MELT_TO_LN)
          ) {
            const invoice = await onResolveInvoice(routeSelection, {
              addressOrInvoice: getAddressOrInvoice(validated),
              lnurlPayParams:
                validated.type === 'lightning-address'
                  ? validated.lnurlParams
                  : validated.type === 'lnurl-pay'
                    ? validated.params
                    : undefined,
            })
            if (!invoice) throw new Error('Payment invoice unavailable')
            routeSelection = { ...routeSelection, invoice }
          }

          const fresh = feeRetryFreshRef.current
          feeRetryFreshRef.current = false
          // The options arg is passed only when fresh — keeps the common call
          // 5-ary for callers/tests that assert the exact signature.
          const feeEstimate = fresh
            ? await routing.estimateRouteFee(
                route,
                routeSelection.sourceMintUrl,
                amount,
                routeSelection.targetMintUrl,
                routeSelection.invoice,
                { fresh: true },
              )
            : await routing.estimateRouteFee(
                route,
                routeSelection.sourceMintUrl,
                amount,
                routeSelection.targetMintUrl,
                routeSelection.invoice,
              )
          if (!Number.isFinite(feeEstimate.fee) || feeEstimate.fee < 0) {
            throw new Error('Invalid fee estimate')
          }
          fee = feeEstimate.fee
          quotedBalance = feeEstimate.availableBalance
        } catch (error) {
          console.error('[SendFlow] Fee estimation unavailable:', error)
          fee = 'unavailable'
          if ((error as { code?: string }).code === 'INSUFFICIENT_BALANCE') {
            quoteError = t('errors.insufficientBalanceUnknown')
          }
        }

        const finalizedRouteSelection: RouteSelection = {
          ...routeSelection,
          // Execution requires a numeric route snapshot, while the separate
          // quote state keeps an unavailable estimate from masquerading as 0.
          estimatedFee: typeof fee === 'number' ? fee : 0,
        }

        console.log(
          `[SendFlow] Route selected: #${route} ${ROUTE_LABELS[route]} (fee: ${
            typeof fee === 'number' ? `${fee} sat` : 'unavailable'
          })`,
        )
        return { fee, quotedBalance, routeSelection: finalizedRouteSelection, error: quoteError }
      } catch (err) {
        console.error('[SendFlow] Route selection / fee estimation failed:', err)
        addToast({
          type: 'error',
          message: translateError(err, t),
          duration: 3000,
        })
        return null
      }
    },
    [addToast, t, routing, onResolveInvoice],
  )

  // ============= Step Transitions =============

  /** Destination step → advance to amount (or confirm if invoice has amount) */
  const handleDestinationNext = useCallback(
    async (data: {
      destination: string
      validatedData?: SendableValidatedData
      amountFromInvoice?: number
      mintUrl?: string
    }) => {
      if (isProcessingRef.current) return
      isProcessingRef.current = true
      setIsLoading(true)

      if (!isOnline) {
        addToast({
          type: 'error',
          message: t('common.offlineRequired'),
          duration: 3000,
        })
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
            addToast({
              type: 'error',
              message: t('scanner.unrecognizedFormat'),
              duration: 3000,
            })
            isProcessingRef.current = false
            setIsLoading(false)
            return
          }
          try {
            const result = await inputParser.validateAsync(detected)
            if (!isSendableData(result)) {
              addToast({
                type: 'error',
                message: t('scanner.unrecognizedFormat'),
                duration: 3000,
              })
              isProcessingRef.current = false
              setIsLoading(false)
              return
            }
            validated = result
          } catch (err) {
            addToast({
              type: 'error',
              message: err instanceof Error ? err.message : t('scanner.unrecognizedFormat'),
              duration: 3000,
            })
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
            addToast({
              type: 'error',
              message: `${t('payment.insufficientBalance')} (${t('send.confirm.requestAmount', '요청')} ${fmtSats(
                data.amountFromInvoice,
              )} / ${t('common.balance')} ${fmtSats(mintBalance)})`,
              duration: 4000,
            })
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
            quotedBalance: routeResult.quotedBalance,
            routeSelection: routeResult.routeSelection,
            error: routeResult.error ?? null,
            // A memo written for the previous recipient must not ride on a new one
            memo: prev.destination === data.destination ? prev.memo : '',
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
          quotedBalance: null,
          memo: prev.destination === data.destination ? prev.memo : '',
        }))
      } catch (err) {
        console.error('[SendFlow] Destination validation error:', err)
        addToast({
          type: 'error',
          message: t('errors.generic'),
          duration: 3000,
        })
      } finally {
        isProcessingRef.current = false
        setIsLoading(false)
      }
    },
    [isOnline, addToast, t, state.selectedMintUrl, performRouteSelection, inputParser],
  )

  /** Amount step → enter confirm immediately; the initial-route effect quotes the fee. */
  const handleAmountNext = useCallback(
    (data: { amount: number; memo: string; isFiatMode: boolean; fiatAmount: string }) => {
      if (!isOnline) {
        addToast({ type: 'error', message: t('common.offlineRequired'), duration: 3000 })
        return
      }
      if (!state.validatedData || !state.selectedMintUrl) {
        addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
        return
      }
      // Fresh quote for this confirm entry (mint/amount may have changed since the last one)
      didInitialRouteRef.current = false
      setState((prev) => ({
        ...prev,
        step: 'confirm',
        amount: data.amount,
        memo: data.memo,
        isFiatMode: data.isFiatMode,
        fiatAmount: data.fiatAmount,
        routeSelection: null,
        fee: 0,
        quotedBalance: null,
        error: null,
      }))
    },
    [isOnline, state.validatedData, state.selectedMintUrl, addToast, t],
  )

  /** Confirm step → execute send via routing layer */
  const handleConfirmSend = useCallback(async () => {
    if (isProcessingRef.current || !state.validatedData || !state.selectedMintUrl || !state.routeSelection) return

    if (!isOnline) {
      addToast({
        type: 'error',
        message: t('common.offlineRequired'),
        duration: 3000,
      })
      return
    }
    isProcessingRef.current = true

    if (sendingDwellTimerRef.current) window.clearTimeout(sendingDwellTimerRef.current)
    sendingDwellTimerRef.current = null
    setSendingFinishing(false)
    setState((prev) => ({ ...prev, step: 'sending', error: null }))

    try {
      const { validatedData, routeSelection, memo } = state

      // Build route context
      const storeState = useAppStore.getState()

      const context: RouteContext = {
        parsedCreq: validatedData.type === 'cashu-request' ? validatedData.parsed : undefined,
        lnurlPayParams:
          validatedData.type === 'lightning-address'
            ? validatedData.lnurlParams
            : validatedData.type === 'lnurl-pay'
              ? validatedData.params
              : undefined,
        nostrPrivkey: storeState.nostrPrivkey || undefined,
        relays: storeState.settings.relays || [],
        memo: memo || (validatedData.type === 'cashu-request' ? validatedData.parsed.description : undefined),
        addressOrInvoice: getAddressOrInvoice(validatedData),
      }

      // my-wallet type routes through SwapUseCase (generates its own cross-mint invoice)
      if (validatedData.type === 'my-wallet' && onMintSwap && routeSelection.targetMintUrl) {
        const swapResult = await onMintSwap(
          routeSelection.sourceMintUrl,
          routeSelection.targetMintUrl,
          routeSelection.amount,
        )
        if (swapResult?.success) {
          // SwapResult.fee is the prepared quote, not a mint-reported effective
          // fee — the receipt keeps the estimate label until the service exposes one.
          completeSendingAfterDwell(() => {
            setState((prev) => ({ ...prev, step: 'complete' }))
          }, { finish: true })
        } else {
          completeSendingAfterDwell(() => {
            setState((prev) => ({
              ...prev,
              step: 'confirm',
              error: t('transfer.swapFailed'),
            }))
          })
        }
        return
      }

      const result = await onExecuteRoute(routeSelection, context)

      if (result?.status === 'settled' || result?.status === 'in_transit') {
        // in_transit is NOT a failure: the melt left the wallet and the poller
        // will settle it. Re-enabling Send here would open a double-pay window.
        const completePending = result.status === 'in_transit'
        // The actual fee lands NOW — flip the printing receipt at the tear,
        // not later on the complete screen. Only a mint-reported effective fee
        // may be labeled final; result.fee can still be the reserve.
        setState((prev) => ({
          ...prev,
          settledFee: result.status === 'settled' ? result.effectiveFee ?? null : null,
        }))
        completeSendingAfterDwell(() => {
          setState((prev) => ({
            ...prev,
            step: 'complete',
            completePending,
            ...(result.transportUsed === 'nostr' ? { dmSent: true } : {}),
          }))
        }, { finish: true })
      } else {
        // MainApp already shows error toast via handleExecuteRoute
        completeSendingAfterDwell(() => {
          setState((prev) => ({
            ...prev,
            step: 'confirm',
            error: t('payment.sendFailed'),
          }))
        })
      }
    } catch (err) {
      console.error('[SendFlow] Send error:', err)
      const message =
        (err as { code?: string }).code === 'INSUFFICIENT_BALANCE'
          ? (err as { message?: string }).message ?? t('payment.insufficientBalance')
          : t('payment.sendFailed')
      completeSendingAfterDwell(() => {
        setState((prev) => ({ ...prev, step: 'confirm', error: message }))
      })
      // Only show toast for errors not already handled by MainApp
      if ((err as { code?: string }).code === 'INSUFFICIENT_BALANCE') {
        addToast({ type: 'error', message, duration: 4000 })
      }
    } finally {
      isProcessingRef.current = false
    }
  }, [state, onExecuteRoute, onMintSwap, isOnline, addToast, t, completeSendingAfterDwell])

  // ============= Direct Transfer (bearer token, no recipient) =============

  // Set only when the user explicitly picks a mint in-flow (amount-step sheet or
  // confirm-step change) — the seeded active mint is a default, not a choice.
  const userMintChoiceRef = useRef<string | null>(null)

  /** Empty-input CTA → enter amount entry with a resolved source mint. */
  const handleDirectTransfer = useCallback(() => {
    // An explicit in-flow choice wins; otherwise prefer the funded default
    // (directMintUrl) over the seeded active mint, which may hold zero balance.
    const mint = userMintChoiceRef.current ?? directMintUrl ?? state.selectedMintUrl ?? null
    if (!mint) {
      addToast({
        type: 'error',
        message: t('send.direct.noMint'),
        duration: 3000,
      })
      return
    }
    setState((prev) => ({
      ...prev,
      directTransfer: true,
      selectedMintUrl: mint,
      amount: 0,
      memo: '',
      step: 'amount',
      error: null,
    }))
  }, [state.selectedMintUrl, directMintUrl, addToast, t])

  /** Direct amount → confirm (no route selection; token creation bypasses routing). */
  const handleDirectAmountNext = useCallback(
    (data: { amount: number; memo: string; isFiatMode: boolean; fiatAmount: string }) => {
      setState((prev) => ({
        ...prev,
        amount: data.amount,
        memo: data.memo,
        isFiatMode: data.isFiatMode,
        fiatAmount: data.fiatAmount,
        step: 'confirm',
        error: null,
      }))
    },
    [],
  )

  /** Confirm → create the bearer token, then show the receipt (DirectReceiptStep).
   *  Creation is instant, so success skips the 'sending' scene entirely — the
   *  confirm button's own busy spinner covers the await. */
  const handleCreateTokenConfirm = useCallback(async () => {
    if (!state.selectedMintUrl) {
      addToast({ type: 'error', message: t('send.direct.noMint'), duration: 3000 })
      return
    }
    try {
      const res = await onCreateToken(state.amount, state.selectedMintUrl, state.memo || undefined)
      if (!res) {
        addToast({ type: 'error', message: t('send.direct.createFailed'), duration: 3000 })
        setState((prev) => ({ ...prev, step: 'confirm', error: t('send.direct.createFailed') }))
        return
      }
      setState((prev) => ({ ...prev, createdToken: res.token, createdTxId: res.txId, step: 'created', error: null }))
    } catch (err) {
      // MainApp re-throws InsufficientBalanceError (real fee > estimate, or the
      // balance moved under the open sheet) — surface it instead of a silent tap.
      const message = translateError(err, t)
      setState((prev) => ({ ...prev, step: 'confirm', error: message }))
      addToast({ type: 'error', message, duration: 4000 })
    }
  }, [state.selectedMintUrl, state.amount, state.memo, onCreateToken, addToast, t])

  /** Reclaim the unclaimed token, then leave the flow. */
  const handleReclaimAndClose = useCallback(async () => {
    if (onReclaimToken) await onReclaimToken(state.createdTxId)
    onComplete()
  }, [onReclaimToken, state.createdTxId, onComplete])

  // ============= Mint Selection (lifted) =============

  /** Open mint selection sheet — called from SendInputStep (destination context). */
  const handleRequestMintSelection = useCallback(
    (req: {
      destination: string
      validatedData: SendableValidatedData
      commonMintUrls: string[]
      infoText?: string
    }) => {
      setMintSelection(req)
    },
    [],
  )

  /** Apply mint selection — advance to the next step with the chosen mint. */
  const handleMintSelected = useCallback(
    (selectedMintUrl: string) => {
      if (!mintSelection) return
      userMintChoiceRef.current = selectedMintUrl
      routeEpochRef.current++
      setState((prev) => ({ ...prev, selectedMintUrl }))
      const amt = getAmountFromData(mintSelection.validatedData)
      handleDestinationNext({
        destination: mintSelection.destination,
        validatedData: mintSelection.validatedData,
        amountFromInvoice: amt > 0 ? amt : undefined,
        mintUrl: selectedMintUrl,
      })
      setMintSelection(null)
    },
    [mintSelection, handleDestinationNext],
  )

  // Direct-transfer confirm quotes its own fee (token creation bypasses routing)
  const [directFeeQuote, setDirectFeeQuote] = useState<number | 'pending' | 'unavailable'>('pending')
  const [directQuotedBalance, setDirectQuotedBalance] = useState<number | null>(null)
  const [feeRetryNonce, setFeeRetryNonce] = useState(0)
  useEffect(() => {
    // 'sending' keeps the confirm scene mounted — resetting here would flip the
    // fee row to a skeleton mid-send and discard the quote on failure-return.
    if (state.step === 'sending') return
    if (state.step !== 'confirm' || !state.directTransfer) {
      setDirectFeeQuote('pending')
      setDirectQuotedBalance(null)
      return
    }
    if (!onEstimateCreateFee) {
      setDirectFeeQuote(0)
      setDirectQuotedBalance(null)
      return
    }
    if (state.amount <= 0 || !state.selectedMintUrl) {
      setDirectFeeQuote('unavailable')
      setDirectQuotedBalance(null)
      return
    }
    const epoch = ++routeEpochRef.current
    setDirectFeeQuote('pending')
    setDirectQuotedBalance(null)
    onEstimateCreateFee(state.selectedMintUrl, state.amount)
      .then((value) => {
        if (routeEpochRef.current !== epoch) return
        setDirectFeeQuote(value === null ? 'unavailable' : Math.max(0, Math.ceil(value.fee)))
        setDirectQuotedBalance(value?.availableBalance ?? null)
      })
      .catch(() => {
        if (routeEpochRef.current === epoch) {
          setDirectFeeQuote('unavailable')
          setDirectQuotedBalance(null)
        }
      })
  }, [state.step, state.directTransfer, state.amount, state.selectedMintUrl, onEstimateCreateFee, feeRetryNonce])

  /**
   * Initial route selection — runs once when SendFlow lands on 'confirm' from a
   * camera shortcut (scanned bolt11 with amount, etc.). Required because
   * handleAmountNext would normally do this work, but we skipped the amount step.
   *
   * Note: no cleanup function — the effect's deps include `state.routeSelection`,
   * which flips non-null right after a successful setState and re-runs the effect,
   * so a cleanup-set `cancelled` flag would suppress updates that already landed.
   * Staleness is handled by the route epoch instead: a quote may commit only if
   * nothing bumped the epoch (mint change, newer quote) while it was in flight —
   * otherwise a slow quote for mint X could land after the user switched to Y and
   * the send would draw from the wrong mint.
   */
  const didInitialRouteRef = useRef(false)
  useEffect(() => {
    if (didInitialRouteRef.current) return
    if (state.step !== 'confirm') return
    if (state.routeSelection) return
    if (!state.validatedData || !state.selectedMintUrl || state.amount <= 0) return

    didInitialRouteRef.current = true
    const epoch = ++routeEpochRef.current

    performRouteSelection(state.validatedData, state.amount, state.selectedMintUrl).then((routeResult) => {
      if (routeEpochRef.current !== epoch) return
      if (!routeResult) {
        // Route selection itself failed (CANNOT_SEND / unexpected error, already
        // toasted). Without this write the fee row pulses forever with no retry.
        // The ref stays true — resetting it here would auto-fire a second quote
        // and a duplicate toast; handleRetryFee re-arms via the fee dep instead.
        setState((prev) => ({ ...prev, fee: 'unavailable' }))
        return
      }
      setState((prev) => ({
        ...prev,
        fee: routeResult.fee,
        quotedBalance: routeResult.quotedBalance,
        routeSelection: routeResult.routeSelection,
        skippedAmount: true,
        error: routeResult.error ?? null,
      }))
    })
  }, [
    state.step,
    state.routeSelection,
    state.validatedData,
    state.selectedMintUrl,
    state.amount,
    state.fee,
    performRouteSelection,
  ])

  // Camera-shortcut confirm with no resolvable mint: nothing can ever quote, so
  // land on 'unavailable' instead of an eternal skeleton (retry is hidden too).
  useEffect(() => {
    if (state.step !== 'confirm' || state.directTransfer) return
    if (state.selectedMintUrl || state.fee === 'unavailable') return
    setState((prev) => ({ ...prev, fee: 'unavailable' }))
  }, [state.step, state.directTransfer, state.selectedMintUrl, state.fee])

  const handleRetryFee = useCallback(() => {
    routeEpochRef.current++
    if (state.directTransfer) {
      setDirectFeeQuote('pending')
      setDirectQuotedBalance(null)
      setFeeRetryNonce((value) => value + 1)
      return
    }
    didInitialRouteRef.current = false
    feeRetryFreshRef.current = true
    setState((prev) => ({ ...prev, routeSelection: null, fee: 0, quotedBalance: null, error: null }))
  }, [state.directTransfer])

  const handleAmountBack = (draft: SendAmountDraft) => {
    if (!state.directTransfer && getInitialStep() === 'amount') {
      onBack()
    } else {
      setState((prev) => ({
        ...prev,
        step: 'destination',
        directTransfer: false,
        amount: draft.amount,
        memo: draft.memo,
        isFiatMode: draft.isFiatMode,
        fiatAmount: draft.fiatAmount,
        error: null,
      }))
    }
  }

  // ============= Render =============

  return (
    <div className="relative h-full bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait" initial={false}>
        {(state.step === 'destination' ||
          state.step === 'amount' ||
          state.step === 'confirm' ||
          state.step === 'sending') && (
          <motion.div
            key="send-entry-scene"
            className="relative flex-1 min-h-0"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          >
            {/* Scene pair: destination ↔ amount crossfade while the recipient
                text morphs between them via layoutId. popLayout lifts the
                exiting scene out of flow so the entering one lays out at its
                final geometry immediately (single continuous glide). Scene
                wrappers carry NO opacity animation — each scene fades its own
                content internally so the morphing text never inherits a dimmed
                ancestor opacity mid-flight. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {state.step === 'destination' ? (
                <motion.div key="destination-scene" className="h-full">
                  <SendInputStep
                    onBack={onBack}
                    onNext={handleDestinationNext}
                    onRedirect={onRedirect}
                    initialDestination={state.destination}
                    initialAddress={initialDestination}
                    initialValidatedData={state.validatedData}
                    mintUrl={state.selectedMintUrl || ''}
                    isLoading={isLoading}
                    onRouteValidated={onRouteValidated}
                    onRequestMintSelection={handleRequestMintSelection}
                    onDirectTransfer={handleDirectTransfer}
                  />
                </motion.div>
              ) : (
                /* Whole-scene exit fade: the keypad sits inside a nested
                   AnimatePresence that doesn't receive this parent's exit, so
                   without it the keypad stays opaque while the rest fades on
                   back. Safe for the morph — going back has no layoutId flight. */
                <motion.div
                  key="amount-scene"
                  className="h-full"
                  exit={{ opacity: 0, pointerEvents: 'none' }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <SendAmountStep
                    onBack={
                      state.step === 'sending'
                        ? () => {}
                        : state.step === 'confirm'
                          ? () => setState((prev) => ({ ...prev, step: 'amount', error: null }))
                          : handleAmountBack
                    }
                    onNext={state.directTransfer ? handleDirectAmountNext : handleAmountNext}
                    mintUrl={state.selectedMintUrl || ''}
                    destination={state.destination}
                    validatedData={state.directTransfer ? undefined : state.validatedData || undefined}
                    route={state.routeSelection?.route}
                    initialAmount={state.amount}
                    initialMemo={state.memo}
                    initialFiatMode={state.isFiatMode}
                    initialFiatAmount={state.fiatAmount}
                    isLoading={isLoading}
                    displayName={effectiveDisplayName}
                    directTransfer={state.directTransfer}
                    onChangeMint={(url) => {
                      userMintChoiceRef.current = url
                      routeEpochRef.current++
                      didInitialRouteRef.current = false
                      setState((prev) => ({
                        ...prev,
                        selectedMintUrl: url,
                        error: null,
                        ...(prev.step === 'confirm' && !prev.directTransfer
                          ? { routeSelection: null, fee: 0, quotedBalance: null }
                          : {}),
                      }))
                    }}
                    confirming={state.step === 'confirm' || state.step === 'sending'}
                    sending={state.step === 'sending'}
                    sendingSlow={sendingSlow}
                    sendingFinishing={sendingFinishing}
                    actualFee={state.settledFee ?? undefined}
                    onExitSending={onComplete}
                    feeQuote={
                      state.directTransfer
                        ? directFeeQuote
                        : state.routeSelection
                          ? state.fee
                          : state.fee === 'unavailable'
                            ? 'unavailable'
                            : 'pending'
                    }
                    quotedBalance={state.directTransfer ? directQuotedBalance : state.quotedBalance}
                    onRetryFee={state.directTransfer || state.selectedMintUrl ? handleRetryFee : undefined}
                    confirmError={state.error}
                    confirmMemo={state.memo}
                    onEditMemo={(memo) => setState((prev) => ({ ...prev, memo }))}
                    onCancelConfirm={() => setState((prev) => ({ ...prev, step: 'amount', error: null }))}
                    onConfirmSend={state.directTransfer ? handleCreateTokenConfirm : handleConfirmSend}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
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
              displayName={effectiveDisplayName}
              pending={state.completePending}
              fee={typeof state.fee === 'number' ? state.fee : state.routeSelection?.estimatedFee}
              actualFee={state.settledFee ?? undefined}
              mintUrl={state.selectedMintUrl ?? undefined}
              memo={state.memo || undefined}
            />
          </PageTransition>
        )}

        {state.step === 'created' && (
          /* min-h-0: the wrapper's min-height:auto would otherwise stretch to
             content on short viewports, defeating the step's inner scroller. */
          <PageTransition key="send-created" variant="fade" className="flex-1 min-h-0">
            <DirectReceiptStep
              amount={state.amount}
              memo={state.memo}
              mintUrl={state.selectedMintUrl!}
              tokenString={state.createdToken}
              txId={state.createdTxId}
              onExit={onComplete}
              onReclaim={handleReclaimAndClose}
              onQuoteReclaim={onQuoteReclaim}
            />
          </PageTransition>
        )}
      </AnimatePresence>

      <MintSelectBottomSheet
        isOpen={mintSelection !== null}
        onClose={() => setMintSelection(null)}
        onSelect={handleMintSelected}
        selectedMintUrl={state.selectedMintUrl}
        filterFn={
          mintSelection ? (mint) => mintSelection.commonMintUrls.some((url) => isSameMintUrl(url, mint.url)) : undefined
        }
        buttonLabel={t('common.send')}
        infoText={mintSelection?.infoText}
      />
    </div>
  )
}
