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
import { sendTokenViaDM, getRecipientDMRelays } from '@/services/nostr-dm'
import { sendTokenViaHttp } from '@/services/cashu/nut18-http'
import { useAppStore } from '@/store'
import { useTranslation } from 'react-i18next'
import { createMeltQuote } from '@/coco/cashuService'
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
} from '@/ui/components/scanner/InputValidator'

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

export interface SendFlowState {
  step: SendStep
  selectedMintUrl: string | null
  destination: string
  validatedData: SendableValidatedData | null
  amount: number
  memo: string
  createdToken: string | null
  fee: number
  meltQuoteId: string | null
  error: string | null
  // NUT-18 specific
  dmSent: boolean
}

export interface SendFlowProps {
  onBack: () => void
  onComplete: () => void
  // MainApp handlers
  onSendLightning: (addressOrInvoice: string, amount: number, mintUrl?: string) => Promise<boolean>
  onCreateEcashToken: (amount: number, mintUrl?: string, options?: { p2pkPubkey?: string; memo?: string }) => Promise<string | null>
  onReceiveToken: (token: string) => Promise<boolean | { success: boolean; amount?: number }>
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
  onSendLightning,
  onCreateEcashToken,
  onReceiveToken,
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
    return ['bolt11', 'lightning-address', 'lnurl-pay', 'cashu-request'].includes(data.type)
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
    fee: 0,
    meltQuoteId: null,
    error: null,
    dmSent: false,
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

      // Get fee estimate for Lightning payments
      let fee = 0
      let meltQuoteId: string | null = null

      if (validated.type === 'bolt11') {
        try {
          const quote = await createMeltQuote(data.selectedMintUrl, validated.invoice)
          fee = quote.fee_reserve
          meltQuoteId = quote.quote
        } catch (err) {
          console.error('[SendFlow] Melt quote failed:', err)
          addToast({ type: 'error', message: t('payment.feeEstimateFailed'), duration: 3000 })
          isProcessingRef.current = false
          setIsLoading(false)
          return
        }
      }

      setState((prev) => ({
        ...prev,
        step: 'confirm',
        destination: data.destination,
        amount: data.amount,
        selectedMintUrl: data.selectedMintUrl,
        validatedData: validated!,
        fee,
        meltQuoteId,
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

  /** Confirm step → execute send */
  const handleConfirmSend = useCallback(async () => {
    if (isProcessingRef.current || !state.validatedData || !state.selectedMintUrl) return

    if (!isOnline) {
      addToast({ type: 'error', message: t('common.offlineRequired'), duration: 3000 })
      return
    }
    isProcessingRef.current = true

    setState((prev) => ({ ...prev, step: 'sending', error: null }))

    try {
      const { validatedData, amount, selectedMintUrl } = state

      let success = false

      switch (validatedData.type) {
        case 'bolt11':
          success = await onSendLightning(validatedData.invoice, amount, selectedMintUrl)
          break

        case 'lightning-address':
          success = await onSendLightning(validatedData.address, amount, selectedMintUrl)
          break

        case 'lnurl-pay':
          success = await onSendLightning(validatedData.lnurl, amount, selectedMintUrl)
          break

        case 'cashu-request': {
          // Create ecash token with P2PK if specified
          const token = await onCreateEcashToken(amount, selectedMintUrl, {
            p2pkPubkey: validatedData.parsed.p2pkPubkey,
            memo: state.memo || validatedData.parsed.description,
          })

          if (token) {
            const memo = state.memo || validatedData.parsed.description

            // Try Nostr transport first (primary)
            if (validatedData.parsed.hasNostrTransport && validatedData.parsed.nostrTarget) {
              const nostrPrivkey = useAppStore.getState().nostrPrivkey
              const settings = useAppStore.getState().settings

              if (nostrPrivkey) {
                try {
                  const relays = await getRecipientDMRelays(
                    validatedData.parsed.nostrTarget,
                    settings.relays || []
                  )
                  const dmResult = await sendTokenViaDM({
                    recipientPubkey: validatedData.parsed.nostrTarget,
                    token,
                    memo,
                    requestId: validatedData.parsed.id,
                    senderPrivkey: nostrPrivkey,
                    relays,
                  })
                  success = dmResult.success
                  if (dmResult.success) {
                    setState((prev) => ({ ...prev, dmSent: true }))
                  }
                } catch (err) {
                  console.warn('[SendFlow] Nostr DM failed, checking HTTP fallback:', err)
                  success = false
                }
              }
            }

            // Fallback to HTTP POST if Nostr failed or unavailable
            if (!success && validatedData.parsed.hasPostTransport && validatedData.parsed.postTarget) {
              console.log('[SendFlow] Attempting HTTP POST fallback')
              const httpResult = await sendTokenViaHttp({
                endpoint: validatedData.parsed.postTarget,
                token,
                requestId: validatedData.parsed.id,
                memo,
              })
              success = httpResult.success
            }

            // No transport available — token was created, treat as success
            if (!success && !validatedData.parsed.hasNostrTransport && !validatedData.parsed.hasPostTransport) {
              success = true
            }
          }
          break
        }
      }

      if (success) {
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
  }, [state, onSendLightning, onCreateEcashToken, isOnline, addToast, t])

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
      const token = await onCreateEcashToken(data.amount, data.mintUrl, {
        memo: data.memo || undefined,
      })

      if (token) {
        setState((prev) => ({
          ...prev,
          step: 'token-created',
          createdToken: token,
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

  /** Token created → cancel (reclaim token) */
  const handleTokenCancel = useCallback(async () => {
    if (!state.createdToken) return

    try {
      await onReceiveToken(state.createdToken)
      setState((prev) => ({
        ...prev,
        step: 'token-create',
        createdToken: null,
      }))
    } catch {
      addToast({ type: 'error', message: t('payment.tokenReclaimFailed'), duration: 3000 })
    }
  }, [state.createdToken, onReceiveToken, addToast, t])

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
                  meltQuoteId: null,
                  error: null,
                }))
              }}
              onConfirm={handleConfirmSend}
              validatedData={state.validatedData!}
              amount={state.amount}
              fee={state.fee}
              mintUrl={state.selectedMintUrl!}
              error={state.error}
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
              fee={state.fee}
              onComplete={onComplete}
            />
          </PageTransition>
        )}
      </AnimatePresence>
    </div>
  )
}
