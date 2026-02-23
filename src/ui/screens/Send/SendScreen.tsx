import { useState, useCallback, useEffect, useMemo, useRef } from 'react'

import { QRCodeSVG } from 'qrcode.react'
import { ArrowLeft, Zap, Banknote, Clipboard, Share2, CheckCircle2, Delete, QrCode, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QrScanner } from '../../components/common'
import { cn } from '@/components/ui/utils'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { useMintHealth, useMintMetadata } from '@/hooks'
import { checkProofsSpent, subscribeProofSpent } from '@/services/cashu'
import { getDecodedToken } from '@cashu/cashu-ts'
import { isValidLightningAddress, isBolt11Invoice } from '@/services/lightning'
import { resolveLightningAddress } from '@/services/lnurl'
import type { MintInfo } from '@/core/types'

type Step = 'amount' | 'lightning' | 'ecash-token'

export interface SendScreenProps {
  onBack: () => void
  balance: number
  mintBalances?: Record<string, number>
  onSendLightning: (address: string, amount: number) => Promise<boolean>
  onCreateEcashToken: (amount: number, mintUrl?: string, options?: { p2pkPubkey?: string }) => Promise<string | null>
  onReceiveToken?: (token: string) => Promise<boolean>
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

export function SendScreen({
  onBack,
  balance,
  mintBalances = {},
  onSendLightning,
  onCreateEcashToken,
  onReceiveToken,
}: SendScreenProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('amount')
  const [amount, setAmount] = useState('0')
  const [lightningAddress, setLightningAddress] = useState('')
  const [_isValidatingAddress, setIsValidatingAddress] = useState(false)
  const [ecashToken, setEcashToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const isLoadingRef = useRef(false)
  const [isSent, setIsSent] = useState(false)
  const [error, setError] = useState('')
  const [sentAmount, setSentAmount] = useState(0)
  const [selectedMintUrl, setSelectedMintUrl] = useState<string>('')
  const [isReclaiming, setIsReclaiming] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [isTokenSpent, setIsTokenSpent] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const numericAmount = parseInt(amount || '0', 10)
  const mintsWithBalance = Object.entries(mintBalances).filter(([, bal]) => bal > 0)
  const mintUrls = useMemo(() => mintsWithBalance.map(([url]) => url), [mintsWithBalance])

  const { ensureOnlineMint, checkAllMints, getCachedStatus } = useMintHealth()
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)

  // Check mint health on mount
  useEffect(() => {
    if (mintsWithBalance.length > 0) {
      checkAllMints()
    }
  }, [mintsWithBalance.length, checkAllMints])

  // Monitor token spent status via WebSocket (preferred) or polling (fallback)
  useEffect(() => {
    if (!ecashToken || step !== 'ecash-token') {
      return
    }

    let wsUnsubscribe: (() => void) | null = null
    let pollCount = 0
    const MAX_POLLS = 10 // 10 polls * 3 seconds = 30 seconds max

    const decoded = getDecodedToken(ecashToken)

    // Polling fallback function
    const startPolling = () => {
      const checkSpent = async () => {
        try {
          const proofs = decoded.proofs.map((p) => ({ secret: p.secret }))
          const spentSecrets = await checkProofsSpent(decoded.mint, proofs)

          if (spentSecrets.length > 0) {
            setIsTokenSpent(true)
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
          }
        } catch (err) {
          console.warn('[SendScreen] Failed to check proof state:', err)
        }

        pollCount++
        if (pollCount >= MAX_POLLS && pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }

      // Initial check
      checkSpent()
      // Poll every 3 seconds
      pollingRef.current = setInterval(checkSpent, 3000)
    }

    // Try WebSocket first (NUT-17), fall back to polling if not supported
    let cancelled = false
    const initMonitoring = async () => {
      try {
        // Cast proofs to the expected type for subscribeProofSpent
        const proofs = decoded.proofs as Array<{ C: string; amount: number; secret: string; id: string }>

        const canceller = await subscribeProofSpent(
          decoded.mint,
          proofs,
          () => { setIsTokenSpent(true) },
          () => {
            // WebSocket error — fall back to polling
            if (!cancelled) startPolling()
          }
        )

        // Check if cleanup ran while awaiting
        if (cancelled) {
          canceller?.()
          return
        }

        if (canceller) {
          wsUnsubscribe = canceller
          console.log('[SendScreen] Using WebSocket for proof state monitoring')
        } else {
          console.log('[SendScreen] WebSocket not supported, falling back to polling')
          startPolling()
        }
      } catch (err) {
        console.warn('[SendScreen] WebSocket setup failed, falling back to polling:', err)
        if (!cancelled) startPolling()
      }
    }

    initMonitoring()

    return () => {
      cancelled = true
      if (wsUnsubscribe) {
        wsUnsubscribe()
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [ecashToken, step])

  // Build mint info for cards with actual online status and metadata
  const mintInfos = useMemo((): MintInfo[] => {
    return mintsWithBalance.map(([url, bal]) => {
      const cachedStatus = getCachedStatus(url)
      return {
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
        balance: bal,
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      }
    })
  }, [mintsWithBalance, getCachedStatus, getDisplayName, getIconUrl])

  useEffect(() => {
    if (mintsWithBalance.length > 0 && !selectedMintUrl) {
      setSelectedMintUrl(mintsWithBalance[0][0])
    }
  }, [mintsWithBalance, selectedMintUrl])

  const selectedMintBalance = selectedMintUrl ? (mintBalances[selectedMintUrl] || 0) : 0
  const effectiveBalance = selectedMintUrl ? selectedMintBalance : balance
  const insufficientBalance = numericAmount > effectiveBalance

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

  const handleSelectLightning = useCallback(() => {
    if (numericAmount <= 0 || insufficientBalance) return
    setStep('lightning')
    setLightningAddress('')
    setError('')
  }, [numericAmount, insufficientBalance])

  const handleSelectEcash = useCallback(async () => {
    if (isLoadingRef.current || numericAmount <= 0 || insufficientBalance) return
    isLoadingRef.current = true
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

      const token = await onCreateEcashToken(numericAmount, mintResult.mintUrl)
      if (token) {
        setEcashToken(token)
        setSentAmount(numericAmount)
        setStep('ecash-token')
      } else {
        setError(t('payment.tokenCreateFailed'))
      }
    } catch {
      setError(t('payment.tokenCreateError'))
    } finally {
      isLoadingRef.current = false
      setIsLoading(false)
    }
  }, [numericAmount, insufficientBalance, selectedMintUrl, onCreateEcashToken, ensureOnlineMint, t])

  const handleSendLightning = useCallback(async () => {
    if (isLoadingRef.current || !lightningAddress.trim() || numericAmount <= 0 || insufficientBalance) return

    const input = lightningAddress.trim()

    // Validate input format first (before acquiring lock)
    const isLnAddress = isValidLightningAddress(input)
    const isBolt11 = isBolt11Invoice(input)

    if (!isLnAddress && !isBolt11) {
      setError(t('payment.invalidAddressOrInvoice'))
      return
    }

    isLoadingRef.current = true
    setIsLoading(true)
    setError('')

    try {
      // If it's a lightning address, validate by resolving LNURL
      if (isLnAddress) {
        setIsValidatingAddress(true)
        try {
          const params = await resolveLightningAddress(input)
          if (!params.callback) {
            setError(t('payment.invalidLightningAddress'))
            return
          }
        } catch {
          setError(t('payment.cannotVerifyAddress'))
          return
        } finally {
          setIsValidatingAddress(false)
        }
      }

      // Ensure we have an online mint (with fallback), using selected mint
      const mintResult = await ensureOnlineMint({ showToast: true, preferredMintUrl: selectedMintUrl })
      if (!mintResult) {
        setError(t('payment.noAvailableMints'))
        return
      }

      const success = await onSendLightning(input, numericAmount)
      if (success) {
        setSentAmount(numericAmount)
        setIsSent(true)
      } else {
        setError(t('payment.lightningSendFailed'))
      }
    } catch {
      setError(t('payment.sendError'))
    } finally {
      isLoadingRef.current = false
      setIsLoading(false)
    }
  }, [lightningAddress, numericAmount, insufficientBalance, onSendLightning, ensureOnlineMint, selectedMintUrl, t])

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
  }, [])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setLightningAddress(text.trim())
    } catch {
      setError(t('payment.clipboardError'))
    }
  }, [t])

  const handleShare = useCallback(async (text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch {
        handleCopy(text)
      }
    } else {
      handleCopy(text)
    }
  }, [handleCopy])

  const handleReclaim = useCallback(async () => {
    if (!onReceiveToken || !ecashToken) return
    setIsReclaiming(true)
    setError('')
    try {
      const success = await onReceiveToken(ecashToken)
      if (success) {
        onBack()
      } else {
        setError(t('payment.tokenReceiveFailed'))
      }
    } catch {
      setError(t('payment.tokenReceiveError'))
    } finally {
      setIsReclaiming(false)
    }
  }, [onReceiveToken, ecashToken, onBack, t])

  const handleBackStep = useCallback(async () => {
    if (step === 'amount') {
      onBack()
    } else if (step === 'ecash-token') {
      // Token exists and not yet spent — auto-reclaim before leaving
      if (ecashToken && !isTokenSpent && onReceiveToken) {
        setIsReclaiming(true)
        setError('')
        try {
          const success = await onReceiveToken(ecashToken)
          if (success) {
            onBack()
          } else {
            setError(t('payment.tokenReceiveFailed'))
          }
        } catch {
          setError(t('payment.tokenReceiveError'))
        } finally {
          setIsReclaiming(false)
        }
      } else {
        // No token, already spent, or no reclaim handler — safe to leave
        onBack()
      }
    } else {
      setStep('amount')
      setLightningAddress('')
      setEcashToken('')
      setError('')
    }
  }, [step, ecashToken, isTokenSpent, onReceiveToken, onBack, t])

  // Success screen for Lightning
  if (isSent) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-4 pt-safe pb-safe overflow-hidden">
        <SuccessConfetti />
        <div className="animate-fadeIn relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center text-primary-foreground mb-4 shadow-xl">
            <div className="animate-fadeIn">
              <CheckCircle2 className="w-10 h-10" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">{t('payment.sendComplete')}</h2>
          <div className="bg-secondary px-4 py-2 rounded-full border border-border mb-6 shadow-sm">
            <p className="text-foreground font-bold text-base">-₿{sentAmount.toLocaleString()}</p>
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
        <header className="flex items-center justify-between px-4 relative z-10">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="p-2 rounded-full bg-secondary shadow-sm hover:shadow-md transition-all hover:bg-background-hover"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-base font-bold tracking-tight">{t('common.send')}</h2>
          <div className="w-9" />
        </header>

        {/* Mint Card Selector (Mini Carousel) */}
        {mintsWithBalance.length > 0 && (
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

        {error && (
          <div className="mx-4 mb-2 relative z-10">
            <div className="animate-fadeIn px-3 py-2 bg-accent-danger/10 border border-accent-danger/20 rounded-xl text-center">
              <span className="text-xs font-bold text-accent-danger">{error}</span>
            </div>
          </div>
        )}

        {/* Amount Display */}
        <div className="flex-1 flex flex-col items-center justify-center py-3 relative z-10">
          <div className="flex flex-col items-center">
            <p className={cn(
              'text-5xl font-bold tracking-tighter drop-shadow-sm transition-colors text-center',
              insufficientBalance && numericAmount > 0 ? 'text-accent-danger' : 'text-foreground'
            )}>
              ₿{Number(amount).toLocaleString()}
            </p>

            {/* Insufficient Funds Warning */}
            {insufficientBalance && numericAmount > 0 && (
              <div className="animate-fadeIn mt-3 px-3 py-2 bg-accent-danger/10 border border-accent-danger/20 rounded-xl flex items-center gap-2">
                <span className="text-xs font-bold text-accent-danger">{t('payment.insufficientBalance')}</span>
                <span className="text-[10px] font-medium text-accent-danger/80">
                  ({t('payment.maxAmount', { amount: effectiveBalance.toLocaleString() })})
                </span>
              </div>
            )}
          </div>
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
              disabled={numericAmount <= 0 || insufficientBalance}
              className={cn(
                'flex-1 h-14 rounded-[2rem] font-bold text-base flex items-center justify-center gap-2 shadow-xl transition-all',
                numericAmount <= 0 || insufficientBalance
                  ? 'bg-accent-warning/50 text-white/50 cursor-not-allowed shadow-none'
                  : 'bg-accent-warning text-white shadow-[0_4px_16px_rgba(212,160,61,0.35)] active:scale-[0.96] hover:brightness-110'
              )}
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>{t('amountAction.lightning')}</span>
            </button>
            <button
              onClick={handleSelectEcash}
              disabled={numericAmount <= 0 || insufficientBalance || isLoading}
              className={cn(
                'flex-1 h-14 rounded-[2rem] font-bold text-base flex items-center justify-center gap-2 shadow-xl transition-all',
                numericAmount <= 0 || insufficientBalance || isLoading
                  ? 'bg-accent-primary/50 text-white/50 cursor-not-allowed shadow-none'
                  : 'bg-accent-primary text-white shadow-[0_4px_16px_rgba(91,122,84,0.35)] active:scale-[0.96] hover:brightness-110'
              )}
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Banknote className="w-4 h-4" />
              )}
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
          <h2 className="text-base font-bold tracking-tight ml-3">{t('payment.lightningSend')}</h2>
        </header>

        <div className="flex-1 flex flex-col p-4">
          {/* Amount Badge */}
          <div className="bg-secondary px-4 py-2 rounded-xl mb-4 flex flex-col items-center mx-auto">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1">{t('payment.amount')}</span>
            <span className="text-xl font-bold text-foreground">₿{numericAmount.toLocaleString()}</span>
          </div>

          {error && (
            <div className="animate-fadeIn mb-3 px-3 py-2 bg-accent-danger/10 border border-accent-danger/20 rounded-xl text-center">
              <span className="text-xs font-bold text-accent-danger">{error}</span>
            </div>
          )}

          {/* Input Area */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-foreground-muted">{t('payment.addressOrInvoice')}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowScanner(true)}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs font-bold bg-primary/10 text-foreground rounded-xl active:scale-95 transition-all"
                >
                  <QrCode className="w-3 h-3" />
                  {t('payment.scan')}
                </button>
                <button
                  onClick={handlePaste}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-xl active:scale-95 transition-all"
                >
                  <Clipboard className="w-3 h-3" />
                  {t('payment.paste')}
                </button>
              </div>
            </div>
            <textarea
              value={lightningAddress}
              onChange={(e) => setLightningAddress(e.target.value)}
              placeholder={t('payment.addressPlaceholder')}
              className="w-full h-32 bg-background-card p-4 rounded-2xl border border-border focus:border-primary/30 outline-none text-foreground placeholder:text-foreground-muted/50 resize-none font-medium"
            />
          </div>

          {/* Send Button */}
          <button
            onClick={handleSendLightning}
            disabled={!lightningAddress.trim() || isLoading}
            className={cn(
              'w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-xl transition-all mt-3',
              !lightningAddress.trim() || isLoading
                ? 'bg-accent-warning/50 text-white/50 cursor-not-allowed shadow-none'
                : 'bg-accent-warning text-white shadow-[0_4px_16px_rgba(212,160,61,0.35)] active:scale-[0.96] hover:brightness-110'
            )}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{t('payment.processing')}</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-current" />
                <span>{t('common.send')}</span>
              </>
            )}
          </button>
        </div>

        {/* QR Scanner Modal */}
        {showScanner && (
          <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
            <header className="flex items-center px-3 pt-2 pt-safe">
              <button
                onClick={() => setShowScanner(false)}
                aria-label={t('common.back')}
                className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-all"
              >
                <ArrowLeft className="w-4 h-4 text-white" />
              </button>
              <h2 className="text-base font-bold text-white ml-3">{t('payment.qrScan')}</h2>
            </header>
            <div className="flex-1 flex items-center justify-center p-4">
              <QrScanner
                active={true}
                onScan={(result) => {
                  setLightningAddress(result)
                  setShowScanner(false)
                }}
                onError={() => {}}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // Ecash token display step
  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe pb-safe overflow-hidden">
      <header className="flex items-center px-4 bg-background">
        <button onClick={handleBackStep} disabled={isReclaiming} aria-label={t('common.back')} className="p-2 rounded-full bg-secondary shadow-sm hover:shadow-md transition-all hover:bg-background-hover disabled:opacity-50">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-base font-bold tracking-tight ml-3">{t('payment.ecashToken')}</h2>
      </header>

      <div className="flex-1 flex flex-col p-4 items-center">
        {/* QR Code */}
        <div className="w-60 h-60 bg-white rounded-[2rem] p-3 shadow-xl border border-border mb-4">
          <div className="w-full h-full bg-white rounded-xl flex items-center justify-center">
            <QRCodeSVG value={ecashToken} size={200} level="M" />
          </div>
        </div>

        {/* Amount */}
        <div className="bg-secondary px-4 py-2 rounded-xl border border-border mb-3">
          <span className="text-lg font-bold text-foreground">₿{sentAmount.toLocaleString()}</span>
        </div>

        {/* Token Spent Notification */}
        {isTokenSpent && (
          <div className="animate-fadeIn mb-3 px-4 py-3 bg-accent-primary rounded-2xl flex items-center gap-3 shadow-lg">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">{t('payment.tokenSpent')}</p>
              <p className="text-white/70 text-xs">{t('payment.tokenSpentDesc')}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="animate-fadeIn mb-3 px-3 py-2 bg-accent-danger/10 border border-accent-danger/20 rounded-xl">
            <span className="text-xs font-bold text-accent-danger">{error}</span>
          </div>
        )}

        {/* Warning */}
        {!isTokenSpent && (
          <p className="text-xs text-foreground-muted text-center px-3 mb-4">
            {t('payment.tokenLostWarning')}
          </p>
        )}

        {/* Action buttons */}
        {!isTokenSpent && (
          <div className="flex gap-3 w-full max-w-sm">
            {onReceiveToken && (
              <button
                onClick={handleReclaim}
                disabled={isReclaiming}
                className="flex-1 bg-background-card border border-border text-foreground py-3 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-sm hover:bg-background-hover transition-all"
              >
                {isReclaiming ? t('payment.processing') : t('payment.cancel')}
              </button>
            )}
            <button
              onClick={() => handleShare(ecashToken)}
              disabled={isReclaiming}
              className="flex-1 bg-accent-primary text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(91,122,84,0.35)] hover:brightness-110 transition-all"
            >
              <Share2 className="w-4 h-4" />
              {t('payment.share')}
            </button>
          </div>
        )}

        <button
          onClick={onBack}
          disabled={isReclaiming}
          className="mt-3 w-full max-w-sm bg-secondary text-foreground py-3 rounded-2xl font-bold shadow-lg hover:bg-background-hover transition-all"
        >
          {t('payment.done')}
        </button>
      </div>
    </div>
  )
}

export default SendScreen
