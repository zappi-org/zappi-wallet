/**
 * ReceiveFlow — Unified receive flow container
 * Home receive is request-first: user enters an amount, we publish a
 * Lightning invoice + NUT-18 ecash request on a unified BIP-321 QR.
 *
 * amount → qr → complete
 *
 * Token redeem (paste/scan cashu token) lives in TokenRegisterFlow, not here.
 */

import { useState, useCallback, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { useNetwork } from '@/ui/hooks/use-network'
import { useAppStore } from '@/store'
import { useTranslation } from 'react-i18next'
import { translateError } from '@/ui/utils/error-i18n'

import { useReceiveRequest } from '@/ui/hooks/use-receive-request'
import { ReceiveInputStep } from './steps/ReceiveInputStep'
import { ReceiveQRStep } from './steps/ReceiveQRStep'
import { ReceiveCompleteStep } from './steps/ReceiveCompleteStep'

// ============= Types =============

export type ReceiveStep = 'amount' | 'qr' | 'complete'

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
  onPaymentReceived: (amount: number, type: 'lightning' | 'ecash') => void
  /**
   * P2PK token redemption inside the QR step (when a sender pays the ecash
   * request with a locked token). Full token-receive UX is in TokenRegisterFlow.
   */
  onReceiveToken: (token: string) => Promise<{ success: boolean; amount?: number; error?: { code?: string; message?: string } }>
  // Pre-filled data
  initialAmount?: number
  initialMintUrl?: string | null
}

// ============= Component =============

export function ReceiveFlow({
  onBack,
  onComplete,
  onCreateInvoice,
  onPaymentReceived,
  onReceiveToken,
  initialAmount,
  initialMintUrl,
}: ReceiveFlowProps) {
  const { t } = useTranslation()
  const { isOnline } = useNetwork()
  const addToast = useAppStore((s) => s.addToast)
  const receiveReq = useReceiveRequest()

  const [state, setState] = useState<ReceiveFlowState>({
    step: 'amount',
    method: 'lightning',
    selectedMintUrl: initialMintUrl || null,
    amount: initialAmount || 0,
    invoice: null,
    quoteId: null,
    quoteExpiry: null,
    ecashRequest: null,
    ecashRequestId: null,
    httpEndpoint: null,
    receiveRequestId: null,
    receivedAmount: 0,
  })

  const [isLoading, setIsLoading] = useState(false)
  const isProcessingRef = useRef(false)

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

  const goToStep = useCallback((step: ReceiveStep) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  // ============= Render =============

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe">
      <AnimatePresence mode="wait">
        {state.step === 'amount' && (
          <PageTransition key="receive-amount" variant="page" className="flex-1">
            <ReceiveInputStep
              onBack={onBack}
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
      </AnimatePresence>
    </div>
  )
}
