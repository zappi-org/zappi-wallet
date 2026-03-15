/**
 * SendInputStep — Main input screen for send flow
 * Toss-style underline inputs, label+action buttons on same row
 * Auto-advance on scan/paste when enough data is available
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowLeft, ClipboardPaste, Camera } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWallet } from '@/hooks/use-wallet'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'
import { MintCardSelector } from '@/ui/components/wallet'
import { Button } from '@/ui/components/common/Button'
import { AmountInput } from '@/ui/components/common/AmountInput'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
import { decodeCashuRequest } from '@/ui/components/scanner/InputValidator'
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

  // Detect input type on destination change (debounced, typing only)
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    clearTimeout(detectTimeoutRef.current)
    detectTimeoutRef.current = setTimeout(() => {
      if (!destination.trim()) {
        setDetectedType(null)
        setValidatedData(null)
        return
      }

      const detected = detectInputType(destination)
      setDetectedType(toDisplayType(detected.type))

      // Auto-fill amount for bolt11
      if (detected.type === 'bolt11' && detected.amountSats > 0) {
        setAmount(String(detected.amountSats))
      }
    }, 300)

    return () => clearTimeout(detectTimeoutRef.current)
  }, [destination])

  // Selected mint balance (for validation)
  const mintBalance = selectedMintUrl ? (balance.byMint[selectedMintUrl] || 0) : 0
  const isOverBalance = !!(amount && parseInt(amount, 10) > mintBalance)

  // Process external input (scan/paste) with auto-advance
  const processExternalInput = useCallback((input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return

    setDestination(trimmed)
    hapticTap()

    const detected = detectInputType(trimmed)
    setDetectedType(toDisplayType(detected.type))

    // bolt11 with amount → auto-advance
    if (detected.type === 'bolt11' && detected.amountSats > 0) {
      setAmount(String(detected.amountSats))
      if (selectedMintUrl) {
        setTimeout(() => {
          onNext({
            destination: trimmed,
            amount: detected.amountSats,
            selectedMintUrl: selectedMintUrl!,
          })
        }, 300)
        return
      }
    }

    // Auto-fill amount for bolt11 without enough to auto-advance
    if (detected.type === 'bolt11' && detected.amountSats > 0) {
      setAmount(String(detected.amountSats))
    }

    // cashu-request with amount → auto-fill and auto-advance
    if (detected.type === 'cashu-request') {
      try {
        const parsed = decodeCashuRequest(detected.request)
        if (parsed.amount && parsed.amount > 0) {
          setAmount(String(parsed.amount))
          if (selectedMintUrl) {
            setTimeout(() => {
              onNext({
                destination: trimmed,
                amount: parsed.amount!,
                selectedMintUrl: selectedMintUrl!,
              })
            }, 300)
            return
          }
        }
      } catch {
        // decode failed, fall through to manual input
      }
    }

    // Focus amount input for types that need it
    if (detected.type !== 'unknown') {
      setTimeout(() => amountInputRef.current?.focus(), 150)
    }
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
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header — no border */}
      <header className="relative flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-lg font-semibold pointer-events-none">{t('send.title')}</h1>
        <button
          onClick={() => {
            hapticTap()
            onGoToTokenCreate()
          }}
          className="text-sm text-accent-primary font-medium min-h-[44px] px-2 flex items-center justify-center rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors z-10"
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
      <div className="flex-1 overflow-y-auto px-6 space-y-10">
        {/* Destination */}
        <div>
          <p className="text-[20px] font-normal text-foreground-muted leading-snug">{t('send.whereTo')}</p>
          <div className="flex items-end gap-1 border-b border-b-gray-200 focus-within:border-b-foreground transition-colors">
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={t('send.placeholder')}
              className="flex-1 min-w-0 bg-transparent border-0 rounded-none px-0 py-2 text-[22px] font-bold text-foreground placeholder:text-foreground-muted/40 placeholder:text-[16px] placeholder:font-normal focus:outline-none"
            />
            <div className="flex items-center gap-0.5 shrink-0 pb-1">
              <button
                onClick={handlePaste}
                aria-label={t('scanner.paste')}
                className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <ClipboardPaste className="w-5.5 h-5.5 text-accent-primary" />
              </button>
              <button
                onClick={() => setShowScanner(true)}
                aria-label={t('scanner.title')}
                className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <Camera className="w-5.5 h-5.5 text-accent-primary" />
              </button>
            </div>
          </div>
          {/* Detected type badge */}
          {detectedType && (
            <span className="inline-block text-xs px-2.5 py-1 mt-1.5 rounded-full bg-accent-primary/10 text-accent-primary font-medium">
              {detectedType.replace('-', ' ')}
            </span>
          )}
        </div>

        {/* Amount */}
        <AmountInput
          amount={amount}
          onAmountChange={setAmount}
          label={t('send.howMuch')}
          inputRef={amountInputRef}
          disabled={isAmountFixed}
          error={isOverBalance ? t('payment.insufficientBalance') : null}
        />
      </div>

      {/* Bottom Action */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          disabled={isOverBalance}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.next')}
        </Button>
      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <div className="fixed inset-0 z-50 bg-[#faf9f6] pt-safe pb-safe">
          <div className="flex items-center px-4 py-3">
            <button
              onClick={() => setShowScanner(false)}
              aria-label={t('common.back')}
              className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold ml-2">{t('scanner.title')}</h2>
          </div>
          <div className="p-4">
            <QrScanner onScan={handleScan} active={showScanner} />
          </div>
        </div>
      )}
    </div>
  )
}
