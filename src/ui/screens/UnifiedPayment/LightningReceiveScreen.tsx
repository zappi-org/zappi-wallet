/**
 * Lightning Receive Screen (Unified)
 * Single screen for receiving Lightning payments: amount + mint selection + QR display
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Zap, Copy, Check, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { useMintHealth, useMintMetadata } from '@/hooks'
import { useAppStore } from '@/store'
import { hapticTap, hapticSuccess, hapticError } from '@/utils/haptic'

import type { MintInfo } from '@/core/types'
import type { ValidatedLnurlWithdraw } from '@/ui/components/scanner'

export interface LightningReceiveScreenProps {
  onBack: () => void
  onComplete?: () => void
  onCreateInvoice: (amount: number, mintUrl: string) => Promise<{
    invoice: string
    quoteId: string
    expiry: number
  } | null>
  onPaymentReceived: (amount: number) => void
  /** Subscribe to quote via WebSocket (wss) first, then fall back to polling */
  onSubscribeToQuote?: (
    mintUrl: string,
    quoteId: string,
    amount: number,
    onPaid: () => void,
    onError?: (error: Error) => void
  ) => Promise<(() => void) | null>
  // Pre-filled data from scanner
  validatedData?: ValidatedLnurlWithdraw
  initialAmount?: number
}

export function LightningReceiveScreen({
  onBack,
  onComplete,
  onCreateInvoice,
  onPaymentReceived,
  onSubscribeToQuote,
  validatedData,
  initialAmount,
}: LightningReceiveScreenProps) {
  const { t } = useTranslation()
  // State
  const [amount, setAmount] = useState<string>(() => initialAmount?.toString() || '')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string>('')
  const [invoice, setInvoice] = useState<string>('')
  const [quoteId, setQuoteId] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>('')

  const [isSuccess, setIsSuccess] = useState(false)
  const [receivedAmount, setReceivedAmount] = useState(0)

  // Hooks
  const settings = useAppStore((s) => s.settings)
  const { checkAllMints, getCachedStatus } = useMintHealth()

  // All mints (for receiving, balance doesn't matter)
  const mintUrls = useMemo(() => settings?.mints ?? [], [settings?.mints])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)

  // Build mint info array
  const mints: MintInfo[] = useMemo(() => {
    return mintUrls.map((url) => ({
      url,
      name: getDisplayName(url),
      iconUrl: getIconUrl(url),
      balance: 0,
      isOnline: getCachedStatus(url)?.isOnline ?? true,
    }))
  }, [mintUrls, getDisplayName, getIconUrl, getCachedStatus])

  // Check mint health on mount only
  useEffect(() => {
    checkAllMints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select first online mint
  useEffect(() => {
    const onlineMint = mints.find((m) => m.isOnline)
    if (onlineMint && !selectedMintUrl) {
      setSelectedMintUrl(onlineMint.url)
    }
  }, [mints, selectedMintUrl])

  // Calculate amounts for LNURL-withdraw
  const numericAmount = parseInt(amount || '0', 10)
  const minAmount = validatedData ? Math.floor(validatedData.params.minWithdrawable / 1000) : 1
  const maxAmount = validatedData ? Math.floor(validatedData.params.maxWithdrawable / 1000) : undefined

  // Validation
  const validationError = useMemo(() => {
    if (numericAmount <= 0) return t('payment.enterAmount')
    if (minAmount && numericAmount < minAmount) return t('payment.minValidation', { amount: minAmount.toLocaleString() })
    if (maxAmount && numericAmount > maxAmount) return t('payment.maxValidation', { amount: maxAmount.toLocaleString() })
    if (!selectedMintUrl) return t('payment.selectMint')
    const selectedMint = mints.find((m) => m.url === selectedMintUrl)
    if (selectedMint && !selectedMint.isOnline) return t('payment.mintSelectedOffline')
    return null
  }, [numericAmount, minAmount, maxAmount, selectedMintUrl, mints, t])

  // Create invoice
  const handleCreateInvoice = useCallback(async () => {
    if (validationError) {
      setError(validationError)
      hapticError()
      return
    }

    setIsCreating(true)
    setError('')
    hapticTap()

    try {
      const result = await onCreateInvoice(numericAmount, selectedMintUrl)
      if (result) {
        setInvoice(result.invoice)
        setQuoteId(result.quoteId)
        setIsWaiting(true)
      } else {
        throw new Error(t('payment.createInvoiceFailed'))
      }
    } catch (err) {
      hapticError()
      const message = err instanceof Error ? err.message : t('payment.createInvoiceError')
      setError(message)
    } finally {
      setIsCreating(false)
    }
  }, [validationError, numericAmount, selectedMintUrl, onCreateInvoice, t])

  // Re-subscribe trigger: when app returns from background, force re-subscription
  // so it immediately detects if the payment was already processed by recoverAll
  const [resubTrigger, setResubTrigger] = useState(0)
  useEffect(() => {
    if (!isWaiting || !quoteId || isSuccess) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setResubTrigger((v) => v + 1)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isWaiting, quoteId, isSuccess])

  // Subscribe to payment — subscribeToQuote handles polling + WebSocket internally
  useEffect(() => {
    if (!isWaiting || !quoteId || !onSubscribeToQuote) return

    let cancelled = false
    let unsubscribe: (() => void) | null = null

    const handlePaid = () => {
      if (cancelled) return
      cancelled = true
      hapticSuccess()
      onPaymentReceived(numericAmount)
      setReceivedAmount(numericAmount)
      setIsSuccess(true)
    }

    const setupSubscription = async () => {
      try {
        const canceller = await onSubscribeToQuote(
          selectedMintUrl,
          quoteId,
          numericAmount,
          handlePaid,
        )

        if (cancelled) {
          canceller?.()
          return
        }

        if (canceller) {
          unsubscribe = canceller
        }
      } catch (err) {
        console.warn('[LightningReceive] Subscription setup failed:', err)
      }
    }

    setupSubscription()

    return () => {
      cancelled = true
      if (unsubscribe) unsubscribe()
    }
  }, [isWaiting, quoteId, numericAmount, selectedMintUrl, onPaymentReceived, onSubscribeToQuote, resubTrigger])

  // Copy invoice
  const addToast = useAppStore((s) => s.addToast)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(invoice)
      setCopied(true)
      hapticTap()
      addToast({
        type: 'success',
        message: t('common.copied'),
        duration: 2000,
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast({
        type: 'error',
        message: t('errors.clipboardError'),
        duration: 3000,
      })
    }
  }, [invoice, addToast, t])

  // Reset to input mode
  const handleReset = useCallback(() => {
    setInvoice('')
    setQuoteId('')
    setIsWaiting(false)
    setError('')
  }, [])

  // Navigate to home after completion (fallback to onBack if onComplete not provided)
  const handleComplete = onComplete ?? onBack
  const handleCompleteRef = useRef(handleComplete)
  handleCompleteRef.current = handleComplete

  // Auto-dismiss success screen after 4 seconds
  useEffect(() => {
    if (!isSuccess) return
    const timer = setTimeout(() => handleCompleteRef.current(), 4000)
    return () => clearTimeout(timer)
  }, [isSuccess])

  // Success Screen
  if (isSuccess) {
    return (
      <div className="h-dvh bg-background text-foreground font-sans flex flex-col items-center justify-center p-6 pt-safe pb-safe">
        <div className="flex flex-col items-center gap-4 animate-scaleIn">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-primary" />
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">₿ {receivedAmount.toLocaleString()}</p>
            <p className="text-foreground-muted mt-2">{t('payment.receiveComplete')}</p>
          </div>
          <button
            onClick={handleComplete}
            className="mt-4 px-8 py-3 bg-accent-warning text-white rounded-xl font-semibold"
          >
            {t('payment.done')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh bg-background text-foreground font-sans flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-visible">
        <button
          onClick={onBack}
          disabled={isCreating}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-border-visible transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5" />
          {t('payment.lightningReceive')}
        </h1>
        <div className="w-9" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        {invoice ? (
          // QR Code Display
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="bg-white p-4 rounded-2xl shadow-lg">
                <QRCodeSVG
                  value={invoice.toUpperCase()}
                  size={200}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#1a1a1a"
                />
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">₿ {numericAmount.toLocaleString()}</p>
                <p className="text-sm text-foreground-muted mt-1">{t('payment.checkingReceipt')}</p>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2 bg-background-card rounded-xl border border-border hover:bg-background-card transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-accent-primary" />
                    <span className="text-sm">{t('common.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span className="text-sm">{t('common.copy')}</span>
                  </>
                )}
              </button>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 py-3 text-foreground-muted hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="text-sm">{t('payment.recreateInvoice')}</span>
            </button>
          </>
        ) : (
          // Input Form
          <>
            {/* LNURL-withdraw info */}
            {validatedData && (
              <div className="px-4 py-3 bg-background-card rounded-xl border border-border">
                <p className="text-xs text-foreground-muted uppercase tracking-wide">{t('payment.withdrawSource')}</p>
                <p className="font-medium">{validatedData.params.domain}</p>
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('common.amount')}</label>
              <div className="mt-1 flex items-center gap-1 px-4 py-3 bg-background-card rounded-xl border border-border">
                <span className="text-foreground-muted shrink-0">₿</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={numericAmount > 0 ? numericAmount.toLocaleString() : ''}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  className="flex-1 text-foreground font-medium bg-transparent focus:outline-none min-w-0"
                  disabled={isCreating}
                />
              </div>
              {minAmount && maxAmount && (
                <p className="mt-1 text-xs text-foreground-muted">
                  ₿ {minAmount.toLocaleString()} ~ ₿ {maxAmount.toLocaleString()}
                </p>
              )}
            </div>

            {/* Mint Selection */}
            <div>
              <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('payment.selectMint')}</label>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {mints.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-background-card/50 rounded-xl text-foreground-muted">
                    <span className="text-sm">{t('payment.noAvailableMints')}</span>
                  </div>
                ) : (
                  mints.map((mint, idx) => (
                    <MintCard
                      key={mint.url}
                      mint={mint}
                      variant={getVariantByIndex(idx)}
                      size="sm"
                      isSelected={selectedMintUrl === mint.url}
                      hideBalance
                      onClick={() => !isCreating && setSelectedMintUrl(mint.url)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                className="flex items-center gap-2 px-4 py-3 bg-accent-danger/10 border border-accent-danger/20 rounded-xl text-accent-danger animate-fadeIn"
              >
                <span className="text-sm">{error}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Action */}
      {!invoice && (
        <div className="p-4 pb-safe border-t border-border-visible bg-background-card">
          <button
            onClick={handleCreateInvoice}
            disabled={isCreating || !!validationError}
            className="w-full py-4 rounded-2xl bg-accent-warning text-white font-semibold text-lg shadow-[0_4px_16px_rgba(212,160,61,0.35)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('common.processing')}
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                {t('payment.lightningReceive')}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default LightningReceiveScreen
