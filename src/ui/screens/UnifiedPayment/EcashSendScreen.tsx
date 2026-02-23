/**
 * Ecash Send Screen (Unified)
 * Single screen for sending Ecash tokens: amount + mint selection + QR display
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Banknote, Copy, Check, Loader2, RefreshCw, Share2, Undo2, Send, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { getDecodedToken } from '@cashu/cashu-ts'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { useMintHealth, useMintMetadata, useWallet } from '@/hooks'
import { useAppStore } from '@/store'
import { hapticTap, hapticSuccess, hapticError } from '@/utils/haptic'
import { checkProofsSpent, subscribeProofSpent } from '@/services/cashu'
import { sendTokenViaDM, getRecipientDMRelays } from '@/services/nostr-dm'
import type { MintInfo } from '@/core/types'
import type { ValidatedCashuRequest } from '@/ui/components/scanner'

export interface EcashSendScreenProps {
  onBack: () => void
  onComplete?: () => void
  onCreateEcashToken: (amount: number, mintUrl?: string, options?: { p2pkPubkey?: string; memo?: string }) => Promise<string | null>
  onReceiveToken?: (token: string) => Promise<boolean | { success: boolean; amount?: number }>
  // Pre-filled data from scanner (NUT-18 request)
  validatedData?: ValidatedCashuRequest
  initialAmount?: number
}

export function EcashSendScreen({
  onBack,
  onComplete,
  onCreateEcashToken,
  onReceiveToken,
  validatedData,
  initialAmount,
}: EcashSendScreenProps) {
  const { t } = useTranslation()
  // State
  const [amount, setAmount] = useState<string>(() => {
    if (validatedData?.parsed.amount) {
      return validatedData.parsed.amount.toString()
    }
    return initialAmount?.toString() || ''
  })
  // Mint will be auto-selected by useEffect based on:
  // 1. Request's allowed mints (if specified)
  // 2. User's mints with sufficient balance
  const [selectedMintUrl, setSelectedMintUrl] = useState<string>('')
  const [token, setToken] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>('')
  const [memo, setMemo] = useState<string>('')
  const [isReclaiming, setIsReclaiming] = useState(false)
  const [isTokenSpent, setIsTokenSpent] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isCreatingRef = useRef(false)

  // Nostr DM sending state
  const [isSendingDM, setIsSendingDM] = useState(false)
  const [dmSent, setDmSent] = useState(false)
  const [dmError, setDmError] = useState<string>('')

  // Hooks
  const { balance } = useWallet()
  const settings = useAppStore((s) => s.settings)
  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const { checkAllMints, getCachedStatus } = useMintHealth()

  // Check if this is a Nostr transport request
  const hasNostrTransport = validatedData?.parsed.hasNostrTransport ?? false
  const nostrTarget = validatedData?.parsed.nostrTarget

  // All registered mints (with or without balance)
  const allRegisteredMints = useMemo(() => {
    return (settings?.mints || []).map((url) => {
      // Normalize URL for balance lookup (remove trailing slash)
      const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
      return {
        url,
        balance: balance.byMint[normalizedUrl] || balance.byMint[url] || 0,
        isOnline: getCachedStatus(url)?.isOnline ?? true,
      }
    })
  }, [settings?.mints, balance.byMint, getCachedStatus])

  // Mints with balance
  const mintsWithBalance = useMemo(() => {
    return allRegisteredMints.filter((m) => m.balance > 0)
  }, [allRegisteredMints])

  // Request's allowed mints (empty = any mint allowed)
  const requestAllowedMints = useMemo(() => validatedData?.parsed.mints ?? [], [validatedData?.parsed.mints])

  // Get metadata for all mints (registered + requested)
  const allMintUrls = useMemo(() => {
    const urls = new Set(allRegisteredMints.map((m) => m.url))
    requestAllowedMints.forEach((url) => urls.add(url))
    return Array.from(urls)
  }, [allRegisteredMints, requestAllowedMints])

  const { getDisplayName, getIconUrl } = useMintMetadata(allMintUrls)

  // Get display names for requested mints
  const requestedMintNames = useMemo(() => {
    if (requestAllowedMints.length === 0) return []
    return requestAllowedMints.map((url) => getDisplayName(url))
  }, [requestAllowedMints, getDisplayName])

  // Normalize mint URL for comparison (case-insensitive, remove trailing slash)
  const normalizeMintUrl = useCallback((url: string) => {
    return url.toLowerCase().replace(/\/$/, '')
  }, [])

  // Check if request mints are registered but have no balance
  const requestMintStatus = useMemo(() => {
    if (requestAllowedMints.length === 0) {
      return { hasRegistered: false, hasBalance: mintsWithBalance.length > 0 }
    }

    // Check if any request mint is registered
    const hasRegistered = requestAllowedMints.some((allowedUrl) =>
      allRegisteredMints.some((m) =>
        normalizeMintUrl(m.url) === normalizeMintUrl(allowedUrl)
      )
    )

    // Check if any request mint has balance
    const hasBalance = requestAllowedMints.some((allowedUrl) =>
      mintsWithBalance.some((m) =>
        normalizeMintUrl(m.url) === normalizeMintUrl(allowedUrl)
      )
    )

    return { hasRegistered, hasBalance }
  }, [requestAllowedMints, allRegisteredMints, mintsWithBalance, normalizeMintUrl])

  // Check if a mint is compatible with the request
  const isMintCompatible = useCallback((mintUrl: string) => {
    if (requestAllowedMints.length === 0) return true // Any mint is OK if no restriction
    return requestAllowedMints.some((allowedUrl) =>
      normalizeMintUrl(mintUrl) === normalizeMintUrl(allowedUrl)
    )
  }, [requestAllowedMints, normalizeMintUrl])

  // Build mint info array - show ALL mints with balance
  const mints: MintInfo[] = useMemo(() => {
    return mintsWithBalance.map((m) => ({
      url: m.url,
      name: getDisplayName(m.url),
      iconUrl: getIconUrl(m.url),
      balance: m.balance,
      isOnline: m.isOnline,
    }))
  }, [mintsWithBalance, getDisplayName, getIconUrl])

  // Find compatible mints for auto-selection priority
  const compatibleMints = useMemo(() => {
    if (requestAllowedMints.length === 0) return mints
    return mints.filter((m) => isMintCompatible(m.url))
  }, [mints, requestAllowedMints, isMintCompatible])

  // Check if selected mint requires swap (only show when balance is sufficient)
  const selectedMintRequiresSwap = useMemo(() => {
    if (!selectedMintUrl || requestAllowedMints.length === 0) return false
    const mint = mints.find((m) => m.url === selectedMintUrl)
    const numAmount = parseInt(amount || '0', 10)
    // Only show swap warning if mint has sufficient balance
    if (!mint || mint.balance < numAmount) return false
    return !isMintCompatible(selectedMintUrl)
  }, [selectedMintUrl, requestAllowedMints, isMintCompatible, mints, amount])

  // Check mint health on mount only
  useEffect(() => {
    checkAllMints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select mint - runs when:
  // 1. No mint is selected
  // 2. Selected mint is not in the mints list
  // Priority: compatible mints > any mint with balance
  useEffect(() => {
    const currentMintValid = selectedMintUrl && mints.some((m) => m.url === selectedMintUrl)

    if (!currentMintValid) {
      const numericAmount = parseInt(amount || '0', 10)

      // Priority 1: Compatible mint with sufficient balance that is online
      let suitableMint = compatibleMints.find((m) => m.balance >= numericAmount && m.isOnline)
        || compatibleMints.find((m) => m.isOnline) // Any online compatible mint
        || compatibleMints[0] // First compatible mint

      // Priority 2: If no compatible mint available, use any mint with balance
      if (!suitableMint) {
        suitableMint = mints.find((m) => m.balance >= numericAmount && m.isOnline)
          || mints.find((m) => m.isOnline) // Fallback: any online mint
          || mints[0] // Last resort: first mint
      }

      if (suitableMint) {
        setSelectedMintUrl(suitableMint.url)
      }
    }
  }, [mints, compatibleMints, amount, selectedMintUrl])

  // Monitor token spent status via polling (reliable base) + WebSocket (faster detection)
  // Both run simultaneously — same pattern as cashu.me
  useEffect(() => {
    if (!token) {
      return
    }

    let wsUnsubscribe: (() => void) | null = null
    let pollCount = 0
    const MAX_POLLS = 10 // 10 polls * 3 seconds = 30 seconds max

    const decoded = getDecodedToken(token)

    // Guard: prevent double-firing when both WS and polling detect spent
    let spentHandled = false
    const guardedOnSpent = () => {
      if (spentHandled) return
      spentHandled = true
      setIsTokenSpent(true)
      hapticSuccess()
    }

    // 1. Start polling first (reliable base)
    const checkSpent = async () => {
      try {
        const proofs = decoded.proofs.map((p) => ({ secret: p.secret }))
        const spentSecrets = await checkProofsSpent(decoded.mint, proofs)

        if (spentSecrets.length > 0) {
          guardedOnSpent()
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
        }
      } catch (err) {
        console.warn('[EcashSendScreen] Failed to check proof state:', err)
      }

      pollCount++
      if (pollCount >= MAX_POLLS && pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }

    checkSpent()
    pollingRef.current = setInterval(checkSpent, 3000)

    // 2. Also try WebSocket for faster detection
    let cancelled = false
    const initWebSocket = async () => {
      try {
        const proofs = decoded.proofs as Array<{ C: string; amount: number; secret: string; id: string }>

        const canceller = await subscribeProofSpent(
          decoded.mint,
          proofs,
          () => {
            guardedOnSpent()
          },
          (error) => {
            console.warn('[EcashSendScreen] WebSocket error (polling still active):', error)
          }
        )

        if (cancelled) {
          canceller?.()
          return
        }

        if (canceller) {
          wsUnsubscribe = canceller
          console.log('[EcashSendScreen] WebSocket + polling active for proof monitoring')
        }
      } catch (err) {
        console.warn('[EcashSendScreen] WebSocket setup failed (polling still active):', err)
      }
    }

    initWebSocket()

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
  }, [token])

  // Calculate amounts
  const numericAmount = parseInt(amount || '0', 10)
  const selectedMint = mints.find((m) => m.url === selectedMintUrl)
  const isAmountFixed = validatedData?.parsed.amount !== undefined

  // Validation
  const validationError = useMemo(() => {
    if (numericAmount <= 0) return t('payment.enterAmount')
    if (!selectedMint) return t('payment.selectMint')
    if (selectedMint.balance < numericAmount) return `${t('payment.insufficientBalance')} (${selectedMint.balance.toLocaleString()} sats)`
    if (!selectedMint.isOnline) return t('payment.mintOffline')
    return null
  }, [numericAmount, selectedMint, t])

  // Send token via Nostr DM
  const sendTokenViaDMHandler = useCallback(async (tokenToSend: string) => {
    if (!hasNostrTransport || !nostrTarget || !nostrPrivkey) {
      return
    }

    setIsSendingDM(true)
    setDmError('')

    try {
      // Debug: Log the Nostr target
      console.log(`[EcashSendScreen] Sending token via NIP-17 DM`)
      console.log(`  - nostrTarget: ${nostrTarget?.substring(0, 40)}...`)
      console.log(`  - requestId: ${validatedData?.parsed.id}`)
      console.log(`  - token length: ${tokenToSend.length}`)

      // Get recipient's preferred DM relays (fallback to our relays)
      const relays = await getRecipientDMRelays(nostrTarget, settings?.relays || [])
      console.log(`  - relays: ${relays.join(', ')}`)

      const result = await sendTokenViaDM({
        recipientPubkey: nostrTarget,
        token: tokenToSend,
        memo: memo.trim() || validatedData?.parsed.description,
        requestId: validatedData?.parsed.id,
        senderPrivkey: nostrPrivkey,
        relays,
      })

      if (result.success) {
        setDmSent(true)
        hapticSuccess()
        console.log(`[EcashSendScreen] Token sent via DM to ${result.publishedRelays?.length || 0} relays`)
      } else {
        throw new Error(result.error || t('errors.generic'))
      }
    } catch (err) {
      hapticError()
      const message = err instanceof Error ? err.message : t('errors.generic')
      setDmError(message)
      console.error('[EcashSendScreen] DM send error:', err)
    } finally {
      setIsSendingDM(false)
    }
  }, [hasNostrTransport, nostrTarget, nostrPrivkey, settings?.relays, validatedData?.parsed.description, validatedData?.parsed.id, memo, t])

  // Create token
  const handleCreateToken = useCallback(async () => {
    if (isCreatingRef.current || validationError) {
      if (validationError) {
        setError(validationError)
        hapticError()
      }
      return
    }

    isCreatingRef.current = true
    setIsCreating(true)
    setError('')
    hapticTap()

    try {
      const p2pkPubkey = validatedData?.parsed.p2pkPubkey
      const trimmedMemo = memo.trim() || undefined
      const result = await onCreateEcashToken(
        numericAmount,
        selectedMintUrl,
        (p2pkPubkey || trimmedMemo) ? { p2pkPubkey, memo: trimmedMemo } : undefined
      )
      if (result) {
        setToken(result)
        hapticSuccess()

        // If this is a Nostr transport request, automatically send via DM
        if (hasNostrTransport && nostrTarget) {
          await sendTokenViaDMHandler(result)
        }
      } else {
        throw new Error(t('payment.tokenCreateFailed'))
      }
    } catch (err) {
      hapticError()
      const message = err instanceof Error ? err.message : t('payment.tokenCreateError')
      setError(message)
    } finally {
      isCreatingRef.current = false
      setIsCreating(false)
    }
  }, [validationError, numericAmount, selectedMintUrl, onCreateEcashToken, hasNostrTransport, nostrTarget, sendTokenViaDMHandler, validatedData?.parsed.p2pkPubkey, memo, t])

  // Copy token
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      hapticTap()
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore
    }
  }, [token])

  // Share token
  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          text: token,
        })
        hapticTap()
      } catch {
        // User cancelled or error
      }
    }
  }, [token])

  // Reclaim token (cancel send)
  const handleReclaim = useCallback(async () => {
    if (!onReceiveToken || !token) return
    setIsReclaiming(true)
    setError('')
    hapticTap()
    try {
      const success = await onReceiveToken(token)
      if (success) {
        hapticSuccess()
        onBack()
      } else {
        setError(t('payment.tokenReceiveFailed'))
        hapticError()
      }
    } catch {
      setError(t('payment.tokenReceiveError'))
      hapticError()
    } finally {
      setIsReclaiming(false)
    }
  }, [onReceiveToken, token, onBack, t])

  // Safe back: if token exists and not yet spent, auto-reclaim before navigating away
  const handleSafeBack = useCallback(async () => {
    // No token created yet or token already spent — safe to leave
    if (!token || isTokenSpent) {
      onBack()
      return
    }

    // Token exists but no reclaim handler — cannot recover, warn and stay
    if (!onReceiveToken) {
      setError(t('payment.tokenLostWarning'))
      return
    }

    // Auto-reclaim the token before leaving
    setIsReclaiming(true)
    setError('')
    try {
      const success = await onReceiveToken(token)
      if (success) {
        hapticSuccess()
        onBack()
      } else {
        // Reclaim failed — token may already be spent by recipient
        // Check if proofs are actually spent
        setError(t('payment.tokenReceiveFailed'))
        hapticError()
      }
    } catch {
      setError(t('payment.tokenReceiveError'))
      hapticError()
    } finally {
      setIsReclaiming(false)
    }
  }, [token, isTokenSpent, onReceiveToken, onBack, t])

  // Reset
  const handleReset = useCallback(() => {
    setToken('')
    setError('')
    setMemo('')
    setIsTokenSpent(false)
    setDmSent(false)
    setDmError('')
  }, [])

  return (
    <div className="h-dvh bg-background text-foreground font-sans flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-visible">
        <button
          onClick={handleSafeBack}
          disabled={isCreating || isReclaiming}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-border-visible transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Banknote className="w-5 h-5" />
          {t('payment.ecashSend')}
        </h1>
        <div className="w-9" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        {token ? (
          // Token Display (QR or Nostr DM state)
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              {/* DM Sending State */}
              {isSendingDM ? (
                <>
                  <div
                    className="w-[200px] h-[200px] bg-white rounded-2xl shadow-lg flex flex-col items-center justify-center gap-3 animate-scaleIn"
                  >
                    <Loader2 className="w-12 h-12 text-accent-primary animate-spin" />
                    <p className="text-sm text-foreground-muted">{t('payment.sendingNostrDm')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">₿{numericAmount.toLocaleString()}</p>
                    <p className="text-sm text-foreground-muted mt-1">{t('payment.sending')}</p>
                  </div>
                </>
              ) : dmSent && !dmError ? (
                // DM Sent Successfully
                <>
                  <div
                    className="w-[200px] h-[200px] bg-accent-primary rounded-2xl shadow-lg flex flex-col items-center justify-center gap-3 animate-scaleIn"
                  >
                    <div className="w-16 h-16 bg-accent-primary rounded-full flex items-center justify-center">
                      <Send className="w-8 h-8 text-white" />
                    </div>
                    <p className="text-white font-medium">{t('payment.sendComplete')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">₿{numericAmount.toLocaleString()}</p>
                    <p className="text-sm text-foreground-muted mt-1">{t('payment.sentViaNostrDm')}</p>
                  </div>
                </>
              ) : (
                // QR Code Display (default or DM failed fallback)
                <>
                  <div className="bg-white p-4 rounded-2xl shadow-lg">
                    <QRCodeSVG
                      value={token}
                      size={200}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#1a1a1a"
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">₿{numericAmount.toLocaleString()}</p>
                    {memo.trim() && (
                      <p className="text-sm text-foreground-muted mt-1 italic">
                        &ldquo;{memo.trim()}&rdquo;
                      </p>
                    )}
                    <p className="text-sm text-foreground-muted mt-1">
                      {dmError ? t('errors.generic') : t('payment.tokenCreated')}
                    </p>
                  </div>
                </>
              )}

              {/* Token Spent Notification */}
              {isTokenSpent && (
                  <div
                    className="px-4 py-3 bg-accent-primary rounded-2xl flex items-center gap-3 shadow-lg animate-scaleIn"
                  >
                    <div className="w-10 h-10 bg-accent-primary rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-bold text-sm">{t('payment.tokenSpent')}</p>
                      <p className="text-white/70 text-xs">
                        {t('payment.tokenSpentDesc')}
                      </p>
                    </div>
                  </div>
                )}

              {/* Error Message */}
              {(error || dmError) && (
                <div
                  className="px-3 py-2 bg-accent-danger/10 border border-accent-danger/20 rounded-xl animate-fadeIn"
                >
                  <span className="text-xs font-bold text-accent-danger">{error || dmError}</span>
                </div>
              )}

              {/* Warning */}
              {!isTokenSpent && !dmSent && !isSendingDM && (
                <p className="text-xs text-foreground-muted text-center px-3">
                  {t('payment.tokenLostWarning')}
                </p>
              )}

              {/* Action Buttons - Show only for QR mode (not DM) */}
              {!isTokenSpent && !dmSent && !isSendingDM && (
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={isReclaiming}
                    className="flex items-center gap-2 px-4 py-2 bg-background-card rounded-xl border border-border hover:bg-background-card transition-colors disabled:opacity-50"
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
                  {'share' in navigator && (
                    <button
                      onClick={handleShare}
                      disabled={isReclaiming}
                      className="flex items-center gap-2 px-4 py-2 bg-background-card rounded-xl border border-border hover:bg-background-card transition-colors disabled:opacity-50"
                    >
                      <Share2 className="w-4 h-4" />
                      <span className="text-sm">{t('payment.share')}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Action Buttons */}
            {isSendingDM ? (
              // Sending state - no actions
              <div className="h-14" />
            ) : isTokenSpent || dmSent ? (
              // Token spent or DM sent successfully - show complete button
              <button
                onClick={onComplete ?? onBack}
                className="w-full py-4 rounded-2xl bg-accent-primary text-white font-semibold text-lg shadow-lg flex items-center justify-center gap-2"
              >
                {t('payment.done')}
              </button>
            ) : (
              // QR mode - show reclaim and reset options
              <div className="flex gap-3">
                {onReceiveToken && (
                  <button
                    onClick={handleReclaim}
                    disabled={isReclaiming}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-background-card border border-border rounded-xl text-foreground font-medium hover:bg-background-card transition-colors disabled:opacity-50"
                  >
                    {isReclaiming ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">{t('payment.processing')}</span>
                      </>
                    ) : (
                      <>
                        <Undo2 className="w-4 h-4" />
                        <span className="text-sm">{t('payment.cancel')}</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={handleReset}
                  disabled={isReclaiming}
                  className="flex-1 flex items-center justify-center gap-2 py-3 text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="text-sm">{t('payment.createToken')}</span>
                </button>
              </div>
            )}
          </>
        ) : (
          // Input Form
          <>
            {/* NUT-18 request info */}
            {validatedData && (
              <div className="px-4 py-3 bg-background-card rounded-xl border border-border">
                <p className="text-xs text-foreground-muted uppercase tracking-wide">Payment Request</p>
                <p className="font-medium text-sm mt-1 truncate">ID: {validatedData.parsed.id}</p>
                {hasNostrTransport && nostrTarget && (
                  <div className="mt-2 flex items-center gap-2">
                    <Send className="w-3 h-3 text-accent-primary" />
                    <p className="text-xs text-accent-primary">{t('payment.willSendViaNostrDm')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('payment.amount')}</label>
              {isAmountFixed ? (
                <div className="mt-1 px-4 py-3 bg-background-card rounded-xl border border-border text-foreground font-medium">
                  ₿{numericAmount.toLocaleString()}
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
                    disabled={isCreating}
                  />
                </div>
              )}
            </div>

            {/* Memo (optional) */}
            <div>
              <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('common.memo')}</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={t('payment.memoPlaceholder')}
                maxLength={150}
                className="mt-1 w-full px-4 py-3 bg-background-card rounded-xl border border-border text-foreground focus:outline-none"
                disabled={isCreating}
              />
            </div>

            {/* Mint Selection */}
            <div>
              <label className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">{t('payment.selectMint')}</label>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {mints.length === 0 ? (
                  <div className="text-sm text-secondary">
                    {requestAllowedMints.length > 0
                      ? (requestMintStatus.hasRegistered
                          ? t('payment.mintNoBalance')
                          : t('payment.noCompatibleMints'))
                      : t('payment.noAvailableMints')}
                  </div>
                ) : (
                  mints.map((mint, idx) => (
                    <MintCard
                      key={mint.url}
                      mint={mint}
                      variant={getVariantByIndex(idx)}
                      size="sm"
                      isSelected={selectedMintUrl === mint.url}
                      onClick={() => !isCreating && setSelectedMintUrl(mint.url)}
                    />
                  ))
                )}
              </div>

              {/* Requested mint info */}
              {requestAllowedMints.length > 0 && (
                <div className="mt-2 px-3 py-2 bg-background-card rounded-xl">
                  <p className="text-xs text-foreground-muted">
                    <span className="font-medium">{t('payment.requestedMint')}: </span>
                    {requestedMintNames.join(', ')}
                  </p>
                </div>
              )}

              {/* Swap warning when non-compatible mint is selected */}
              {selectedMintRequiresSwap && (
                <div
                  className="mt-2 px-3 py-2 bg-accent-warning/10 border border-accent-warning/20 rounded-xl flex items-start gap-2 animate-fadeIn"
                >
                  <RefreshCw className="w-4 h-4 text-accent-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-accent-warning">
                    {t('payment.swapRequired', { mintName: requestedMintNames[0] || '' })}
                  </p>
                </div>
              )}
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
      {!token && (
        <div className="p-4 pb-safe border-t border-border-visible bg-background-card">
          <button
            onClick={handleCreateToken}
            disabled={isCreating || !!validationError}
            className="w-full py-4 rounded-2xl bg-accent-primary text-white font-semibold text-lg shadow-[0_4px_16px_rgba(91,122,84,0.35)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {validatedData ? t('payment.sending') : t('payment.creatingToken')}
              </>
            ) : (
              <>
                {validatedData ? <Send className="w-5 h-5" /> : <Banknote className="w-5 h-5" />}
                {validatedData
                  ? `₿${numericAmount.toLocaleString()} ${t('payment.send')}`
                  : t('payment.createToken')}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default EcashSendScreen
