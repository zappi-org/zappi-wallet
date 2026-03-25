/**
 * SendInputStep — Main input screen for send flow
 * Toss-style underline inputs, label+action buttons on same row
 * Auto-advance on scan/paste when enough data is available
 * Supports @ prefix for "send to my wallet" (internal mint swap)
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft, ClipboardPaste, Camera, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWallet } from '@/hooks/use-wallet'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats } from '@/utils/format'
import { getMintBalance } from '@/utils/url'
import { MintCardSelector } from '@/ui/components/wallet'
import { Button } from '@/ui/components/common/Button'
import { AmountInput } from '@/ui/components/common/AmountInput'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
import { validateInput } from '@/ui/components/scanner/InputValidator'
import type { SendableValidatedData } from '../SendFlow'

interface SendInputStepProps {
  onBack: () => void
  onNext: (data: {
    destination: string
    amount: number
    selectedMintUrl: string
    validatedData?: SendableValidatedData
  }) => void
  onGoToTokenCreate: () => void
  initialDestination?: string
  initialAmount?: number
  initialMintUrl?: string | null
  initialValidatedData?: SendableValidatedData | null
  isLoading?: boolean
}

export function SendInputStep({
  onBack,
  onNext,
  onGoToTokenCreate,
  initialDestination = '',
  initialAmount = 0,
  initialMintUrl,
  initialValidatedData,
  isLoading = false,
}: SendInputStepProps) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()
  const { getDisplayName } = useMintMetadata(settings.mints)

  // State
  const [destination, setDestination] = useState(initialDestination)
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(
    initialMintUrl || settings.mints[0] || null
  )
  const [showScanner, setShowScanner] = useState(false)
  const [detectedType, setDetectedType] = useState<string | null>(
    initialValidatedData?.type || null
  )
  const [validatedData, setValidatedData] = useState<SendableValidatedData | null>(
    initialValidatedData || null
  )
  const amountInputRef = useRef<HTMLInputElement>(null)

  /** Filter out types not meaningful as a send destination */
  const toDisplayType = (type: string) =>
    type === 'unknown' || type === 'amount' ? null : type

  // Is amount fixed (e.g. bolt11 with amount)?
  const isAmountFixed = validatedData?.type === 'bolt11' && validatedData.amountSats > 0

  /**
   * Wrapper around setDestination — clears detection state immediately
   * when destination becomes empty or changes to @ prefix.
   * Keeps setState calls in event handlers (not effects) to avoid lint violations.
   */
  const updateDestination = useCallback((newDest: string) => {
    setDestination(newDest)
    const trimmed = newDest.trim()
    if (!trimmed) {
      setDetectedType(null)
      setValidatedData(null)
    } else if (trimmed.startsWith('@')) {
      // Clear detection unless it's a no-op (wallet already selected with matching name)
      // Note: handleSelectMyWallet sets validatedData AFTER this, so clearing here is safe
      setDetectedType(null)
      setValidatedData(null)
    }
  }, [])

  // Derive showMyWallets from destination + validatedData (not state)
  const showMyWallets = useMemo(() => {
    const trimmed = destination.trim()
    if (!trimmed || !trimmed.startsWith('@')) return false
    // If wallet already selected and destination matches, don't show list
    if (validatedData?.type === 'my-wallet' && destination === `@${validatedData.targetMintName}`) return false
    return true
  }, [destination, validatedData])

  // My wallets list (exclude currently selected source mint)
  const myWallets = useMemo(() => {
    return settings.mints
      .filter((url) => url !== selectedMintUrl)
      .map((url) => ({
        url,
        name: getDisplayName(url),
        balance: getMintBalance(url, balance.byMint),
      }))
  }, [settings.mints, selectedMintUrl, getDisplayName, balance.byMint])

  // Filter my wallets by @ search query
  const filteredWallets = useMemo(() => {
    if (!destination.startsWith('@')) return myWallets
    const query = destination.slice(1).toLowerCase()
    if (!query) return myWallets
    return myWallets.filter((w) => w.name.toLowerCase().includes(query))
  }, [myWallets, destination])

  // Is source mint same as target wallet? (conflict)
  const isSameWallet = validatedData?.type === 'my-wallet' && validatedData.targetMintUrl === selectedMintUrl

  // Debounced input type detection (only for non-empty, non-@ destinations)
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    clearTimeout(detectTimeoutRef.current)

    if (!destination.trim() || destination.startsWith('@')) return

    detectTimeoutRef.current = setTimeout(() => {
      const detected = detectInputType(destination)
      setDetectedType(toDisplayType(detected.type))

      if (detected.type === 'bolt11' && detected.amountSats > 0) {
        setAmount(String(detected.amountSats))
      }
    }, 300)

    return () => clearTimeout(detectTimeoutRef.current)
  }, [destination])

  // Selected mint balance (for validation)
  const mintBalance = selectedMintUrl ? (balance.byMint[selectedMintUrl] || 0) : 0
  const isOverBalance = !!(amount && parseInt(amount, 10) > mintBalance)

  // Handle my wallet selection
  const handleSelectMyWallet = useCallback((walletUrl: string, walletName: string) => {
    hapticTap()
    setDestination(`@${walletName}`)
    setValidatedData({
      type: 'my-wallet',
      targetMintUrl: walletUrl,
      targetMintName: walletName,
    })
    setDetectedType('my-wallet')
    setTimeout(() => amountInputRef.current?.focus(), 150)
  }, [])

  // Handle "내 지갑으로 보내기" button tap
  const handleMyWalletButton = useCallback(() => {
    hapticTap()
    updateDestination('@')
  }, [updateDestination])

  // Process external input (scan/paste): detect → validate → auto-advance
  const processExternalInput = useCallback(async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return

    setDestination(trimmed)
    hapticTap()

    const detected = detectInputType(trimmed)
    setDetectedType(toDisplayType(detected.type))

    if (detected.type === 'unknown') {
      setTimeout(() => amountInputRef.current?.focus(), 150)
      return
    }

    // Full validation (async) — preserves lightningInvoice for unified QR
    const result = await validateInput(detected)
    if (!result.valid) return

    const validated = result.data
    if (!['bolt11', 'lightning-address', 'lnurl-pay', 'cashu-request', 'my-wallet'].includes(validated.type)) return

    const sendable = validated as SendableValidatedData
    setValidatedData(sendable)

    // Extract amount if available
    let detectedAmount = 0
    if (sendable.type === 'bolt11' && sendable.amountSats > 0) {
      detectedAmount = sendable.amountSats
    } else if (sendable.type === 'cashu-request' && sendable.parsed.amount && sendable.parsed.amount > 0) {
      detectedAmount = sendable.parsed.amount
    }

    if (detectedAmount > 0) {
      setAmount(String(detectedAmount))
    }

    // Auto-advance when amount + mint are ready
    if (detectedAmount > 0 && selectedMintUrl) {
      setTimeout(() => {
        onNext({
          destination: trimmed,
          amount: detectedAmount,
          selectedMintUrl: selectedMintUrl!,
          validatedData: sendable,
        })
      }, 300)
      return
    }

    // Focus amount input for manual entry
    setTimeout(() => amountInputRef.current?.focus(), 150)
  }, [selectedMintUrl, onNext])

  // Handle paste
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        processExternalInput(text)
      }
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError'), duration: 3000 })
    }
  }, [processExternalInput, addToast, t])

  // Handle QR scan
  const handleScan = useCallback((result: string) => {
    setShowScanner(false)
    processExternalInput(result)
  }, [processExternalInput])

  // Handle next
  const handleNext = useCallback(() => {
    if (!destination.trim()) {
      addToast({ type: 'error', message: t('send.destinationRequired'), duration: 3000 })
      return
    }

    const numericAmount = parseInt(amount, 10)
    if (!numericAmount || numericAmount <= 0) {
      addToast({ type: 'error', message: t('send.amountRequired'), duration: 3000 })
      return
    }

    if (!selectedMintUrl) {
      addToast({ type: 'error', message: t('payment.selectMint'), duration: 3000 })
      return
    }

    if (numericAmount > mintBalance) {
      addToast({ type: 'error', message: t('payment.insufficientBalance'), duration: 3000 })
      return
    }

    hapticTap()
    onNext({
      destination: destination.trim(),
      amount: numericAmount,
      selectedMintUrl,
      validatedData: validatedData || undefined,
    })
  }, [destination, amount, selectedMintUrl, mintBalance, validatedData, onNext, addToast, t])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — no border */}
      <header className="relative flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-lg hover:bg-background-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle pointer-events-none">{t('send.title')}</h1>
        <button
          onClick={() => {
            hapticTap()
            onGoToTokenCreate()
          }}
          className="text-label text-accent-primary font-medium min-h-[44px] px-2 flex items-center justify-center rounded-lg hover:bg-background-hover active:bg-background-hover transition-colors z-10"
        >
          {t('send.createToken')}
        </button>
      </header>

      {/* Mint Card Selector — outside scroll container for full-width overflow */}
      <div className="shrink-0 pt-6 pb-8">
        <MintCardSelector
          selectedMintUrl={selectedMintUrl}
          onSelect={setSelectedMintUrl}
          filterFn={(mint) => mint.balance > 0}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 space-y-6">
        {/* Destination */}
        <div>
          <p className="text-label font-normal text-foreground-muted leading-snug">{t('send.whereTo')}</p>
          <div className="flex items-end gap-1 border-b border-b-border focus-within:border-b-foreground transition-colors">
            <input
              type="text"
              value={destination}
              onChange={(e) => updateDestination(e.target.value)}
              placeholder={t('send.placeholder')}
              className="flex-1 min-w-0 bg-transparent border-0 rounded-none px-0 py-2 text-subtitle font-semibold text-foreground placeholder:text-foreground-muted/40 placeholder:font-normal focus:outline-none"
            />
            <div className="flex items-center gap-0.5 shrink-0 pb-1">
              <button
                onClick={handlePaste}
                aria-label={t('scanner.paste')}
                className="p-2 rounded-lg hover:bg-background-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <ClipboardPaste className="w-5.5 h-5.5 text-accent-primary" />
              </button>
              <button
                onClick={() => setShowScanner(true)}
                aria-label={t('scanner.title')}
                className="p-2 rounded-lg hover:bg-background-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <Camera className="w-5.5 h-5.5 text-accent-primary" />
              </button>
            </div>
          </div>

          {/* Detected type badge */}
          {detectedType && detectedType !== 'my-wallet' && (
            <span className="inline-block text-label px-2.5 py-1 mt-1.5 rounded-full bg-accent-primary/10 text-accent-primary font-medium">
              {detectedType.replace('-', ' ')}
            </span>
          )}

          {/* "내 지갑으로 보내기" button — shown when no destination entered and wallets exist */}
          {!destination && myWallets.length > 0 && (
            <button
              onClick={handleMyWalletButton}
              className="flex items-center gap-1 mt-3 text-label text-accent-primary font-medium active:opacity-70 transition-opacity"
            >
              <span>{t('send.myWallet')}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {/* My wallets dropdown */}
          {showMyWallets && (
            <div className="mt-2">
              <p className="text-label text-foreground-muted font-medium py-2">{t('send.myWalletList')}</p>
              {filteredWallets.length > 0 ? (
                filteredWallets.map((wallet) => (
                  <button
                    key={wallet.url}
                    onClick={() => handleSelectMyWallet(wallet.url, wallet.name)}
                    className="w-full flex items-center justify-between py-3 border-b border-border active:bg-background-hover transition-colors"
                  >
                    <span className="text-body font-medium text-foreground">{wallet.name}</span>
                    <span className="text-caption text-foreground-muted">{formatSats(wallet.balance)}</span>
                  </button>
                ))
              ) : (
                <p className="text-caption text-foreground-muted py-3">
                  {t('send.noOtherWallets')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Amount */}
        <AmountInput
          amount={amount}
          onAmountChange={setAmount}
          label={t('send.howMuch')}
          inputRef={amountInputRef}
          disabled={isAmountFixed}
          error={
            isSameWallet
              ? t('send.sameWalletError')
              : isOverBalance
                ? t('payment.insufficientBalance')
                : null
          }
        />
      </div>

      {/* Bottom Action */}
      <div className="p-4 pb-safe">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          disabled={isOverBalance || isSameWallet}
          className="w-full"
        >
          {t('send.next')}
        </Button>
      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <div className="fixed inset-0 z-50 bg-background pt-safe pb-safe">
          <div className="flex items-center px-4 py-3">
            <button
              onClick={() => setShowScanner(false)}
              aria-label={t('common.back')}
              className="p-2 -ml-2 rounded-lg hover:bg-background-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-subtitle ml-2">{t('scanner.title')}</h2>
          </div>
          <div className="p-4">
            <QrScanner onScan={handleScan} active={showScanner} />
          </div>
        </div>
      )}
    </div>
  )
}
