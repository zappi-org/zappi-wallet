/**
 * Lightning Send Screen (Unified)
 * Single screen for Lightning payments: address + amount + mint selection + pay
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Zap, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { useMintHealth, useMintMetadata, useWallet } from '@/hooks'
import { useAppStore } from '@/store'
import { hapticTap, hapticSuccess, hapticError } from '@/utils/haptic'

import type { MintInfo } from '@/core/types'
import type { ValidatedBolt11, ValidatedLightningAddress, ValidatedLnurlPay } from '@/ui/components/scanner'

export interface LightningSendScreenProps {
  onBack: () => void
  onComplete?: () => void
  onSendLightning: (addressOrInvoice: string, amount: number, mintUrl?: string) => Promise<boolean>
  // Pre-filled data from scanner
  validatedData?: ValidatedBolt11 | ValidatedLightningAddress | ValidatedLnurlPay
  initialAmount?: number
}

export function LightningSendScreen({
  onBack,
  onComplete,
  onSendLightning,
  validatedData,
  initialAmount,
}: LightningSendScreenProps) {
  const { t } = useTranslation()
  // State
  const [amount, setAmount] = useState<string>(() => {
    if (validatedData?.type === 'bolt11' && validatedData.amountSats > 0) {
      return validatedData.amountSats.toString()
    }
    return initialAmount?.toString() || ''
  })
  const [destination, setDestination] = useState<string>(() => {
    if (validatedData?.type === 'bolt11') return validatedData.invoice
    if (validatedData?.type === 'lightning-address') return validatedData.address
    if (validatedData?.type === 'lnurl-pay') return validatedData.lnurl
    return ''
  })
  const [selectedMintUrl, setSelectedMintUrl] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [sentAmount, setSentAmount] = useState(0)
  const [error, setError] = useState<string>('')
  const isSendingRef = useRef(false)

  // Hooks
  const { balance } = useWallet()
  const settings = useAppStore((s) => s.settings)
  const { checkAllMints, getCachedStatus } = useMintHealth()

  // Mints with balance
  const mintsWithBalance = useMemo(() => {
    return (settings?.mints || [])
      .map((url) => {
        // Normalize URL for balance lookup (remove trailing slash)
        const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
        return {
          url,
          balance: balance.byMint[normalizedUrl] || balance.byMint[url] || 0,
          isOnline: getCachedStatus(url)?.isOnline ?? true,
        }
      })
      .filter((m) => m.balance > 0)
  }, [settings?.mints, balance.byMint, getCachedStatus])

  const { getDisplayName, getIconUrl } = useMintMetadata(mintsWithBalance.map((m) => m.url))

  // Build mint info array
  const mints: MintInfo[] = useMemo(() => {
    return mintsWithBalance.map((m) => ({
      url: m.url,
      name: getDisplayName(m.url),
      iconUrl: getIconUrl(m.url),
      balance: m.balance,
      isOnline: m.isOnline,
    }))
  }, [mintsWithBalance, getDisplayName, getIconUrl])

  // Check mint health on mount only
  useEffect(() => {
    checkAllMints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select first mint with sufficient balance
  useEffect(() => {
    const numericAmt = parseInt(amount || '0', 10)
    const suitableMint = mints.find((m) => m.balance >= numericAmt && m.isOnline)
    if (suitableMint && !selectedMintUrl) {
      setSelectedMintUrl(suitableMint.url)
    }
  }, [mints, amount, selectedMintUrl])

  // Calculate amounts
  const numericAmount = parseInt(amount || '0', 10)
  const selectedMint = mints.find((m) => m.url === selectedMintUrl)
  const isAmountFixed = validatedData?.type === 'bolt11' && validatedData.amountSats > 0
  const minAmount = validatedData?.type === 'lnurl-pay' ? Math.floor(validatedData.params.minSendable / 1000) : 1
  const maxAmount = validatedData?.type === 'lnurl-pay' ? Math.floor(validatedData.params.maxSendable / 1000) : undefined

  // Validation
  const validationError = useMemo(() => {
    if (!destination) return t('payment.enterDestination')
    if (numericAmount <= 0) return t('payment.enterAmount')
    if (minAmount && numericAmount < minAmount) return t('payment.minAmountError', { amount: minAmount.toLocaleString() })
    if (maxAmount && numericAmount > maxAmount) return t('payment.maxAmountError', { amount: maxAmount.toLocaleString() })
    if (!selectedMint) return t('payment.selectMint')
    if (selectedMint.balance < numericAmount) return `${t('payment.insufficientBalance')} (${selectedMint.balance.toLocaleString()} sats)`
    if (!selectedMint.isOnline) return t('payment.mintOffline')
    return null
  }, [destination, numericAmount, minAmount, maxAmount, selectedMint, t])

  // Handle send (ref-based guard prevents double-tap during async gap before state update)
  const handleSend = useCallback(async () => {
    if (isSendingRef.current) return
    if (validationError) {
      setError(validationError)
      hapticError()
      return
    }

    isSendingRef.current = true
    setIsLoading(true)
    setError('')
    hapticTap()

    try {
      const success = await onSendLightning(destination, numericAmount, selectedMintUrl || undefined)
      if (success) {
        hapticSuccess()
        setSentAmount(numericAmount)
        setIsSuccess(true)
      } else {
        throw new Error(t('payment.sendFailed'))
      }
    } catch (err) {
      hapticError()
      const message = err instanceof Error ? err.message : t('payment.sendFailed')
      setError(message)
    } finally {
      isSendingRef.current = false
      setIsLoading(false)
    }
  }, [validationError, destination, numericAmount, selectedMintUrl, onSendLightning, t])

  // Get destination display text (for pre-filled data)
  const destinationDisplay = useMemo(() => {
    if (validatedData?.type === 'bolt11') {
      // Show truncated invoice (e.g., "lnbc...xyz")
      const inv = validatedData.invoice
      if (inv.length > 20) {
        return `${inv.slice(0, 10)}...${inv.slice(-6)}`
      }
      return inv
    }
    if (validatedData?.type === 'lightning-address') {
      return validatedData.address
    }
    if (validatedData?.type === 'lnurl-pay') {
      // Try to extract identifier (lightning address) from metadata
      try {
        const metadata = JSON.parse(validatedData.params.metadata)
        const identifier = metadata.find((m: string[]) => m[0] === 'text/identifier')
        if (identifier?.[1]) {
          return identifier[1]
        }
      } catch {
        // Ignore parse errors
      }
      return validatedData.params.domain
    }
    return destination
  }, [validatedData, destination])

  // Get BOLT11 memo (separate display)
  const bolt11Memo = useMemo(() => {
    if (validatedData?.type === 'bolt11' && validatedData.description) {
      return validatedData.description
    }
    return null
  }, [validatedData])

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
        <div
          className="flex flex-col items-center gap-4 animate-scaleIn"
        >
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-primary" />
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">₿ {sentAmount.toLocaleString()}</p>
            <p className="text-foreground-muted mt-2">{t('payment.sendComplete')}</p>
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
          disabled={isLoading}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-border-visible transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5" />
          {t('payment.lightningSend')}
        </h1>
        <div className="w-9" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        {/* Destination */}
        <div>
          <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('payment.destination')}</label>
          {validatedData ? (
            <div className="mt-1 px-4 py-3 bg-background-card rounded-xl border border-border text-foreground font-medium truncate">
              {destinationDisplay}
            </div>
          ) : (
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={t('payment.lightningAddressPlaceholder')}
              className="mt-1 w-full px-4 py-3 bg-background-card rounded-xl border border-border text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-primary"
              disabled={isLoading}
            />
          )}
        </div>

        {/* BOLT11 Memo (separate display) */}
        {bolt11Memo && (
          <div>
            <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('common.memo')}</label>
            <div className="mt-1 px-4 py-3 bg-background-card rounded-xl border border-border-visible text-foreground-muted text-sm">
              {bolt11Memo}
            </div>
          </div>
        )}

        {/* Amount */}
        <div>
          <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('common.amount')}</label>
          {isAmountFixed ? (
            <div className="mt-1 px-4 py-3 bg-background-card rounded-xl border border-border text-foreground font-medium">
              ₿ {numericAmount.toLocaleString()}
            </div>
          ) : (
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
                disabled={isLoading}
              />
            </div>
          )}
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
              <div className="text-sm text-secondary">{t('payment.noAvailableMints')}</div>
            ) : (
              mints.map((mint, idx) => (
                <MintCard
                  key={mint.url}
                  mint={mint}
                  variant={getVariantByIndex(idx)}
                  size="sm"
                  isSelected={selectedMintUrl === mint.url}
                  onClick={() => !isLoading && setSelectedMintUrl(mint.url)}
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
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}
      </div>

      {/* Bottom Action */}
      <div className="p-4 pb-safe border-t border-border-visible bg-background-card">
        <button
          onClick={handleSend}
          disabled={isLoading || !!validationError}
          className="w-full py-4 rounded-2xl bg-accent-warning text-white font-semibold text-lg shadow-[0_4px_16px_rgba(212,160,61,0.35)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('payment.sending')}
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              {numericAmount > 0 ? `₿ ${numericAmount.toLocaleString()} ${t('payment.send')}` : t('payment.send')}
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default LightningSendScreen
