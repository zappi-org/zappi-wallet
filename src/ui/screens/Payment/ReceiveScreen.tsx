import { useState, useCallback, useEffect, useMemo, useRef } from 'react'

import { QRCodeSVG } from 'qrcode.react'
import { getDecodedToken } from '@cashu/cashu-ts'
import { ArrowLeft, Zap, Banknote, Clipboard, Share2, CheckCircle2, Delete, QrCode, SmartphoneNfc, AudioWaveform } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QrScanner } from '../../components/common'
import { isP2PKLockedToUser } from '@/utils/token'
import { useAppStore } from '@/store'
import { useMintHealth, useMintMetadata } from '@/hooks'
import { cn } from '@/components/ui/utils'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { FailedSwapRepository } from '@/data/repositories/failed-swap.repository'

import type { MintInfo, FailedSwap } from '@/core/types'

interface TokenPreview {
  amount: number
  mintUrl: string
  memo?: string
}

/** Extract hostname from mint URL for display */
function formatMintUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

type Step = 'amount' | 'lightning' | 'ecash'
type EcashMethod = 'scan' | 'nfc' | 'ggwave'

export interface ReceiveScreenProps {
  onBack: () => void
  onCreateInvoice: (amount: number, mintUrl: string) => Promise<{ invoice: string; quoteId: string; expiry?: number } | null>
  onReceiveToken: (token: string) => Promise<{ success: boolean; amount?: number; transactionId?: string }>
  onPaymentReceived?: (amount: number, type: 'lightning' | 'ecash', transactionId?: string) => void
  /** Subscribe to quote via WebSocket (wss) first, then fall back to polling */
  onSubscribeToQuote?: (
    mintUrl: string,
    quoteId: string,
    amount: number,
    onPaid: () => void,
    onError?: (error: Error) => void
  ) => Promise<(() => void) | null>
  trustedMints?: string[]
  onAddTrustedMint?: (mintUrl: string) => Promise<boolean>
  initialAmount?: number
}

// Success Confetti (CSS-based)
const SuccessConfetti = () => {
  const [particleData] = useState(() =>
    Array.from({ length: 40 }, (_, i) => ({
      tx: (Math.random() - 0.5) * 100,
      ty: (Math.random() - 0.5) * 100,
      rot: Math.random() * 360,
      duration: 1 + Math.random() * 1.5,
      delay: Math.random() * 0.2,
      colorIndex: i % 4,
    }))
  )
  const colors = useMemo(() => {
    const style = getComputedStyle(document.documentElement)
    return [
      style.getPropertyValue('--accent-primary').trim() || '#5B7A54',
      style.getPropertyValue('--accent-success').trim() || '#5B7A54',
      style.getPropertyValue('--foreground-subtle').trim() || '#ABABAB',
      style.getPropertyValue('--secondary').trim() || '#EDEAE6',
    ]
  }, [])
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {particleData.map((p, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-full animate-confetti"
          style={{
            backgroundColor: colors[p.colorIndex],
            left: '50%',
            top: '50%',
            ['--tx' as string]: `${p.tx}vw`,
            ['--ty' as string]: `${p.ty}vh`,
            ['--rot' as string]: `${p.rot}deg`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

export function ReceiveScreen({
  onBack,
  onCreateInvoice,
  onReceiveToken,
  onPaymentReceived,
  onSubscribeToQuote,
  trustedMints = [],
  onAddTrustedMint,
  initialAmount,
}: ReceiveScreenProps) {

  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(initialAmount ? 'lightning' : 'amount')
  const [amount, setAmount] = useState(initialAmount ? initialAmount.toString() : '0')
  const [invoice, setInvoice] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [invoiceMintUrl, setInvoiceMintUrl] = useState<string>('')
  const [quoteExpiry, setQuoteExpiry] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isPaid, setIsPaid] = useState(false)
  const [isExpired, setIsExpired] = useState(false)
  const [error, setError] = useState('')
  const [receivedAmount, setReceivedAmount] = useState(0)
  const [isAddingTrust, setIsAddingTrust] = useState(false)
  const [ecashMethod, setEcashMethod] = useState<EcashMethod>('scan')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string>('')
  const numericAmount = parseInt(amount || '0', 10)

  const mintBalances = useAppStore((state) => state.balance.byMint)
  const { ensureOnlineMint, checkAllMints, getCachedStatus } = useMintHealth()
  const { getDisplayName, getIconUrl } = useMintMetadata(trustedMints)

  // Check mint health on mount
  useEffect(() => {
    if (trustedMints.length > 0) {
      checkAllMints()
    }
  }, [trustedMints, checkAllMints])

  // Build mint info for cards with actual online status and metadata
  const mintInfos = useMemo((): MintInfo[] => {
    return trustedMints.map((url) => {
      const cachedStatus = getCachedStatus(url)
      // Normalize URL for balance lookup (remove trailing slash to match wallet.service.ts)
      const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
      return {
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
        balance: mintBalances[normalizedUrl] || mintBalances[url] || 0,
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      }
    })
  }, [trustedMints, mintBalances, getCachedStatus, getDisplayName, getIconUrl])

  useEffect(() => {
    if (trustedMints.length > 0 && !selectedMintUrl) {
      setSelectedMintUrl(trustedMints[0])
    }
  }, [trustedMints, selectedMintUrl])

  const activeMintUrl = selectedMintUrl || (trustedMints.length > 0 ? trustedMints[0] : '')

  const tokenPreview = useMemo((): TokenPreview | null => {
    const trimmed = tokenInput.trim()
    if (!trimmed || !trimmed.startsWith('cashu')) return null
    try {
      const decoded = getDecodedToken(trimmed)
      const amt = decoded.proofs.reduce((sum, p) => sum + p.amount, 0)
      return { amount: amt, mintUrl: decoded.mint, memo: decoded.memo }
    } catch {
      return null
    }
  }, [tokenInput])

  const isTrustedMint = useMemo(() => {
    if (!tokenPreview) return true
    return trustedMints.some((m) => m === tokenPreview.mintUrl)
  }, [tokenPreview, trustedMints])

  const handleAddTrust = useCallback(async () => {
    if (!tokenPreview || !onAddTrustedMint) return
    setIsAddingTrust(true)
    try {
      const success = await onAddTrustedMint(tokenPreview.mintUrl)
      if (!success) setError(t('pos.mintTrustAddFailed'))
    } catch {
      setError(t('errors.generic'))
    } finally {
      setIsAddingTrust(false)
    }
  }, [tokenPreview, onAddTrustedMint, t])

  // Countdown timer
  useEffect(() => {
    if (!quoteExpiry || isPaid || isExpired) {
      setRemainingSeconds(null)
      return
    }
    const updateCountdown = () => {
      const now = Date.now()
      const remaining = Math.max(0, Math.floor((quoteExpiry - now) / 1000))
      setRemainingSeconds(remaining)
      if (remaining <= 0) {
        setIsExpired(true)
        setError(t('pos.invoiceExpired'))
      }
    }
    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [quoteExpiry, isPaid, isExpired, t])

  // Subscribe to payment — subscribeToQuote handles polling + WebSocket internally
  // Uses invoiceMintUrl (the mint that actually created the invoice) not activeMintUrl
  useEffect(() => {
    if (!quoteId || !invoiceMintUrl || isPaid || isExpired || !onSubscribeToQuote) return

    let isPaidHandled = false
    let unsubscribe: (() => void) | null = null

    const handlePaid = () => {
      if (isPaidHandled) return
      isPaidHandled = true
      setIsPaid(true)
      onPaymentReceived?.(numericAmount, 'lightning', `tx-${quoteId}`)
    }

    const setupSubscription = async () => {
      try {
        const canceller = await onSubscribeToQuote(
          invoiceMintUrl,
          quoteId,
          numericAmount,
          handlePaid,
        )

        if (isPaidHandled) {
          canceller?.()
          return
        }

        if (canceller) {
          unsubscribe = canceller
        }
      } catch (err) {
        console.warn('[ReceiveScreen] Subscription setup failed:', err)
      }
    }

    setupSubscription()

    return () => {
      isPaidHandled = true
      if (unsubscribe) unsubscribe()
    }
  }, [quoteId, invoiceMintUrl, isPaid, isExpired, numericAmount, onPaymentReceived, onSubscribeToQuote])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 4000)
    return () => clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (error) setError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenInput])

  // Auto-create invoice for kiosk mode
  useEffect(() => {
    if (initialAmount && initialAmount > 0 && activeMintUrl && !invoice && !isLoading) {
      const createInvoice = async () => {
        setIsLoading(true)
        setError('')
        try {
          // Ensure we have an online mint (with fallback), using selected mint
          const mintResult = await ensureOnlineMint({ showToast: true, preferredMintUrl: selectedMintUrl || activeMintUrl })
          if (!mintResult) {
            setError(t('payment.noAvailableMints'))
            setIsLoading(false)
            return
          }

          // Update selected mint if fallback occurred
          if (!mintResult.wasPreferred && mintResult.mintUrl !== selectedMintUrl) {
            setSelectedMintUrl(mintResult.mintUrl)
          }

          const result = await onCreateInvoice(initialAmount, mintResult.mintUrl)
          if (result) {
            setInvoice(result.invoice)
            setQuoteId(result.quoteId)
            setInvoiceMintUrl(mintResult.mintUrl)
            const now = Date.now()
            const maxExpiry = now + 180 * 1000
            setQuoteExpiry(result.expiry ? Math.min(result.expiry * 1000, maxExpiry) : maxExpiry)
          } else {
            setError(t('pos.invoiceCreateFailed'))
          }
        } catch {
          setError(t('pos.invoiceCreateError'))
        } finally {
          setIsLoading(false)
        }
      }
      createInvoice()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAmount, activeMintUrl, selectedMintUrl, ensureOnlineMint, t, onCreateInvoice])

  const handleNumClick = useCallback((num: string) => {
    if (amount === '0') {
      setAmount(num)
    } else if (amount.length < 9) {
      setAmount(amount + num)
    }
  }, [amount])

  const handleDelete = useCallback(() => {
    if (amount.length > 1) {
      setAmount(amount.slice(0, -1))
    } else {
      setAmount('0')
    }
  }, [amount])

  const handleClear = useCallback(() => {
    setAmount('0')
  }, [])

  const handleSelectLightning = useCallback(async () => {
    if (numericAmount <= 0) return
    setStep('lightning')
    setIsLoading(true)
    setError('')
    try {
      // Ensure we have an online mint (with fallback), using selected mint
      const mintResult = await ensureOnlineMint({ showToast: true, preferredMintUrl: selectedMintUrl })
      if (!mintResult) {
        setError(t('payment.noAvailableMints'))
        setIsLoading(false)
        return
      }

      // Update selected mint if fallback occurred
      if (!mintResult.wasPreferred && mintResult.mintUrl !== selectedMintUrl) {
        setSelectedMintUrl(mintResult.mintUrl)
      }

      const result = await onCreateInvoice(numericAmount, mintResult.mintUrl)
      if (result) {
        setInvoice(result.invoice)
        setQuoteId(result.quoteId)
        setInvoiceMintUrl(mintResult.mintUrl)
        const now = Date.now()
        const maxExpiry = now + 180 * 1000
        setQuoteExpiry(result.expiry ? Math.min(result.expiry * 1000, maxExpiry) : maxExpiry)
      } else {
        setError(t('pos.invoiceCreateFailed'))
      }
    } catch {
      setError(t('pos.invoiceCreateError'))
    } finally {
      setIsLoading(false)
    }
  }, [numericAmount, selectedMintUrl, onCreateInvoice, ensureOnlineMint, t])

  const handleSelectEcash = useCallback(() => {
    setStep('ecash')
  }, [])

  const handleReceiveToken = useCallback(async () => {
    if (!tokenInput.trim()) return
    setIsLoading(true)
    setError('')
    try {
      const token = tokenInput.trim()
      const p2pkPubkey = useAppStore.getState().p2pkPubkey

      // Check if the token's mint is online
      if (tokenPreview?.mintUrl) {
        const { mintHealthService } = await import('@/services/mint-health')
        const mintStatus = await mintHealthService.checkMint(tokenPreview.mintUrl)

        if (!mintStatus.isOnline) {
          // Mint is offline - check if token is P2PK locked to user
          const isLockedToUser = p2pkPubkey && isP2PKLockedToUser(token, p2pkPubkey)

          if (isLockedToUser) {
            // P2PK token locked to user - safe to store for later redemption
            const failedSwapRepo = new FailedSwapRepository()
            const failedSwap: FailedSwap = {
              id: `fs-pending-${crypto.randomUUID()}`,
              token,
              mintUrl: tokenPreview.mintUrl,
              amount: tokenPreview.amount,
              error: 'Mint offline - pending redemption',
              errorCode: 'MINT_OFFLINE',
              isRetryable: true,
              attemptCount: 0,
              lastAttemptAt: Date.now(),
              createdAt: Date.now(),
            }
            await failedSwapRepo.save(failedSwap)

            // Show success message - token is safely stored
            const actualAmount = tokenPreview.amount
            setReceivedAmount(actualAmount)
            setIsPaid(true)
            onPaymentReceived?.(actualAmount, 'ecash') // No transactionId for pending redemption
            return
          } else {
            // Not P2PK locked to user - warn that someone else could spend it
            setError(t('pos.mintOfflineWarning'))
            setIsLoading(false)
            return
          }
        }
      }

      // Mint is online - proceed with normal redemption
      const result = await onReceiveToken(token)
      if (result.success) {
        const actualAmount = result.amount || numericAmount
        setReceivedAmount(actualAmount)
        setIsPaid(true)
        onPaymentReceived?.(actualAmount, 'ecash', result.transactionId)
      } else {
        setError(t('pos.tokenReceiveFailed'))
      }
    } catch {
      setError(t('pos.tokenProcessError'))
    } finally {
      setIsLoading(false)
    }
  }, [tokenInput, tokenPreview, onReceiveToken, numericAmount, onPaymentReceived, t])

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
  }, [])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setTokenInput(text.trim())
    } catch {
      setError(t('payment.clipboardError'))
    }
  }, [t])

  const handleBackStep = useCallback(() => {
    if (step === 'amount' || initialAmount) {
      onBack()
    } else {
      setStep('amount')
      setInvoice('')
      setQuoteId('')
      setInvoiceMintUrl('')
      setQuoteExpiry(null)
      setTokenInput('')
      setError('')
      setIsExpired(false)
    }
  }, [step, onBack, initialAmount])

  const formatRemainingTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Stable ref for auto-dismiss (prevents timer reset on parent re-render)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  // Auto-dismiss success screen after 4 seconds
  useEffect(() => {
    if (!isPaid) return
    const timer = setTimeout(() => onBackRef.current(), 4000)
    return () => clearTimeout(timer)
  }, [isPaid])

  // Success screen
  if (isPaid) {
    const displayAmount = receivedAmount > 0 ? receivedAmount : numericAmount
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-4 pt-safe pb-safe overflow-hidden">
        <SuccessConfetti />
        <div className="animate-fadeIn relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center text-primary-foreground mb-4 shadow-xl">
            <div className="animate-fadeIn">
              <CheckCircle2 className="w-10 h-10" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">{t('pos.paymentComplete')}</h2>
          <div className="bg-secondary px-4 py-2 rounded-full border border-border mb-6 shadow-sm">
            <p className="text-foreground font-bold text-base">+₿{displayAmount.toLocaleString()}</p>
          </div>
          <button
            onClick={onBack}
            className="w-full max-w-xs bg-primary text-primary-foreground py-3 rounded-2xl font-bold text-base shadow-lg hover:bg-primary-hover active:scale-[0.98] transition-all"
          >
            {t('payment.confirm')}
          </button>
        </div>
      </div>
    )
  }

  // Amount step
  if (step === 'amount') {
    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden">
        {/* Background blobs */}
        <div className="absolute top-[-10%] right-[-10%] w-[50vh] h-[50vh] bg-accent-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50vh] h-[50vh] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <header className="flex items-center justify-between px-4 relative z-50">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="p-2 rounded-full bg-secondary shadow-sm hover:shadow-md transition-all hover:bg-background-hover"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-base font-bold tracking-tight">{t('common.receive')}</h2>
          <div className="w-9" />
        </header>

        {/* Mint Card Selector (Mini Carousel) */}
        {trustedMints.length > 0 && (
          <div className="w-full overflow-x-auto pb-3 pt-4 mt-2 scrollbar-hide mb-2 relative z-10">
            <div className="flex px-4 gap-2 min-w-max justify-center mx-auto">
              {mintInfos.map((mint, idx) => (
                <MintCard
                  key={mint.url}
                  mint={mint}
                  size="sm"
                  variant={getVariantByIndex(idx)}
                  isSelected={selectedMintUrl === mint.url || (!selectedMintUrl && idx === 0)}
                  onClick={() => setSelectedMintUrl(mint.url)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Amount Display */}
        <div className="flex-1 flex flex-col items-center justify-center py-3 relative z-10">
          <p className="text-5xl font-bold tracking-tighter drop-shadow-sm text-foreground text-center">
            ₿{Number(amount).toLocaleString()}
          </p>
        </div>

        {/* Keypad Area */}
        <div className="bg-background-card/90 backdrop-blur-xl rounded-t-[28px] p-4 pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.05)] border-t border-border relative z-20">
          <div className="grid grid-cols-3 gap-y-3 gap-x-4 mb-4 px-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0'].map((key) => (
              <button
                key={key}
                onPointerDown={(e) => { e.preventDefault(); if (key === 'C') handleClear(); else handleNumClick(key); }}
                className={cn(
                  'h-12 flex items-center justify-center text-xl font-semibold rounded-xl hover:bg-background-hover touch-manipulation',
                  key === 'C' ? 'text-accent-danger bg-accent-danger/10 hover:bg-accent-danger/20' : 'text-foreground active:scale-90'
                )}
              >
                {key}
              </button>
            ))}
            <button
              onPointerDown={(e) => { e.preventDefault(); handleDelete() }}
              aria-label={t('common.delete')}
              className="h-12 flex items-center justify-center text-foreground active:scale-90 rounded-xl hover:bg-background-hover touch-manipulation"
            >
              <Delete className="w-5 h-5 opacity-70" />
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSelectLightning}
              disabled={numericAmount <= 0 || !activeMintUrl}
              className={cn(
                'flex-1 h-14 rounded-[1.5rem] font-bold text-base flex items-center justify-center gap-2 shadow-xl transition-all',
                numericAmount <= 0 || !activeMintUrl
                  ? 'bg-accent-warning/50 text-white/50 cursor-not-allowed shadow-none'
                  : 'bg-accent-warning text-white shadow-[0_4px_16px_rgba(212,160,61,0.35)] active:scale-[0.96] hover:brightness-110'
              )}
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>{t('amountAction.lightning')}</span>
            </button>
            <button
              onClick={handleSelectEcash}
              disabled={numericAmount <= 0}
              className={cn(
                'flex-1 h-14 rounded-[1.5rem] font-bold text-base flex items-center justify-center gap-2 shadow-xl transition-all',
                numericAmount <= 0
                  ? 'bg-accent-primary/50 text-white/50 cursor-not-allowed shadow-none'
                  : 'bg-accent-primary text-white shadow-[0_4px_16px_rgba(91,122,84,0.35)] active:scale-[0.96] hover:brightness-110'
              )}
            >
              <Banknote className="w-4 h-4" />
              <span>{t('amountAction.ecash')}</span>
            </button>
          </div>
        </div>

      </div>
    )
  }

  // Lightning step
  if (step === 'lightning') {
    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe pb-safe overflow-hidden">
        <header className="flex items-center px-4 bg-background">
          <button onClick={handleBackStep} aria-label={t('common.back')} className="p-2 rounded-full bg-secondary shadow-sm hover:shadow-md transition-all hover:bg-background-hover">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-base font-bold tracking-tight ml-3">{t('payment.lightningReceive')}</h2>
        </header>

        <div className="flex-1 flex flex-col p-4 items-center">
          {/* Amount Badge */}
          <div className="bg-secondary px-4 py-2 rounded-xl mb-4 flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1">{t('payment.amount')}</span>
            <span className="text-xl font-bold text-foreground">₿{numericAmount.toLocaleString()}</span>
          </div>

          {error && (
            <div className="animate-fadeIn mb-3 px-3 py-2 bg-accent-danger/10 border border-accent-danger/20 rounded-xl">
              <span className="text-xs font-bold text-accent-danger">{error}</span>
            </div>
          )}

          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-foreground-muted mt-3">{t('pos.creatingInvoice')}</p>
            </div>
          ) : invoice ? (
            <div className="w-full flex flex-col items-center gap-4">
              <div className="w-60 h-60 bg-white rounded-[1.5rem] p-3 shadow-xl border border-border">
                <div className="w-full h-full bg-white rounded-xl flex items-center justify-center">
                  <QRCodeSVG value={invoice} size={200} level="M" />
                </div>
              </div>

              <div className="w-full bg-background-card p-3 rounded-xl flex items-center justify-between border border-border shadow-sm">
                <span className="font-mono text-[10px] text-foreground-muted truncate flex-1 mr-2">{invoice.slice(0, 30)}...</span>
                <button
                  onClick={() => handleCopy(invoice)}
                  aria-label={t('common.copy')}
                  className="p-2 hover:bg-primary/10 rounded-lg transition-colors"
                >
                  <Clipboard className="w-4 h-4 text-foreground" />
                </button>
              </div>

              <div className="text-center">
                <p className="text-foreground-muted text-xs">{t('payment.waitingPayment')}</p>
                {remainingSeconds !== null && remainingSeconds > 0 && (
                  <p className={cn('text-xs font-mono mt-1', remainingSeconds <= 60 ? 'text-accent-danger' : 'text-foreground-muted')}>
                    {t('pos.remainingTime')}: {formatRemainingTime(remainingSeconds)}
                  </p>
                )}
              </div>

              <div className="flex gap-3 w-full mt-3">
                <button
                  onClick={() => navigator.share?.({ text: invoice }) || handleCopy(invoice)}
                  className="flex-1 bg-accent-warning text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(212,160,61,0.35)] hover:brightness-110 transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                  {t('payment.share')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  // Ecash step
  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe pb-safe overflow-hidden">
      <header className="flex flex-col px-4 bg-background gap-2.5 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <button onClick={handleBackStep} aria-label={t('common.back')} className="p-2 rounded-full bg-secondary shadow-sm hover:shadow-md transition-all hover:bg-background-hover mr-3">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-base font-bold tracking-tight">{t('payment.ecashReceive')}</h2>
          </div>
          {numericAmount > 0 && (
            <div className="bg-secondary px-2 py-1 rounded-full border border-border">
              <span className="text-xs font-bold text-foreground">{numericAmount.toLocaleString()} sats</span>
            </div>
          )}
        </div>

        {/* Tab Selector - 3 tabs */}
        <div className="bg-primary/10 p-1 rounded-full flex relative">
          {/* Sliding Background */}
          <div
            className="absolute top-1 bottom-1 rounded-full bg-background-card shadow-sm transition-all duration-250 ease-out"
            style={{
              left: ecashMethod === 'scan' ? '4px'
                : ecashMethod === 'nfc' ? 'calc(33.33% + 2px)'
                : 'calc(66.66%)',
              width: 'calc(33.33% - 4px)',
            }}
          />

          <button
            onClick={() => setEcashMethod('scan')}
            className={cn(
              'flex-1 py-2 rounded-full flex items-center justify-center gap-2 text-xs font-bold transition-colors relative z-10',
              ecashMethod === 'scan' ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'
            )}
          >
            <QrCode className="w-4 h-4" />
            <span>{t('pos.scan')}</span>
          </button>
          <button
            onClick={() => setEcashMethod('nfc')}
            className={cn(
              'flex-1 py-2 rounded-full flex items-center justify-center gap-2 text-xs font-bold transition-colors relative z-10',
              ecashMethod === 'nfc' ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'
            )}
          >
            <SmartphoneNfc className="w-4 h-4" />
            <span>{t('pos.nfc')}</span>
          </button>
          <button
            onClick={() => setEcashMethod('ggwave')}
            className={cn(
              'flex-1 py-2 rounded-full flex items-center justify-center gap-2 text-xs font-bold transition-colors relative z-10',
              ecashMethod === 'ggwave' ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'
            )}
          >
            <AudioWaveform className="w-4 h-4" />
            <span>{t('pos.wave')}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col p-4 items-center overflow-y-auto pb-24">
        {error && (
          <div className="animate-fadeIn mb-3 px-3 py-2 bg-accent-danger/10 border border-accent-danger/20 rounded-xl w-full max-w-sm">
            <span className="text-xs font-bold text-accent-danger">{error}</span>
          </div>
        )}
          {ecashMethod === 'scan' && (
            <>
              {tokenPreview ? (
                <div className="animate-fadeIn w-full flex flex-col gap-4">

                  <div className="w-full bg-background-card rounded-2xl p-4 shadow-sm border border-border flex flex-col items-center gap-2">
                    <span className="text-3xl font-bold text-foreground">₿{tokenPreview.amount.toLocaleString()}</span>
                    <span className="text-xs text-foreground-muted/70">{formatMintUrl(tokenPreview.mintUrl)}</span>
                    {tokenPreview.memo && (
                      <span className="text-xs text-foreground-muted/70 italic">"{tokenPreview.memo}"</span>
                    )}
                  </div>

                  {!isTrustedMint && (
                    <div className="p-3 bg-accent-danger/10 border border-accent-danger/20 rounded-xl">
                      <p className="text-xs text-accent-danger font-bold text-center mb-2">{t('pos.untrustedMint')}</p>
                      <p className="text-[10px] text-foreground-muted text-center mb-2">{t('pos.addMintTrustQuestion')}</p>
                      <button
                        onClick={handleAddTrust}
                        disabled={isAddingTrust}
                        className="w-full bg-background-card border border-border text-foreground py-2 rounded-xl font-bold"
                      >
                        {isAddingTrust ? t('pos.addingTrust') : t('pos.trustMint')}
                      </button>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleReceiveToken}
                      disabled={!isTrustedMint || isLoading}
                      className={cn(
                        'flex-1 py-3 rounded-2xl font-bold shadow-lg transition-all',
                        !isTrustedMint || isLoading
                          ? 'bg-accent-primary/50 text-white/50 cursor-not-allowed'
                          : 'bg-accent-primary text-white shadow-[0_4px_16px_rgba(91,122,84,0.35)] hover:brightness-110'
                      )}
                    >
                      {isLoading ? t('payment.processing') : t('common.receive')}
                    </button>
                    <button
                      onClick={() => setTokenInput('')}
                      className="flex-1 bg-background-card border border-border text-foreground py-3 rounded-2xl font-bold hover:bg-background-hover"
                    >
                      {t('pos.reEnter')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="animate-fadeIn w-full flex flex-col items-center gap-4">

                  {/* QR Scanner */}
                  <QrScanner
                    active={true}
                    onScan={(result) => {
                      setTokenInput(result)
                    }}
                    onError={() => {}}
                  />

                  {/* Paste Button */}
                  <button
                    onClick={handlePaste}
                    className="w-full max-w-sm bg-accent-primary text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(91,122,84,0.35)] hover:brightness-110 transition-all"
                  >
                    <Clipboard className="w-4 h-4" />
                    {t('scanner.paste')}
                  </button>

                  <p className="text-xs text-foreground-muted text-center">
                    {t('pos.scanOrPasteToken')}
                  </p>
                </div>
              )}
            </>
          )}

          {ecashMethod === 'nfc' && (
            <div className="animate-fadeIn w-full flex flex-col items-center justify-center gap-6 flex-1 py-8">

              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <SmartphoneNfc className="w-8 h-8 text-foreground" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold text-foreground">{t('pos.nfc')}</h3>
                <p className="text-foreground-muted text-xs px-6">
                  {t('pos.nfcComingSoon')}
                </p>
                <span className="inline-block mt-2 text-[10px] px-2 py-1 bg-primary/10 rounded-full text-foreground-muted font-bold">
                  {t('pos.comingSoon')}
                </span>
              </div>
            </div>
          )}

          {ecashMethod === 'ggwave' && (
            <div className="animate-fadeIn w-full flex flex-col items-center justify-center gap-6 flex-1 py-8">

              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <AudioWaveform className="w-8 h-8 text-foreground" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold text-foreground">{t('pos.wave')}</h3>
                <p className="text-foreground-muted text-xs px-6">
                  {t('pos.waveComingSoon')}
                </p>
                <span className="inline-block mt-2 text-[10px] px-2 py-1 bg-primary/10 rounded-full text-foreground-muted font-bold">
                  {t('pos.comingSoon')}
                </span>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}

export default ReceiveScreen
