/**
 * Ecash Receive Screen (Unified)
 * Single screen for receiving Ecash: displays NUT-18 payment request QR with Nostr transport
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Banknote, Copy, Check, Loader2, RefreshCw, Radio, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { useMintHealth, useMintMetadata } from '@/hooks'
import { useAppStore } from '@/store'
import { hapticTap, hapticError, hapticSuccess } from '@/utils/haptic'
import { createNostrPaymentRequest } from '@/services/cashu/nut18'
import { encodeNpub, encodeNprofile } from '@/services/crypto'
import type { MintInfo } from '@/core/types'

export interface EcashReceiveScreenProps {
  onBack: () => void
  onComplete?: () => void
  onPaymentReceived?: (amount: number) => void
  initialAmount?: number
}

export function EcashReceiveScreen({
  onBack,
  onComplete,
  onPaymentReceived,
  initialAmount,
}: EcashReceiveScreenProps) {
  const { t } = useTranslation()
  // State
  const [amount, setAmount] = useState<string>(initialAmount?.toString() || '')
  const [selectedMintUrls, setSelectedMintUrls] = useState<string[]>([])
  const [request, setRequest] = useState<string>('')
  const [requestId, setRequestId] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>('')
  const [isReceived, setIsReceived] = useState(false)
  const [receivedAmount, setReceivedAmount] = useState(0)

  // Hooks
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)

  // Subscribe to incoming NUT-18 payments from GiftWrapListener
  const lastReceivedRequestId = useAppStore((s) => s.lastReceivedRequestId)
  const lastReceivedAmount = useAppStore((s) => s.lastReceivedAmount)
  const setLastReceivedPayment = useAppStore((s) => s.setLastReceivedPayment)
  const { checkAllMints, getCachedStatus } = useMintHealth()

  // All mints
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

  // Auto-select all online mints
  useEffect(() => {
    if (selectedMintUrls.length === 0) {
      const onlineMints = mints.filter((m) => m.isOnline).map((m) => m.url)
      if (onlineMints.length > 0) {
        setSelectedMintUrls(onlineMints)
      }
    }
  }, [mints, selectedMintUrls.length])

  const numericAmount = parseInt(amount || '0', 10)

  // User's relays for Nostr transport
  const relays = useMemo(() => settings?.relays ?? [], [settings?.relays])

  // User's npub (for display)
  const userNpub = useMemo(() => {
    if (!nostrPubkey) return null
    try {
      return encodeNpub(nostrPubkey)
    } catch {
      return null
    }
  }, [nostrPubkey])

  // User's nprofile with relay hints (for Nostr transport)
  // Using nprofile ensures cashu.me knows which relays to send the DM to
  const userNprofile = useMemo(() => {
    if (!nostrPubkey || relays.length === 0) return null
    try {
      return encodeNprofile(nostrPubkey, relays)
    } catch {
      return null
    }
  }, [nostrPubkey, relays])

  // Validation
  const validationError = useMemo(() => {
    if (numericAmount <= 0) return t('payment.enterAmount')
    if (selectedMintUrls.length === 0) return t('payment.selectMint')
    if (!userNprofile) return t('errors.generic')
    return null
  }, [numericAmount, selectedMintUrls, userNprofile, t])

  // Toggle mint selection
  const toggleMint = useCallback((url: string) => {
    setSelectedMintUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    )
  }, [])

  // Create request with Nostr transport
  const handleCreateRequest = useCallback(async () => {
    if (validationError || !userNprofile) {
      setError(validationError || t('errors.generic'))
      hapticError()
      return
    }

    setIsCreating(true)
    setError('')
    hapticTap()

    try {
      // Create NUT-18 payment request with Nostr transport
      // Using nprofile (with relay hints) so payers know where to send the DM
      const result = createNostrPaymentRequest({
        amount: numericAmount,
        mints: selectedMintUrls,
        nostrTarget: userNprofile,
        description: `${t('payment.ecashReceive')} - ${numericAmount} sats`,
        singleUse: true,
        idPrefix: 'wallet',
      })

      setRequest(result.request)
      setRequestId(result.id)
      console.log(`[EcashReceive] Created request with ID: ${result.id}`)
      hapticSuccess()
    } catch (err) {
      hapticError()
      const message = err instanceof Error ? err.message : t('errors.generic')
      setError(message)
    } finally {
      setIsCreating(false)
    }
  }, [validationError, numericAmount, selectedMintUrls, userNprofile, t])

  // Copy request
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(request)
      setCopied(true)
      hapticTap()
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore
    }
  }, [request])

  // Reset
  const handleReset = useCallback(() => {
    setRequest('')
    setError('')
    setIsReceived(false)
  }, [])

  // Listen for incoming tokens via GiftWrapListener
  // When a token matching our request is received, show success state
  useEffect(() => {
    if (!requestId || !lastReceivedRequestId) return

    if (lastReceivedRequestId === requestId) {
      console.log(`[EcashReceive] Payment received for request: ${requestId}, amount: ${lastReceivedAmount}`)
      setReceivedAmount(lastReceivedAmount)
      setIsReceived(true)
      hapticSuccess()
      onPaymentReceived?.(lastReceivedAmount)
      // Clear the store state so it doesn't trigger again
      setLastReceivedPayment(null, 0)
    }
  }, [requestId, lastReceivedRequestId, lastReceivedAmount, setLastReceivedPayment, onPaymentReceived])

  // Navigate to home after completion (fallback to onBack if onComplete not provided)
  const handleComplete = onComplete ?? onBack
  const handleCompleteRef = useRef(handleComplete)
  handleCompleteRef.current = handleComplete

  // Auto-dismiss success screen after 4 seconds
  useEffect(() => {
    if (!isReceived) return
    const timer = setTimeout(() => handleCompleteRef.current(), 4000)
    return () => clearTimeout(timer)
  }, [isReceived])

  // Success screen
  if (isReceived) {
    return (
      <div className="h-dvh bg-background text-foreground font-sans flex flex-col items-center justify-center p-6 pt-safe pb-safe">
        <div
          className="flex flex-col items-center gap-4 animate-scaleIn"
        >
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-primary" />
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">₿ {receivedAmount.toLocaleString()}</p>
            <p className="text-foreground-muted mt-2">{t('payment.paymentReceived')}</p>
          </div>
          <button
            onClick={handleComplete}
            className="mt-4 px-8 py-3 bg-accent-primary text-white rounded-xl font-semibold"
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
          <Banknote className="w-5 h-5" />
          {t('payment.ecashReceive')}
        </h1>
        <div className="w-9" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        {request ? (
          // QR Code Display with Listening State
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="bg-white p-4 rounded-2xl shadow-lg">
                <QRCodeSVG
                  value={request}
                  size={200}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#1a1a1a"
                />
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">₿ {numericAmount.toLocaleString()}</p>
              </div>

              {/* Listening indicator */}
              <div
                className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full animate-fadeIn"
              >
                <div className="animate-pulseScale">
                  <Radio className="w-4 h-4 text-accent-primary" />
                </div>
                <span className="text-sm text-foreground-muted">{t('payment.waitingNostrDm')}</span>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
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
            </div>

            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 py-3 text-foreground-muted hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="text-sm">{t('payment.createRequest')}</span>
            </button>
          </>
        ) : (
          // Input Form
          <>
            {/* Nostr Info */}
            {userNpub && (
              <div className="px-4 py-3 bg-background-card rounded-xl border border-border">
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">{t('payment.recipient')} (Nostr)</p>
                <p className="text-sm font-mono text-foreground">
                  <span className="text-foreground-muted">npub1</span>
                  <span className="text-accent-primary">{userNpub.slice(5, 9)}</span>
                  <span className="text-foreground-muted/50">...</span>
                  <span className="text-foreground">{userNpub.slice(Math.floor(userNpub.length / 2) - 2, Math.floor(userNpub.length / 2) + 2)}</span>
                  <span className="text-foreground-muted/50">...</span>
                  <span className="text-accent-warning">{userNpub.slice(-4)}</span>
                </p>
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('payment.amount')}</label>
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
            </div>

            {/* Mint Selection (multiple) */}
            <div>
              <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                {t('payment.selectMint')} ({selectedMintUrls.length})
              </label>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {mints.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-background-card/50 rounded-xl text-foreground-muted">
                    <span className="text-sm">{t('settings.noMints')}</span>
                  </div>
                ) : (
                  mints.map((mint, idx) => (
                    <MintCard
                      key={mint.url}
                      mint={mint}
                      variant={getVariantByIndex(idx)}
                      size="sm"
                      isSelected={selectedMintUrls.includes(mint.url)}
                      hideBalance
                      onClick={() => !isCreating && toggleMint(mint.url)}
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
      {!request && (
        <div className="p-4 pb-safe border-t border-border-visible bg-background-card">
          <button
            onClick={handleCreateRequest}
            disabled={isCreating || !!validationError}
            className="w-full py-4 rounded-2xl bg-accent-primary text-white font-semibold text-lg shadow-[0_4px_16px_rgba(91,122,84,0.35)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('payment.creating')}
              </>
            ) : (
              <>
                <Banknote className="w-5 h-5" />
                {t('payment.createRequest')}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default EcashReceiveScreen
