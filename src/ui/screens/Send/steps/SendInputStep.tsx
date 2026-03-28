/**
 * SendInputStep — Destination-only step (rewritten)
 * Conversational "누구에게 보낼까요?" with single destination input.
 * Auto-advance when bolt11 with amount is scanned/pasted.
 * Supports @wallet detection for internal mint transfers.
 * Empty destination → token mode (skips to amount step).
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import cardLogo from '@/assets/card-logo.svg'
import { getInputTypeLabel } from '@/utils/inputTypeLabel'
import { useTranslation, Trans } from 'react-i18next'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'
import { Button } from '@/ui/components/common/Button'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
import { validateInput } from '@/ui/components/scanner/InputValidator'
import type { SendableValidatedData } from '../SendFlow'

interface SendDestinationStepProps {
  onBack: () => void
  onNext: (data: {
    destination: string
    validatedData?: SendableValidatedData
    amountFromInvoice?: number
  }) => void
  initialDestination?: string
  initialValidatedData?: SendableValidatedData | null
  mintUrl: string
  isLoading?: boolean
}

export function SendInputStep({
  onBack,
  onNext,
  initialDestination = '',
  initialValidatedData,
  mintUrl,
  isLoading = false,
}: SendDestinationStepProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  // State
  const [destination, setDestination] = useState(initialDestination)
  const [showScanner, setShowScanner] = useState(false)
  const [detectedTypes, setDetectedTypes] = useState<string[]>(
    initialValidatedData?.type ? [initialValidatedData.type] : []
  )
  const [validatedData, setValidatedData] = useState<SendableValidatedData | null>(
    initialValidatedData || null
  )
  const inputRef = useRef<HTMLInputElement>(null)

  /** Build badge labels from detected input */
  const toBadgeTypes = (detected: ReturnType<typeof detectInputType>): string[] => {
    if (detected.type === 'unknown' || detected.type === 'amount') return []
    const badges: string[] = [detected.type]
    if (detected.type === 'cashu-request' && detected.lightningInvoice) {
      badges.push('lightning')
    }
    return badges
  }

  /**
   * Wrapper around setDestination — clears detection state immediately
   * when destination becomes empty or changes to @ prefix.
   */
  const updateDestination = useCallback((newDest: string) => {
    setDestination(newDest)
    // Always clear previous validation when input changes
    setValidatedData(null)
    setDetectedTypes([])
    const trimmed = newDest.trim()
    if (trimmed.startsWith('@')) {
      // @ prefix handled separately for wallet list
    }
  }, [])

  // Derive showMyWallets from destination + validatedData
  const showMyWallets = useMemo(() => {
    const trimmed = destination.trim()
    if (!trimmed || !trimmed.startsWith('@')) return false
    if (validatedData?.type === 'my-wallet' && destination === `@${validatedData.targetMintName}`) return false
    return true
  }, [destination, validatedData])

  // My wallets list (exclude currently selected source mint)
  const myWallets = useMemo(() => {
    return settings.mints
      .filter((url) => url !== mintUrl)
      .map((url) => ({
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
      }))
  }, [settings.mints, mintUrl, getDisplayName, getIconUrl])

  // Filter my wallets by @ search query
  const filteredWallets = useMemo(() => {
    if (!destination.startsWith('@')) return myWallets
    const query = destination.slice(1).toLowerCase()
    if (!query) return myWallets
    return myWallets.filter((w) => w.name.toLowerCase().includes(query))
  }, [myWallets, destination])

  // Handle my wallet selection
  const handleSelectMyWallet = useCallback((walletUrl: string, walletName: string) => {
    hapticTap()
    setDestination(`@${walletName}`)
    setValidatedData({
      type: 'my-wallet',
      targetMintUrl: walletUrl,
      targetMintName: walletName,
    })
    setDetectedTypes(['my-wallet'])
  }, [])

  // Debounced input type detection (only for non-empty, non-@ destinations)
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    clearTimeout(detectTimeoutRef.current)

    if (!destination.trim() || destination.startsWith('@')) return

    detectTimeoutRef.current = setTimeout(async () => {
      const detected = detectInputType(destination)
      setDetectedTypes(toBadgeTypes(detected))

      if (detected.type === 'cashu-request') {
        try {
          const result = await validateInput(detected)
          if (result.valid && result.data.type === 'cashu-request') {
            setValidatedData(result.data as SendableValidatedData)
          }
        } catch { /* decode failed, ignore */ }
      }
    }, 300)

    return () => clearTimeout(detectTimeoutRef.current)
  }, [destination])

  // Process external input (scan/paste): detect → validate → auto-advance if has amount
  const processExternalInput = useCallback(async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return

    setDestination(trimmed)
    hapticTap()

    const detected = detectInputType(trimmed)
    setDetectedTypes(toBadgeTypes(detected))

    if (detected.type === 'unknown') return

    // Full validation
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

    // Auto-advance when amount is embedded in the input
    if (detectedAmount > 0) {
      setTimeout(() => {
        onNext({
          destination: trimmed,
          validatedData: sendable,
          amountFromInvoice: detectedAmount,
        })
      }, 300)
      return
    }

    // Otherwise just proceed to next with validated data, no amount
    // User will click Next manually
  }, [onNext])

  // Handle QR scan
  const handleScan = useCallback((result: string) => {
    setShowScanner(false)
    processExternalInput(result)
  }, [processExternalInput])

  // Handle next — empty destination means token mode, otherwise validate fully
  const handleNext = useCallback(() => {
    const trimmed = destination.trim()
    hapticTap()

    if (!trimmed) {
      // Token mode: no destination
      onNext({ destination: '' })
      return
    }

    // If already validated, extract amount if available and proceed
    if (validatedData) {
      let amountFromInvoice = 0
      if (validatedData.type === 'bolt11' && validatedData.amountSats > 0) {
        amountFromInvoice = validatedData.amountSats
      } else if (validatedData.type === 'cashu-request' && validatedData.parsed?.amount && validatedData.parsed.amount > 0) {
        amountFromInvoice = validatedData.parsed.amount
      }
      onNext({
        destination: trimmed,
        validatedData,
        amountFromInvoice: amountFromInvoice > 0 ? amountFromInvoice : undefined,
      })
      return
    }

    // Not yet validated — run full validation
    processExternalInput(trimmed)
  }, [destination, validatedData, onNext, processExternalInput])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">
          {t('send.title')}
        </h1>
        <div className="w-10" />
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* Question */}
        <h2 className="text-heading font-semibold text-foreground">
          {t('send.destination.whoToSend')}
        </h2>

        {/* Destination input — placeholder smaller than title */}
        <div className="mt-6">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={destination}
              onChange={(e) => updateDestination(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
              onPaste={(e) => {
                e.preventDefault()
                const text = e.clipboardData.getData('text')
                if (text) processExternalInput(text)
              }}
              placeholder={t('send.destination.placeholder')}
              className="flex-1 min-w-0 bg-transparent py-1.5 text-title font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
            />
            <button
              onClick={() => setShowScanner(true)}
              aria-label={t('scanner.title')}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors shrink-0"
            >
              <CameraFilled className="text-foreground-muted" />
            </button>
          </div>

          {/* Detected type badge — fixed space below underline */}
          <div className="h-7 flex items-center mt-1">
            {detectedTypes.length > 0 && !detectedTypes.includes('my-wallet') && (
              <div className="flex gap-1.5">
                {detectedTypes.map((badge) => (
                  <span key={badge} className="inline-block text-label font-medium px-2.5 py-0.5 rounded-full bg-brand/10 text-brand">
                    {getInputTypeLabel(badge)}
                  </span>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* My wallets — visible when not in @ search mode */}
        {myWallets.length > 0 && !showMyWallets && (
          <div className="mt-3">
            <p className="text-body font-semibold text-foreground mb-3">{t('send.myWalletList')}</p>
            {myWallets.map((wallet) => (
              <button
                key={wallet.url}
                onClick={() => handleSelectMyWallet(wallet.url, wallet.name)}
                className="w-full flex items-center gap-3 py-3 border-b border-border/40 active:bg-foreground/[0.03] transition-colors"
              >
                <img
                  src={wallet.iconUrl || cardLogo}
                  alt=""
                  className="w-9 h-9 rounded-full object-contain shrink-0 bg-foreground/[0.04]"
                />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-subtitle font-medium text-foreground truncate">{wallet.name}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* My wallets dropdown — @ search mode */}
        {showMyWallets && (
          <div className="mt-4">
            <p className="text-body font-semibold text-foreground mb-3">{t('send.myWalletList')}</p>
            {filteredWallets.length > 0 ? (
              filteredWallets.map((wallet) => (
                <button
                  key={wallet.url}
                  onClick={() => handleSelectMyWallet(wallet.url, wallet.name)}
                  className="w-full flex items-center gap-3 py-3 border-b border-border/40 active:bg-foreground/[0.03] transition-colors"
                >
                  <img
                    src={wallet.iconUrl || cardLogo}
                    alt=""
                    className="w-9 h-9 rounded-full object-contain shrink-0 bg-foreground/[0.04]"
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-subtitle font-medium text-foreground truncate">{wallet.name}</p>
                  </div>
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

      {/* Bottom — hint + button */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        {!destination.trim() && (
          <div className="flex items-start gap-2.5 bg-foreground/[0.04] rounded-xl px-4 py-3 mb-3">
            <span className="text-caption leading-relaxed mt-px">💡</span>
            <p className="text-caption text-foreground-muted leading-relaxed whitespace-pre-line">
              <Trans
                i18nKey="send.destination.hint"
                components={{ b: <span className="font-semibold text-foreground" /> }}
              />
            </p>
          </div>
        )}
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          className="w-full"
        >
          {destination.trim() ? t('send.next') : t('common.skip')}
        </Button>
      </div>

      {/* QR Scanner Modal — center modal */}
      {showScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={() => setShowScanner(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" />
          {/* Modal */}
          <div
            className="relative bg-background rounded-2xl w-full max-w-sm overflow-hidden animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-subtitle font-semibold">{t('scanner.title')}</h2>
              <button
                onClick={() => setShowScanner(false)}
                className="text-body font-medium text-brand active:opacity-70"
              >
                {t('common.close')}
              </button>
            </div>
            {/* Camera */}
            <div className="px-4 pb-5">
              <QrScanner onScan={handleScan} active={showScanner} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
