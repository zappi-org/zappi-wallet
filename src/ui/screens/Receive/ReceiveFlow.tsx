/**
 * ReceiveFlow — unified receive conductor (mirrors SendFlow).
 *
 * A zero-tap payable address is the landing; from there the user can specify
 * an amount (request path: Lightning invoice + NUT-18 ecash request on a
 * unified BIP-321 QR) or directly receive a pasted/scanned cashu token
 * (redeem path: trust routing → confirm → receipt).
 *
 * address → request → received
 * address → redeem-confirm-{trusted,untrusted} → received
 */

import { useState, useCallback, useRef, useMemo } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useTranslation } from 'react-i18next'

import { toNumber } from '@/core/domain/amount'
import type { ValidatedCashuToken, ValidatedData } from '@/core/domain/input-types'
import type { BaseError } from '@/core/errors/base'
import { UnknownError } from '@/core/errors/base'
import { TokenSpentError } from '@/core/errors/cashu'
import type { PendingIncomingReview } from '@/core/types'

import { useAppStore } from '@/store'
import { useNetwork } from '@/ui/hooks/use-network'
import { useReceiveRequest } from '@/ui/hooks/use-receive-request'
import { usePaymentRequest } from '@/ui/hooks/use-payment-request'
import { useCrypto } from '@/ui/hooks/use-crypto'
import { useMintNut18Support } from '@/ui/hooks/use-mint-nut18-support'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useTrustRegistry } from '@/ui/hooks/use-trust-registry'
import { translateError } from '@/ui/utils/error-i18n'
import { hapticError } from '@/ui/utils/haptic'

import { ReceiveAddressStep } from './steps/ReceiveAddressStep'
import { ReceiveAmountStep } from './steps/ReceiveAmountStep'
import { ReceiveRequestStep } from './steps/ReceiveRequestStep'
import { ReceiveReceiptStep } from './steps/ReceiveReceiptStep'
import { RedeemSheet } from './redeem/RedeemSheet'
import { ConfirmTrustedStep } from './redeem/ConfirmTrustedStep'
import { ConfirmUntrustedStep } from './redeem/ConfirmUntrustedStep'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'

// ============= Types =============

export type ReceiveStep =
  | 'address' | 'amount' | 'request' | 'received'
  | 'redeem-confirm-trusted' | 'redeem-confirm-untrusted'

/** Result of receiving a pasted/scanned cashu token. */
export interface TokenReceiveOutcome {
  success: boolean
  amount?: number
  transactionId?: string
  error?: BaseError
}

/** Deep-link entry — how MainApp seeds the flow when routed from a scan/action. */
export interface ReceiveLaunch {
  addressTab?: 'lightning' | 'nostr'
  redeemOpen?: boolean
  redeemToken?: string
}

interface ReceiveFlowState {
  step: ReceiveStep
  /** Where the amount step's back arrow returns — landing (create) vs request (edit). */
  amountReturn: 'address' | 'request'
  addressTab: 'lightning' | 'nostr'
  selectedMintUrl: string | null
  amount: number
  memo: string
  // Lightning
  invoice: string | null
  quoteId: string | null
  // Ecash (NUT-18)
  ecashRequest: string | null
  ecashRequestId: string | null
  httpEndpoint: string | null
  // Receive request entity
  receiveRequestId: string | null
  /** Absolute deadline (epoch ms) for the underlying payment request. */
  expiresAt: number | null
  // Result — stamped once at detection, never re-evaluated in render
  receivedAmount: number
  receivedMethod: 'bolt11' | 'ecash' | 'redeem'
  receivedAt: number
  // Redeem
  redeemToken: ValidatedCashuToken | null
}

export interface ReceiveFlowProps {
  onBack: () => void
  onComplete: () => void
  // request path (unchanged from today)
  onCreateInvoice: (amount: number, mintUrl: string) => Promise<{ invoice: string; quoteId: string; expiry: number } | null>
  onPaymentReceived: (amount: number, type: 'lightning' | 'ecash') => void
  onReceiveRequestFulfilled: (token: string, paymentRef: string) => Promise<{ success: boolean; amount?: number; requestFulfilled?: boolean; error?: { code?: string; message?: string } }>
  // redeem path
  onReceiveToken: (token: string) => Promise<TokenReceiveOutcome>
  onAddTrustedMint: (mintUrl: string) => Promise<boolean>
  onEstimateRedeemFee?: (token: string) => Promise<{ grossAmount: number; fee: number; netAmount: number } | null>
  onCheckSelfToken?: (token: string) => Promise<{ txId: string; amount: number } | null>
  onReclaimOwnToken?: (txId: string) => Promise<{ amount: number }>
  onRouteValidated?: (data: ValidatedData) => void
  incomingReview?: PendingIncomingReview | null
  onResolveIncomingReview?: (params: { transactionId?: string }) => Promise<void>
  onRejectIncomingReview?: () => Promise<void>
  // entry
  launch?: ReceiveLaunch | null
  initialAmount?: number
  initialMintUrl?: string | null
  onOpenAddressSettings?: () => void
}

// ============= Component =============

export function ReceiveFlow({
  onBack,
  onComplete,
  onCreateInvoice,
  onPaymentReceived,
  onReceiveRequestFulfilled,
  onReceiveToken,
  onAddTrustedMint,
  onEstimateRedeemFee,
  onCheckSelfToken,
  onReclaimOwnToken,
  onRouteValidated,
  incomingReview = null,
  onResolveIncomingReview,
  onRejectIncomingReview,
  launch,
  initialAmount,
  initialMintUrl,
  onOpenAddressSettings,
}: ReceiveFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)
  const addPendingQuote = useAppStore((s) => s.addPendingQuote)
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const receiveReq = useReceiveRequest()
  const paymentReq = usePaymentRequest()
  const crypto = useCrypto()
  const { isTrusted } = useTrustRegistry()

  const [state, setState] = useState<ReceiveFlowState>(() => {
    // Incoming review (gift-wrap): skip the landing and open the appropriate
    // confirm step with the queued token pre-loaded.
    const review = incomingReview?.token ?? null
    // Deep-linked amount (amount-action) seeds the amount step directly; a queued
    // review still wins over it.
    const initialStep: ReceiveStep = review
      ? (isTrusted(review.mintUrl) ? 'redeem-confirm-trusted' : 'redeem-confirm-untrusted')
      : (initialAmount ?? 0) > 0
        ? 'amount'
        : 'address'
    return {
      step: initialStep,
      amountReturn: 'address',
      addressTab: launch?.addressTab ?? 'lightning',
      selectedMintUrl: initialMintUrl || settings.mints[0] || null,
      amount: initialAmount || 0,
      memo: '',
      invoice: null,
      quoteId: null,
      ecashRequest: null,
      ecashRequestId: null,
      httpEndpoint: null,
      receiveRequestId: null,
      expiresAt: null,
      receivedAmount: 0,
      receivedMethod: 'bolt11',
      receivedAt: 0,
      redeemToken: review,
    }
  })

  // Overlays — reachable from more than one step, so they live at container
  // level (below AnimatePresence) rather than inside a single step fragment: the
  // redeem sheet reopens when backing out of a confirm step, and the mint sheet
  // is shared by the landing and the amount step.
  const [redeemSheetOpen, setRedeemSheetOpen] = useState(() => !!(launch?.redeemOpen || launch?.redeemToken))
  const [mintSheetOpen, setMintSheetOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const isProcessingRef = useRef(false)
  // Set while a manual redeem is finalizing. The render-phase review adjustment
  // below must not swap state mid-flight, or the receipt could describe the
  // wrong token; the deferred review stays unconsumed and surfaces afterward.
  const redeemBusyRef = useRef(false)

  // A review can arrive while the flow is already mounted (MainApp's navigate
  // to 'receive' is then a no-op) and the initializer above ran long ago.
  // Render-phase adjustment (an effect would cascade renders): a genuinely new
  // review — identity changed from the one already consumed — closes the
  // overlays and jumps to its confirm step. An in-progress receipt (received)
  // is never hijacked; the review surfaces on re-entry.
  const [consumedReviewId, setConsumedReviewId] = useState<string | null>(incomingReview?.externalId ?? null)
  if (
    incomingReview &&
    incomingReview.externalId !== consumedReviewId &&
    !redeemBusyRef.current &&
    state.step !== 'received'
  ) {
    setConsumedReviewId(incomingReview.externalId)
    setRedeemSheetOpen(false)
    setMintSheetOpen(false)
    setState((prev) => ({
      ...prev,
      step: isTrusted(incomingReview.token.mintUrl) ? 'redeem-confirm-trusted' : 'redeem-confirm-untrusted',
      redeemToken: incomingReview.token,
    }))
  }

  const { supportsHttp } = useMintNut18Support(state.selectedMintUrl)

  const mintUrls = useMemo(() => (state.selectedMintUrl ? [state.selectedMintUrl] : []), [state.selectedMintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const mintDisplayName = state.selectedMintUrl ? getDisplayName(state.selectedMintUrl) : ''
  const mintIconUrl = state.selectedMintUrl ? getIconUrl(state.selectedMintUrl) ?? null : null

  const npub = useMemo(() => {
    if (!nostrPubkey) return null
    try {
      return crypto.encodeNpub(nostrPubkey)
    } catch {
      return null
    }
  }, [nostrPubkey, crypto])

  const lightningAddress = settings.lightningAddress ?? null

  // User's nprofile for ecash Nostr transport
  const userNprofile = useMemo(() => {
    if (!nostrPubkey || !settings.relays?.length) return null
    try {
      return crypto.encodeNprofile(nostrPubkey, settings.relays)
    } catch {
      return null
    }
  }, [nostrPubkey, settings.relays, crypto])

  // ============= Request path =============

  /**
   * Create both the NUT-18 ecash request and the Lightning invoice, persist the
   * ReceiveRequest entity, then land on the request-QR step. Shared by the
   * amount-sheet confirm and regenerate — ecash creation ported verbatim from
   * ReceiveInputStep.handleNext; invoice + persistence from ReceiveFlow.handleInputNext.
   */
  const createRequest = useCallback(async (amount: number, memo: string, mintUrl: string) => {
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
      // Always create an ecash payment request alongside Lightning for the unified QR
      let ecashRequest: string | undefined
      let ecashRequestId: string | undefined
      let httpEndpoint: string | undefined

      if (userNprofile) {
        if (supportsHttp) {
          // Dual transport: Nostr (primary) + HTTP POST (fallback)
          const result = paymentReq.createDualTransportPaymentRequest({
            amount,
            mints: [mintUrl],
            nostrTarget: userNprofile,
            mintUrl,
            description: memo.trim() || undefined,
            singleUse: true,
            idPrefix: 'wallet',
          })
          ecashRequest = result.request
          ecashRequestId = result.id
          httpEndpoint = result.httpEndpoint
        } else {
          // Nostr-only transport
          const result = paymentReq.createNostrPaymentRequest({
            amount,
            mints: [mintUrl],
            nostrTarget: userNprofile,
            description: memo.trim() || undefined,
            singleUse: true,
            idPrefix: 'wallet',
          })
          ecashRequest = result.request
          ecashRequestId = result.id
        }
      } else {
        // No Nostr profile — Lightning-only fallback (shouldn't happen in zappi-wallet)
        hapticError()
        console.warn('[ReceiveFlow] No Nostr profile available, Lightning-only mode')
      }

      // Always create Lightning invoice
      const invoiceResult = await onCreateInvoice(amount, mintUrl)

      // If Lightning invoice creation fails but we have ecash request, still proceed
      if (!invoiceResult && !ecashRequest) {
        addToast({ type: 'error', message: t('payment.createInvoiceFailed'), duration: 3000 })
        isProcessingRef.current = false
        setIsLoading(false)
        return
      }

      const invoice = invoiceResult?.invoice || null
      const ecashReq = ecashRequest || null

      // Deadline for the underlying payment request (ms epoch). Computed eagerly
      // so it stays in scope for the setState() below even when the persistence
      // block is skipped.
      const expiresAt = invoiceResult?.expiry
        ? invoiceResult.expiry * 1000
        : Date.now() + 30 * 60 * 1000

      // Persist as ReceiveRequest entity (source of truth for pending display)
      let receiveRequestId: string | null = null
      if (invoiceResult || ecashReq) {
        const requestId = globalThis.crypto.randomUUID()

        // Build BIP-321 unified URI if both Lightning + ecash available
        let bip321Uri: string | undefined
        if (invoice && ecashReq) {
          const params = new URLSearchParams()
          params.set('lightning', invoice)
          params.set('creq', ecashReq)
          bip321Uri = `bitcoin:?${params.toString()}`
        }

        try {
          await receiveReq.create({
            requestId,
            accountId: mintUrl,
            amount: { value: BigInt(amount), unit: 'sat' },
            quoteId: invoiceResult?.quoteId,
            bolt11: invoiceResult?.invoice,
            ecashRequest,
            ecashRequestId,
            httpEndpoint: httpEndpoint || undefined,
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
            mintUrl,
            amount,
            invoice: invoiceResult.invoice,
            expiry: expiresAt,
          })
        }
      }

      setState((prev) => ({
        ...prev,
        step: 'request',
        amount,
        memo,
        selectedMintUrl: mintUrl,
        invoice,
        quoteId: invoiceResult?.quoteId || null,
        ecashRequest: ecashReq,
        ecashRequestId: ecashRequestId || null,
        httpEndpoint: httpEndpoint || null,
        receiveRequestId,
        expiresAt,
      }))
    } catch (err) {
      console.error('[ReceiveFlow] createRequest error:', err)
      addToast({ type: 'error', message: translateError(err, t), duration: 3000 })
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [isOnline, userNprofile, supportsHttp, paymentReq, onCreateInvoice, addToast, addPendingQuote, t, receiveReq])

  /** Cancel the current request (if any) and create a fresh one with new inputs. */
  const regenerate = useCallback((amount: number, memo: string) => {
    const mintUrl = state.selectedMintUrl
    if (!mintUrl) return
    if (state.receiveRequestId) {
      void receiveReq.cancel(state.receiveRequestId).catch((err) => console.error('[ReceiveFlow] cancel failed:', err))
    }
    void createRequest(amount, memo, mintUrl)
  }, [state.selectedMintUrl, state.receiveRequestId, receiveReq, createRequest])

  /** Payment detected → stamp the receipt once and print it. */
  const handlePaymentDetected = useCallback((amount: number, method: 'bolt11' | 'ecash') => {
    onPaymentReceived(amount, method === 'bolt11' ? 'lightning' : 'ecash')
    // Close any open overlay so the arrival receipt isn't buried under a sheet.
    // The setState below to 'received' supersedes the amount step if it is live.
    setMintSheetOpen(false)
    setRedeemSheetOpen(false)
    const receivedAt = Date.now()
    setState((prev) => {
      if (prev.receiveRequestId) {
        void receiveReq.complete(prev.receiveRequestId, method)
          .catch((err: unknown) => console.error('[ReceiveFlow] Failed to complete ReceiveRequest:', err))
      }
      return { ...prev, step: 'received', receivedMethod: method, receivedAmount: amount, receivedAt }
    })
  }, [onPaymentReceived, receiveReq])

  // Adapter so the request step's fulfillment callback matches its narrower contract.
  const handleRequestFulfilled = useCallback(async (token: string, paymentRef: string) => {
    const result = await onReceiveRequestFulfilled(token, paymentRef)
    return { amount: result?.amount ?? 0, requestFulfilled: result?.requestFulfilled }
  }, [onReceiveRequestFulfilled])

  // ============= Redeem path =============

  /** Finalize a redeem → resolve any incoming review, then stamp the receipt. */
  const finalizeRedeem = useCallback(async (result: TokenReceiveOutcome, token: ValidatedCashuToken) => {
    // Only resolve the review whose token this actually is: a manual redeem in
    // flight when a different review arrives must not resolve the wrong one.
    if (onResolveIncomingReview && incomingReview?.token.token === token.token) {
      await onResolveIncomingReview({ transactionId: result.transactionId })
    }
    setState((prev) => ({
      ...prev,
      step: 'received',
      receivedMethod: 'redeem',
      receivedAmount: result.amount ?? toNumber(token.amount),
      receivedAt: Date.now(),
    }))
  }, [onResolveIncomingReview, incomingReview])

  const handleRedeemValidated = useCallback(async (token: ValidatedCashuToken) => {
    // Self-owned token (re-registering a pending send) → reclaim instead of
    // redeem to avoid a duplicate timeline entry.
    if (onCheckSelfToken && onReclaimOwnToken) {
      const match = await onCheckSelfToken(token.token)
      if (match) {
        try {
          const result = await onReclaimOwnToken(match.txId)
          setRedeemSheetOpen(false)
          setState((prev) => ({
            ...prev,
            step: 'received',
            receivedMethod: 'redeem',
            receivedAmount: result.amount,
            receivedAt: Date.now(),
            redeemToken: token,
          }))
          return
        } catch (error) {
          console.error('[ReceiveFlow] Reclaim failed:', error)
          addToast({ type: 'error', message: translateError(error, t) })
        }
      }
    }

    // Validate may resolve after a swipe-close: close the sheet unconditionally
    // and proceed to confirm (the user initiated this validate).
    setRedeemSheetOpen(false)
    setState((prev) => ({
      ...prev,
      step: isTrusted(token.mintUrl) ? 'redeem-confirm-trusted' : 'redeem-confirm-untrusted',
      redeemToken: token,
    }))
  }, [onCheckSelfToken, onReclaimOwnToken, isTrusted, addToast, t])

  const handleRedeemReceive = useCallback(async () => {
    const token = state.redeemToken
    if (!token) return
    redeemBusyRef.current = true
    try {
      const result = await onReceiveToken(token.token)
      if (!result.success) {
        if (result.error instanceof TokenSpentError) throw result.error
        throw result.error ?? new UnknownError('redeem_failed')
      }
      await finalizeRedeem(result, token)
    } finally {
      redeemBusyRef.current = false
    }
  }, [state.redeemToken, onReceiveToken, finalizeRedeem])

  const handleRedeemAddAndReceive = useCallback(async () => {
    const token = state.redeemToken
    if (!token) return
    redeemBusyRef.current = true
    try {
      const added = await onAddTrustedMint(token.mintUrl)
      if (!added) throw new Error('add_trust_failed')
      const result = await onReceiveToken(token.token)
      if (!result.success) {
        if (result.error instanceof TokenSpentError) throw result.error
        throw result.error ?? new UnknownError('redeem_failed')
      }
      await finalizeRedeem(result, token)
    } finally {
      redeemBusyRef.current = false
    }
  }, [state.redeemToken, onAddTrustedMint, onReceiveToken, finalizeRedeem])

  // Confirm-step back: in incoming-review mode the user cannot return to the
  // landing (the queue chose this token), so back becomes reject. Otherwise
  // return to the landing and reopen the redeem sheet to try another token.
  const handleConfirmBack = useCallback(() => {
    if (incomingReview && onRejectIncomingReview) {
      void onRejectIncomingReview()
      return
    }
    setState((prev) => ({ ...prev, step: 'address' }))
    setRedeemSheetOpen(true)
  }, [incomingReview, onRejectIncomingReview])

  // Reject: mark the queued review rejected, or (direct-receive) drop the token
  // and return to the landing without reopening the sheet.
  const handleConfirmReject = useCallback(() => {
    if (incomingReview && onRejectIncomingReview) {
      void onRejectIncomingReview()
      return
    }
    setState((prev) => ({ ...prev, step: 'address' }))
  }, [incomingReview, onRejectIncomingReview])

  // ============= Shared overlay handlers =============

  const handleAddressTabChange = useCallback((tab: 'lightning' | 'nostr') => {
    setState((prev) => ({ ...prev, addressTab: tab }))
  }, [])

  const handleMintSelected = useCallback((mintUrl: string) => {
    setState((prev) => ({ ...prev, selectedMintUrl: mintUrl }))
  }, [])

  const handleAmountConfirm = useCallback((data: { amount: number; memo: string }) => {
    regenerate(data.amount, data.memo)
  }, [regenerate])

  // Enter the amount step, remembering where its back arrow returns: the landing
  // (fresh request) vs the request step (edit an existing one).
  const openAmountStep = useCallback((amountReturn: 'address' | 'request') => {
    setState((prev) => ({ ...prev, step: 'amount', amountReturn }))
  }, [])

  const handleAmountBack = useCallback(() => {
    setState((prev) => ({ ...prev, step: prev.amountReturn }))
  }, [])

  const handleMakeAnother = useCallback(() => {
    regenerate(state.amount, state.memo)
  }, [regenerate, state.amount, state.memo])

  // Redeem receipts describe the token (its origin mint holds the redeemed
  // ecash + carries its memo); request receipts describe the selected account.
  const receiptMintUrl = state.receivedMethod === 'redeem'
    ? (state.redeemToken?.mintUrl ?? state.selectedMintUrl)
    : state.selectedMintUrl
  const receiptMemo = state.receivedMethod === 'redeem'
    ? (state.redeemToken?.memo || undefined)
    : (state.memo || undefined)

  // ============= Render =============

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {state.step === 'address' && (
          <PageTransition key="receive-address" variant="page" className="flex-1">
            <ReceiveAddressStep
              onBack={onBack}
              addressTab={state.addressTab}
              onTabChange={handleAddressTabChange}
              lightningAddress={lightningAddress}
              npub={npub}
              mintUrl={state.selectedMintUrl}
              mintIconUrl={mintIconUrl}
              mintDisplayName={mintDisplayName}
              onEditMint={() => setMintSheetOpen(true)}
              onDirectReceive={() => setRedeemSheetOpen(true)}
              onSpecifyAmount={() => openAmountStep('address')}
              onCreateAddress={onOpenAddressSettings}
            />
          </PageTransition>
        )}

        {state.step === 'amount' && (
          <PageTransition key="receive-amount" variant="page" className="flex-1">
            <ReceiveAmountStep
              mintUrl={state.selectedMintUrl}
              mintDisplayName={mintDisplayName}
              mintIconUrl={mintIconUrl}
              onEditMint={() => setMintSheetOpen(true)}
              initialAmount={state.amount}
              initialMemo={state.memo}
              isLoading={isLoading}
              onConfirm={handleAmountConfirm}
              onBack={handleAmountBack}
            />
          </PageTransition>
        )}

        {state.step === 'request' && (
          <PageTransition key="receive-request" variant="page" className="flex-1">
            <ReceiveRequestStep
              onBack={() => setState((prev) => ({ ...prev, step: 'address' }))}
              onEdit={() => openAmountStep('request')}
              onRegenerate={() => regenerate(state.amount, state.memo)}
              isRegenerating={isLoading}
              amount={state.amount}
              mintUrl={state.selectedMintUrl!}
              mintDisplayName={mintDisplayName}
              mintIconUrl={mintIconUrl}
              memo={state.memo}
              invoice={state.invoice}
              quoteId={state.quoteId}
              ecashRequest={state.ecashRequest}
              ecashRequestId={state.ecashRequestId}
              httpEndpoint={state.httpEndpoint}
              expiresAt={state.expiresAt}
              onPaymentDetected={handlePaymentDetected}
              onReceiveRequestFulfilled={handleRequestFulfilled}
            />
          </PageTransition>
        )}

        {state.step === 'received' && (
          <PageTransition key="receive-received" variant="fade" className="flex-1">
            <ReceiveReceiptStep
              amount={state.receivedAmount}
              mintUrl={receiptMintUrl}
              memo={receiptMemo}
              method={state.receivedMethod}
              receivedAt={state.receivedAt}
              onMakeAnother={state.receivedMethod !== 'redeem' ? handleMakeAnother : undefined}
              onExit={onComplete}
            />
          </PageTransition>
        )}

        {state.step === 'redeem-confirm-trusted' && state.redeemToken && (
          <PageTransition key="receive-confirm-trusted" variant="page" className="flex-1">
            <ConfirmTrustedStep
              token={state.redeemToken}
              onBack={handleConfirmBack}
              onReceive={handleRedeemReceive}
              onReject={handleConfirmReject}
              onEstimateRedeemFee={onEstimateRedeemFee}
            />
          </PageTransition>
        )}

        {state.step === 'redeem-confirm-untrusted' && state.redeemToken && (
          <PageTransition key="receive-confirm-untrusted" variant="page" className="flex-1">
            <ConfirmUntrustedStep
              token={state.redeemToken}
              onBack={handleConfirmBack}
              onAddAndReceive={handleRedeemAddAndReceive}
              onReject={handleConfirmReject}
            />
          </PageTransition>
        )}
      </AnimatePresence>

      {/* Overlays — see the container-level note above the useState calls. */}
      <RedeemSheet
        isOpen={redeemSheetOpen}
        onClose={() => setRedeemSheetOpen(false)}
        onValidated={handleRedeemValidated}
        onRouteValidated={onRouteValidated}
        initialToken={launch?.redeemToken}
      />

      <MintSelectBottomSheet
        isOpen={mintSheetOpen}
        onClose={() => setMintSheetOpen(false)}
        onSelect={handleMintSelected}
        selectedMintUrl={state.selectedMintUrl}
        allowEmpty
      />
    </div>
  )
}
