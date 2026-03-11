/**
 * SendInputStep — Main input screen for send flow
 * Toss-style underline inputs, label+action buttons on same row
 * Auto-advance on scan/paste when enough data is available
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowLeft, Clipboard, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWallet } from '@/hooks/use-wallet'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'
import { formatSats } from '@/utils/format'
import { MintSelectBottomSheet } from '@/ui/components/payment'
import { Button } from '@/ui/components/common/Button'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
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
  const { getDisplayName } = useMintMetadata(settings.mints)
  const addToast = useAppStore((s) => s.addToast)

  // State
  const [destination, setDestination] = useState(initialDestination)
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(
    initialMintUrl || settings.mints[0] || null
  )
  const [showMintSelect, setShowMintSelect] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [detectedType, setDetectedType] = useState<string | null>(
    initialValidatedData?.type || null
  )
  const [validatedData, setValidatedData] = useState<SendableValidatedData | null>(
    initialValidatedData || null
  )

  const amountInputRef = useRef<HTMLInputElement>(null)

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
      setDetectedType(detected.type === 'unknown' ? null : detected.type)

      // Auto-fill amount for bolt11
      if (detected.type === 'bolt11' && detected.amountSats > 0) {
        setAmount(String(detected.amountSats))
      }
    }, 300)

    return () => clearTimeout(detectTimeoutRef.current)
  }, [destination])

  // Selected mint info
  const mintBalance = selectedMintUrl ? (balance.byMint[selectedMintUrl] || 0) : 0
  const mintName = selectedMintUrl ? getDisplayName(selectedMintUrl) : ''

  // Process external input (scan/paste) with auto-advance
  const processExternalInput = useCallback((input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return

    setDestination(trimmed)
    hapticTap()

    const detected = detectInputType(trimmed)
    setDetectedType(detected.type === 'unknown' ? null : detected.type)

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
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{t('send.title')}</h1>
        <button
          onClick={() => {
            hapticTap()
            onGoToTokenCreate()
          }}
          className="text-sm text-accent-primary font-medium min-h-[44px] px-2 flex items-center justify-center rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors"
        >
          {t('send.createToken')}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-10 space-y-12">
        {/* Mint — narrative text + change button on right */}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[22px] leading-snug">
              <span className="font-normal">{t('send.fromMintPrefix')}</span>
              <span className="font-bold">{mintName || t('payment.selectMint')}</span>
              <span className="font-normal text-foreground-muted">{t('send.fromMintSuffix')}</span>
            </p>
            <button
              onClick={() => setShowMintSelect(true)}
              className="text-sm text-accent-primary font-medium px-3 py-1.5 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] flex items-center shrink-0"
            >
              {t('common.change')}
            </button>
          </div>
          <p className="text-[15px] text-foreground-muted mt-1">{t('common.balance')} {formatSats(mintBalance)}</p>
        </div>

        {/* Destination — question as input placeholder */}
        <div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={t('send.whereTo')}
              className="flex-1 min-w-0 bg-transparent border-0 border-b border-b-gray-200 rounded-none px-0 py-2 text-[22px] font-bold text-foreground placeholder:font-normal placeholder:text-foreground-muted/40 focus:outline-none focus:border-b-foreground transition-colors"
            />
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handlePaste}
                aria-label={t('scanner.paste')}
                className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <Clipboard className="w-4.5 h-4.5 text-accent-primary" />
              </button>
              <button
                onClick={() => setShowScanner(true)}
                aria-label={t('scanner.title')}
                className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <ScanLine className="w-4.5 h-4.5 text-accent-primary" />
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

        {/* Amount — question as input placeholder, comma-formatted */}
        <div className="relative">
          {amount && <span className="absolute left-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-[22px]">₿</span>}
          <input
            ref={amountInputRef}
            type="text"
            inputMode="numeric"
            value={amount ? Number(amount).toLocaleString() : ''}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '')
              setAmount(v)
            }}
            disabled={isAmountFixed}
            placeholder={t('send.howMuch')}
            className={`w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none py-2 text-[22px] focus:outline-none focus:border-b-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${amount ? 'pl-8 font-bold text-foreground' : 'pl-0 font-normal text-foreground placeholder:text-foreground-muted/40'}`}
          />
        </div>
      </div>

      {/* Bottom Action */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          className="w-full !bg-[#3b7df5] !text-white !rounded-lg !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.next')}
        </Button>
      </div>

      {/* Mint Select Bottom Sheet */}
      <MintSelectBottomSheet
        isOpen={showMintSelect}
        onClose={() => setShowMintSelect(false)}
        onSelect={setSelectedMintUrl}
        selectedMintUrl={selectedMintUrl}
        filterFn={(mint) => mint.balance > 0}
      />

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
