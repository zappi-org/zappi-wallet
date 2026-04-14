/**
 * SendInputStep — Destination-only step (rewritten)
 * Conversational "누구에게 보낼까요?" with single destination input.
 * Auto-advance when bolt11 with amount is scanned/pasted.
 * Supports @wallet detection for internal mint transfers.
 * Empty destination → token mode (skips to amount step).
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Zap, Hash, Link } from 'lucide-react'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import cardLogo from '@/assets/card-logo.svg'
import { getInputTypeLabel } from '@/ui/utils/inputTypeLabel'
import { useTranslation, Trans } from 'react-i18next'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { Button } from '@/ui/components/common/Button'
import { Spinner } from '@/ui/components/common/Spinner'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { SegmentControl } from '@/ui/components/common/SegmentControl'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import type { InputType } from '@/core/domain/input-types'
import { useContacts } from '@/ui/hooks/use-contacts'
import type { ContactAddressType } from '@/core/types'
import type { SendableValidatedData } from '../SendFlow'

const LIGHTNING_ADDRESS_RE = /^[a-z0-9_.+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

function looksLikeLightningAddress(raw: string): boolean {
  return LIGHTNING_ADDRESS_RE.test(raw.trim())
}

function looksLikeLnurl(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith('lnurl1')
}

/** Build badge labels from detected input */
function toBadgeTypes(detected: InputType): string[] {
  if (detected.type === 'unknown' || detected.type === 'amount') return []
  const badges: string[] = [detected.type]
  if (detected.type === 'cashu-request' && detected.lightningInvoice) {
    badges.push('lightning')
  }
  return badges
}

interface SendDestinationStepProps {
  onBack: () => void
  onNext: (data: {
    destination: string
    validatedData?: SendableValidatedData
    amountFromInvoice?: number
  }) => void
  initialDestination?: string
  /** Raw address for auto-validation (when different from display destination) */
  initialAddress?: string
  initialValidatedData?: SendableValidatedData | null
  mintUrl: string
  isLoading?: boolean
}

export function SendInputStep({
  onBack,
  onNext,
  initialDestination = '',
  initialAddress,
  initialValidatedData,
  mintUrl,
  isLoading = false,
}: SendDestinationStepProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  const inputParser = useInputParser()

  // State
  const [destination, setDestination] = useState(initialDestination)
  const [showScanner, setShowScanner] = useState(false)
  const [detectedTypes, setDetectedTypes] = useState<string[]>(
    initialValidatedData?.type ? [initialValidatedData.type] : []
  )
  const [validatedData, setValidatedData] = useState<SendableValidatedData | null>(
    initialValidatedData || null
  )
  const [isPreValidating, setIsPreValidating] = useState(false)
  const [preValidationError, setPreValidationError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const validatedDataRef = useRef<SendableValidatedData | null>(null)
  // Store the raw address when displayName is used (contact selection)
  const rawAddressRef = useRef<string | null>(null)

  // Address book contacts (via ContactUseCase)
  const { contacts } = useContacts()

  // Segment: wallets vs contacts
  const [listTab, setListTab] = useState<'wallets' | 'contacts'>('wallets')

  /**
   * Wrapper around setDestination — clears detection state immediately
   * when destination becomes empty or changes to @ prefix.
   */
  const updateDestination = useCallback((newDest: string) => {
    setDestination(newDest)
    setValidatedData(null)
    setDetectedTypes([])
    setPreValidationError(null)
    setIsPreValidating(!!newDest.trim() && !newDest.startsWith('@'))
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
      const detected = inputParser.detectAndClassify(destination)
      setDetectedTypes(toBadgeTypes(detected))

      const sendableDetectedTypes = ['bolt11', 'lightning-address', 'lnurl', 'cashu-request']
      if (!sendableDetectedTypes.includes(detected.type)) {
        setIsPreValidating(false)
        setPreValidationError(t('send.destination.unrecognized'))
        return
      }

      if (detected.type === 'bolt11') {
        setIsPreValidating(false)
        return
      }

      if (detected.type === 'cashu-request') {
        try {
          const validated = await inputParser.validateAsync(detected)
          if (validated.type === 'cashu-request') {
            setValidatedData(validated as SendableValidatedData)
          }
        } catch { /* decode failed, ignore */ }
        setIsPreValidating(false)
        return
      }

      const needsPreValidation =
        (detected.type === 'lightning-address' && looksLikeLightningAddress(destination)) ||
        (detected.type === 'lnurl' && looksLikeLnurl(destination))

      if (!needsPreValidation) {
        setIsPreValidating(false)
        setPreValidationError(t('send.destination.validationFailed'))
        return
      }

      const myRequestId = ++requestIdRef.current
      setPreValidationError(null)

      try {
        const validated = await inputParser.validateAsync(detected)
        if (requestIdRef.current !== myRequestId) return

        if (validated.type === 'lnurl-withdraw') {
          setPreValidationError(t('send.destination.lnurlWithdrawNotSupported'))
          setValidatedData(null)
        } else {
          setValidatedData(validated as SendableValidatedData)
        }
      } catch {
        if (requestIdRef.current !== myRequestId) return
        setPreValidationError(t('send.destination.validationFailed'))
        setValidatedData(null)
      } finally {
        if (requestIdRef.current === myRequestId) {
          setIsPreValidating(false)
        }
      }
    }, 500)

    return () => clearTimeout(detectTimeoutRef.current)
  }, [destination, inputParser, t])

  // Cleanup auto-advance timer on unmount
  useEffect(() => () => clearTimeout(autoAdvanceTimerRef.current), [])

  // Unified input processing: detect → validate → set state → auto-advance if amount embedded
  // Used by paste, scan, contact click, and next button
  const processExternalInput = useCallback(async (input: string, displayName?: string) => {
    const trimmed = input.trim()
    if (!trimmed) return false

    // Clear previous state
    setValidatedData(null)
    validatedDataRef.current = null
    rawAddressRef.current = displayName ? trimmed : null
    setDestination(displayName || trimmed)

    const detected = inputParser.detectAndClassify(trimmed)
    // Don't show type badge when selecting from contacts (displayName means contact)
    setDetectedTypes(displayName ? [] : toBadgeTypes(detected))

    if (detected.type === 'unknown') return false

    // Full validation (async — network calls for lightning-address, lnurl, npub)
    let validated
    try {
      validated = await inputParser.validateAsync(detected)
    } catch {
      return false
    }
    if (!['bolt11', 'lightning-address', 'lnurl-pay', 'cashu-request', 'my-wallet'].includes(validated.type)) return false

    const sendable = validated as SendableValidatedData
    setValidatedData(sendable)
    validatedDataRef.current = sendable

    // Extract amount if available
    let detectedAmount = 0
    if (sendable.type === 'bolt11' && sendable.amountSats > 0) {
      detectedAmount = sendable.amountSats
    } else if (sendable.type === 'cashu-request' && sendable.parsed.amount && sendable.parsed.amount > 0) {
      detectedAmount = sendable.parsed.amount
    }

    // Auto-advance when amount is embedded in the input
    if (detectedAmount > 0) {
      autoAdvanceTimerRef.current = setTimeout(() => {
        onNext({
          destination: displayName || trimmed,
          validatedData: sendable,
          amountFromInvoice: detectedAmount,
        })
      }, 300)
      return 'auto-advanced'
    }

    return true
  }, [onNext, inputParser])

  // Handle QR scan
  const handleScan = useCallback((result: string) => {
    setShowScanner(false)
    processExternalInput(result)
  }, [processExternalInput])

  // Validating state for loading indicator on next button
  const [isValidating, setIsValidating] = useState(false)

  /** Extract embedded amount from validated data */
  const getAmountFromData = (data: SendableValidatedData): number => {
    if (data.type === 'bolt11' && data.amountSats > 0) return data.amountSats
    if (data.type === 'cashu-request' && data.parsed?.amount && data.parsed.amount > 0) return data.parsed.amount
    return 0
  }

  /** Proceed to next step with validated data */
  const advanceWithData = useCallback((displayDest: string, data: SendableValidatedData) => {
    const amt = getAmountFromData(data)
    onNext({
      destination: displayDest,
      validatedData: data,
      amountFromInvoice: amt > 0 ? amt : undefined,
    })
  }, [onNext])

  // Handle next — empty destination means token mode, otherwise validate fully
  const handleNext = useCallback(async () => {
    const trimmed = destination.trim()
    hapticTap()

    if (!trimmed) {
      onNext({ destination: '' })
      return
    }

    // Already validated → proceed immediately
    if (validatedData) {
      advanceWithData(trimmed, validatedData)
      return
    }

    // Not yet validated — validate now (show loading on button)
    setIsValidating(true)
    const addressToValidate = rawAddressRef.current || trimmed
    const displayName = rawAddressRef.current ? trimmed : undefined
    const ok = await processExternalInput(addressToValidate, displayName)
    setIsValidating(false)

    if (ok === true && validatedDataRef.current) {
      advanceWithData(displayName || addressToValidate, validatedDataRef.current)
    } else if (!ok) {
      addToast({ type: 'error', message: t('send.destination.unrecognized'), duration: 3000 })
    }
  }, [destination, validatedData, onNext, processExternalInput, advanceWithData, addToast, t])

  // Auto-validate when initialAddress is provided (from address book)
  // On success, auto-advance to amount step
  const autoValidatedRef = useRef(false)
  useEffect(() => {
    if (initialAddress && !initialValidatedData && !autoValidatedRef.current) {
      autoValidatedRef.current = true
      rawAddressRef.current = initialAddress
      const id = requestAnimationFrame(async () => {
        setIsValidating(true)
        const ok = await processExternalInput(initialAddress, initialDestination || undefined)
        setIsValidating(false)
        if (ok === true && validatedDataRef.current) {
          advanceWithData(initialDestination || initialAddress, validatedDataRef.current)
        }
      })
      return () => cancelAnimationFrame(id)
    }
  }, [initialAddress, initialDestination, initialValidatedData, processExternalInput, advanceWithData])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.title')} onBack={onBack} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* Question */}
        <h2 className="text-heading font-semibold text-foreground">
          {t('send.destination.whoToSend')}
        </h2>
        <div className={`mt-2 overflow-hidden transition-all duration-200 ease-out ${destination.trim() ? 'max-h-0 opacity-0' : 'max-h-20 opacity-100'}`}>
          <p className="text-body text-foreground/70 leading-relaxed break-keep">
            <Trans
              i18nKey="send.destination.hint"
              components={{ b: <span className="font-semibold text-foreground" /> }}
            />
          </p>
        </div>

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
            {isPreValidating ? (
              <Spinner size="sm" color="muted" />
            ) : (
              detectedTypes.length > 0 && !detectedTypes.includes('my-wallet') && (
                <div className="flex gap-1.5">
                  {detectedTypes.map((badge) => (
                    <span key={badge} className="inline-block text-label font-medium px-2.5 py-0.5 rounded-full bg-brand/10 text-brand">
                      {getInputTypeLabel(badge)}
                    </span>
                  ))}
                </div>
              )
            )}
          </div>
          <div className="h-5 flex items-center" data-testid="pre-validation-error-area">
            {preValidationError && (
              <p className="text-xs text-destructive">{preValidationError}</p>
            )}
          </div>

        </div>

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

        {/* Segment: My Wallets / Contacts */}
        {!showMyWallets && (myWallets.length > 0 || contacts.length > 0) && (
          <div className="mt-4">
            <SegmentControl
              value={listTab}
              onChange={setListTab}
              options={[
                { value: 'wallets' as const, label: t('send.myWalletList') },
                { value: 'contacts' as const, label: t('contacts.title') },
              ]}
            />

            <div className="mt-3 max-h-[240px] overflow-y-auto">
              {listTab === 'wallets' ? (
                myWallets.length > 0 ? (
                  myWallets.map((wallet) => (
                    <button
                      key={wallet.url}
                      onClick={() => handleSelectMyWallet(wallet.url, wallet.name)}
                      className="w-full flex items-center gap-3 py-3 border-b border-border/40 active:bg-foreground/[0.03] transition-colors"
                    >
                      <img
                        src={wallet.iconUrl || cardLogo}
                        alt=""
                        className="w-9 h-9 rounded-full object-contain shrink-0 bg-foreground/[0.04]"
                        onError={(e) => { (e.target as HTMLImageElement).src = cardLogo }}
                      />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-subtitle font-medium text-foreground truncate">{wallet.name}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="text-caption text-foreground-muted py-6 text-center">{t('send.noOtherWallets')}</p>
                )
              ) : (
                contacts.length > 0 ? (
                  contacts.map((contact) => {
                    const iconMap: Record<ContactAddressType, typeof Zap> = { lightning: Zap, npub: Hash, custom: Link }
                    const Icon = iconMap[contact.addressType]
                    const isNpub = contact.addressType === 'npub'
                    return (
                      <button
                        key={contact.id}
                        disabled={isNpub}
                        onClick={() => {
                          if (isNpub) return
                          hapticTap()
                          setDestination(contact.name)
                          rawAddressRef.current = contact.address
                          setValidatedData(null)
                          validatedDataRef.current = null
                          setDetectedTypes([])
                        }}
                        className={`w-full flex items-center gap-3 py-3 border-b border-border/40 transition-colors ${isNpub ? 'opacity-40' : 'active:bg-foreground/[0.03]'}`}
                      >
                        <div className="w-9 h-9 rounded-full bg-brand/8 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-brand" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-subtitle font-medium text-foreground truncate">{contact.name}</p>
                          <p className="text-caption text-foreground-muted truncate">{contact.address}</p>
                        </div>
                      </button>
                    )
                  })
                ) : (
                  <p className="text-caption text-foreground-muted py-6 text-center">{t('contacts.emptyTitle')}</p>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom — button */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={isLoading || isValidating || isPreValidating}
          disabled={!!preValidationError}
          className="w-full"
        >
          {t('send.next')}
        </Button>
      </div>

      <QrScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} onScan={handleScan} />
    </div>
  )
}
