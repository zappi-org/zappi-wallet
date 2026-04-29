/**
 * ReceiveInputStep — Amount input for receive request creation
 * Conversational "얼마를 요청할까요?" with amount + memo inputs.
 * Creates both Lightning invoice data and eCash payment request simultaneously
 * for unified BIP-321 QR code generation.
 */

import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { hapticTap, hapticError } from '@/ui/utils/haptic'
import { useSatUnit, useFormatFiat } from '@/utils/format'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { usePaymentRequest } from '@/ui/hooks/use-payment-request'
import { useCrypto } from '@/ui/hooks/use-crypto'
import { useMintNut18Support } from '@/ui/hooks/use-mint-nut18-support'

interface ReceiveInputStepProps {
  onBack: () => void
  onNext: (data: {
    amount: number
    mintUrl: string
    ecashRequest?: string
    ecashRequestId?: string
    httpEndpoint?: string
  }) => void
  initialAmount?: number
  initialMintUrl?: string | null
  isLoading?: boolean
}

export function ReceiveInputStep({
  onBack,
  onNext,
  initialAmount = 0,
  initialMintUrl,
  isLoading = false,
}: ReceiveInputStepProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const addToast = useAppStore((s) => s.addToast)

  // Use initialMintUrl directly (no mint selection in this step)
  const mintUrl = initialMintUrl || settings.mints[0] || null

  const unit = useSatUnit()
  const toFiat = useFormatFiat()
  const paymentReq = usePaymentRequest()
  const crypto = useCrypto()

  // State
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState('')

  const {
    isFiatMode, fiatInput, currencySymbol, showFiat, exchangeRate,
    handleToggleFiat, handleFiatChange,
  } = useFiatToggle(amount, setAmount)
  const numericAmount = parseInt(amount, 10) || 0

  // Check if selected mint supports NUT-18 HTTP transport
  const { supportsHttp } = useMintNut18Support(mintUrl)

  // User's nprofile for ecash Nostr transport
  const userNprofile = useMemo(() => {
    if (!nostrPubkey || !settings.relays?.length) return null
    try {
      return crypto.encodeNprofile(nostrPubkey, settings.relays)
    } catch {
      return null
    }
  }, [nostrPubkey, settings.relays, crypto])

  // Handle next — always create ecash request alongside Lightning
  const handleNext = useCallback(() => {
    if (!numericAmount || numericAmount <= 0) {
      addToast({ type: 'error', message: t('receive.amountRequired'), duration: 3000 })
      return
    }
    if (!mintUrl) {
      addToast({ type: 'error', message: t('payment.selectMint'), duration: 3000 })
      return
    }

    hapticTap()

    // Always create ecash payment request for unified QR
    let ecashRequest: string | undefined
    let ecashRequestId: string | undefined
    let httpEndpoint: string | undefined

    if (userNprofile) {
      if (supportsHttp) {
        // Dual transport: Nostr (primary) + HTTP POST (fallback)
        const result = paymentReq.createDualTransportPaymentRequest({
          amount: numericAmount,
          mints: [mintUrl],
          nostrTarget: userNprofile,
          mintUrl: mintUrl,
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
          amount: numericAmount,
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
      console.warn('[ReceiveInputStep] No Nostr profile available, Lightning-only mode')
    }

    onNext({
      amount: numericAmount,
      mintUrl: mintUrl,
      ecashRequest,
      ecashRequestId,
      httpEndpoint,
    })
  }, [numericAmount, memo, mintUrl, userNprofile, supportsHttp, onNext, addToast, t, paymentReq])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('receive.title')} onBack={onBack} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* Question */}
        <h2 className="text-heading font-semibold text-foreground">
          {t('receive.amountStep.howMuchRequest')}
        </h2>

        {/* Amount — underline style, consistent with send */}
        <div className="mt-6">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            {isFiatMode ? (
              <>
                <span className="text-title font-medium text-foreground-muted shrink-0">{currencySymbol}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fiatInput ? Number(fiatInput).toLocaleString() : ''}
                  placeholder="0"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
                  onChange={(e) => handleFiatChange(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent py-1.5 text-title font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
                />
              </>
            ) : (
              <>
                {unit === '₿' && (
                  <span className="text-title font-medium text-foreground-muted shrink-0">{unit}</span>
                )}
                <input
                  type="text"
                  inputMode="numeric"
                  value={amount ? Number(amount).toLocaleString() : ''}
                  placeholder="0"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    if (Number(v) > 2_100_000_000_000_000) return
                    setAmount(v)
                  }}
                  className="flex-1 min-w-0 bg-transparent py-1.5 text-title font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
                />
                {unit !== '₿' && (
                  <span className="text-title font-medium text-foreground-muted shrink-0 ml-1">{unit}</span>
                )}
              </>
            )}
            {exchangeRate && showFiat && (
              <button
                type="button"
                onClick={handleToggleFiat}
                className="flex items-center gap-1 text-body font-semibold text-brand shrink-0 ml-2 px-2.5 py-1 rounded-full bg-brand/8 active:bg-brand/15 transition-colors"
              >
                <span>{isFiatMode ? currencySymbol : unit}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16l-4-4 4-4" /><path d="M17 8l4 4-4 4" /><line x1="3" y1="12" x2="21" y2="12" />
                </svg>
                <span>{isFiatMode ? unit : currencySymbol}</span>
              </button>
            )}
          </div>
          {/* Conversion — fixed height */}
          <div className="h-7 mt-1.5 flex items-center">
            {showFiat && (
              <p className="text-subtitle text-foreground-muted">
                {isFiatMode
                  ? unit === '₿'
                    ? `₿${numericAmount > 0 ? Number(amount).toLocaleString() : '0'}`
                    : `${numericAmount > 0 ? Number(amount).toLocaleString() : '0'} ${unit}`
                  : toFiat(numericAmount) ?? `${currencySymbol}0`
                }
              </p>
            )}
          </div>
        </div>

        {/* Memo — underline style */}
        <div className="mt-6">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
              maxLength={100}
              placeholder={t('receive.amountStep.addMemo')}
              className="flex-1 min-w-0 bg-transparent py-1.5 text-title-sm font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Bottom button */}
      <div className="px-6 pb-6 shrink-0">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          disabled={numericAmount <= 0 || !mintUrl}
          className="w-full"
        >
          {t('receive.next')}
        </Button>
      </div>
    </div>
  )
}
