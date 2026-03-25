import { useState, useCallback, useRef, useEffect, useMemo } from 'react'

import { ArrowLeft, Copy, Check, RefreshCw, ClipboardPaste } from 'lucide-react'
import { NumericKeypad } from '@/ui/components/common/NumericKeypad'
import { Button } from '@/ui/components/common/Button'
import { useTranslation } from 'react-i18next'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import creatingWalletSvg from '@/assets/creating-wallet.svg'
import zappiImg from '@/assets/zappi.png'

export type OnboardingStep = 'welcome' | 'mnemonic' | 'pin' | 'pin-confirm' | 'recovering'

export interface OnboardingScreenProps {
  onComplete: (data: OnboardingData) => Promise<boolean>
  onGenerateMnemonic: () => string
  onValidateMnemonic: (mnemonic: string) => boolean
}

export interface OnboardingData {
  mnemonic: string
  password: string
  isRecovery: boolean
}

export function OnboardingScreen({
  onComplete,
  onGenerateMnemonic,
  onValidateMnemonic,
}: OnboardingScreenProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [mode, setMode] = useState<'create' | 'import'>('create')
  const [mnemonic, setMnemonic] = useState('')
  const [mnemonicWords, setMnemonicWords] = useState<string[]>(Array(12).fill(''))
  const [wordCount, setWordCount] = useState<12 | 24>(12)
  const [mnemonicError, setMnemonicError] = useState('')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [isLoading, _setIsLoading] = useState(false)
  const [loadingMessage, _setLoadingMessage] = useState('')
  const [error, setError] = useState('')
  const [mnemonicCopied, setMnemonicCopied] = useState(false)
  const [focusedWordIndex, setFocusedWordIndex] = useState<number | null>(null)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusedWordIndexRef = useRef<number | null>(null)

  // Manual word count change (tab click) — reset words
  const handleWordCountChange = useCallback((count: 12 | 24) => {
    setWordCount(count)
    setMnemonicWords(Array(count).fill(''))
    setMnemonicError('')
  }, [])

  // BIP-39 autocomplete suggestions
  const suggestions = useMemo(() => {
    if (focusedWordIndex === null || mode !== 'import') return []
    const current = mnemonicWords[focusedWordIndex]
    if (!current || current.length < 2) return []
    if (wordlist.includes(current)) return []
    return wordlist.filter(w => w.startsWith(current)).slice(0, 6)
  }, [focusedWordIndex, mnemonicWords, mode])

  // Welcome step - choose create or import
  const handleCreate = useCallback(() => {
    const newMnemonic = onGenerateMnemonic()
    setMnemonic(newMnemonic)
    setMode('create')
    setStep('mnemonic')
  }, [onGenerateMnemonic])

  const handleRegenerate = useCallback(() => {
    const newMnemonic = onGenerateMnemonic()
    setMnemonic(newMnemonic)
    setMnemonicCopied(false)
    setBackupConfirmed(false)
  }, [onGenerateMnemonic])

  const handleImport = useCallback(() => {
    setMode('import')
    setMnemonicWords(Array(12).fill(''))
    setWordCount(12)
    setStep('mnemonic')
  }, [])

  // Fill words from a space-separated string (paste or clipboard button)
  const fillFromText = useCallback((text: string) => {
    const words = text.trim().toLowerCase().split(/\s+/)
    if (words.length === 12 || words.length === 24) {
      setWordCount(words.length as 12 | 24)
      setMnemonicWords([...words])
      setMnemonicError('')
      setFocusedWordIndex(null)
    }
  }, [])

  // Clipboard paste button handler
  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      fillFromText(text)
    } catch {
      // Clipboard API not available or denied
    }
  }, [fillFromText])

  // Handle word input change
  const handleWordChange = (index: number, value: string) => {
    // Handle paste of full mnemonic
    if (value.includes(' ')) {
      fillFromText(value)
      return
    }

    const cleaned = value.toLowerCase().trim()
    const newWords = mnemonicWords.map((w, i) => i === index ? cleaned : w)
    setMnemonicError('')

    // Auto-complete if exactly one BIP-39 match (skip if already a complete word)
    if (cleaned.length >= 2 && !wordlist.includes(cleaned)) {
      const matches = wordlist.filter(w => w.startsWith(cleaned))
      if (matches.length === 1 && matches[0] !== mnemonicWords[index]) {
        const completed = newWords.map((w, i) => i === index ? matches[0] : w)
        setMnemonicWords(completed)
        // Move to next empty input
        const nextEmpty = completed.findIndex((w, i) => i > index && !w)
        if (nextEmpty !== -1) {
          setTimeout(() => inputRefs.current[nextEmpty]?.focus(), 0)
        }
        return
      }
    }
    setMnemonicWords(newWords)
  }

  const handleWordKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !mnemonicWords[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  // Select an autocomplete suggestion
  const handleSelectSuggestion = (word: string) => {
    if (focusedWordIndex === null) return
    const newWords = [...mnemonicWords]
    newWords[focusedWordIndex] = word
    setMnemonicWords(newWords)
    setMnemonicError('')
    // Move to next empty input
    const nextEmpty = newWords.findIndex((w, i) => i > focusedWordIndex && !w)
    if (nextEmpty !== -1) {
      inputRefs.current[nextEmpty]?.focus()
    } else {
      setFocusedWordIndex(null)
    }
  }

  // Mnemonic step
  const handleMnemonicNext = useCallback(() => {
    if (mode === 'import') {
      const trimmed = mnemonicWords.join(' ').trim().toLowerCase()
      if (!onValidateMnemonic(trimmed)) {
        setMnemonicError(t('onboarding.invalidMnemonic'))
        return
      }
      setMnemonic(trimmed)
    } else {
      if (!backupConfirmed) {
        setMnemonicError(t('onboarding.backupConfirmRequired'))
        return
      }
    }
    setStep('pin')
  }, [mode, mnemonicWords, backupConfirmed, onValidateMnemonic, t])

  // Refs for stable keypress handler
  const stepRef = useRef(step)
  useEffect(() => { stepRef.current = step }, [step])
  const pinRef = useRef(pin)
  useEffect(() => { pinRef.current = pin }, [pin])

  // PIN confirm - complete onboarding
  const submitPin = useCallback(async (enteredConfirmPin: string) => {
    if (pinRef.current !== enteredConfirmPin) {
      setPinError(t('onboarding.pinMismatch'))
      setConfirmPin('')
      return
    }

    setStep('recovering')
    setError('')

    try {
      const success = await onComplete({
        mnemonic,
        password: pinRef.current,
        isRecovery: mode === 'import',
      })

      if (success) {
        window.location.reload()
        return
      } else {
        setStep('pin-confirm')
        setError(t('onboarding.walletSetupFailed'))
      }
    } catch {
      setStep('pin-confirm')
      setError(t('onboarding.walletSetupFailed'))
    }
  }, [mnemonic, mode, onComplete, t])

  const handlePinKeyPress = useCallback((key: string) => {
    const currentStep = stepRef.current
    if (key === 'delete') {
      if (currentStep === 'pin') {
        setPin(prev => prev.slice(0, -1))
      } else if (currentStep === 'pin-confirm') {
        setConfirmPin(prev => prev.slice(0, -1))
      }
    } else {
      if (currentStep === 'pin') {
        setPin(prev => {
          if (prev.length >= 6) return prev
          const newPin = prev + key
          if (newPin.length === 6) {
            setTimeout(() => setStep('pin-confirm'), 200)
          }
          return newPin
        })
      } else if (currentStep === 'pin-confirm') {
        setConfirmPin(prev => {
          if (prev.length >= 6) return prev
          const newConfirm = prev + key
          if (newConfirm.length === 6) {
            setTimeout(() => submitPin(newConfirm), 200)
          }
          return newConfirm
        })
      }
    }
    setPinError('')
  }, [submitPin])

  // Go back handlers
  const goBack = useCallback((targetStep: OnboardingStep) => {
    setError('')
    setMnemonicError('')
    setPinError('')
    if (targetStep === 'pin') {
      setPin('')
      setConfirmPin('')
    }
    if (targetStep === 'mnemonic') {
      setPin('')
      setConfirmPin('')
    }
    setStep(targetStep)
  }, [])

  const isImportComplete = mnemonicWords.every(word => word.length > 0)

  // Render Welcome step
  if (step === 'welcome') {
    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col items-center justify-center p-4 pt-safe pb-safe overflow-hidden overscroll-none">
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <img src={zappiImg} alt="Zappi" className="w-40 h-40 object-contain mb-4" />
          <h1 className="text-title text-brand mb-1">{t('onboarding.appName')}</h1>
          <p className="text-caption text-foreground-muted mb-12">
            {t('onboarding.tagline')}
          </p>

          <div className="w-full space-y-3 mb-10">
            <Button variant="brand" size="xl" onClick={handleCreate} className="w-full">
              {t('onboarding.createWallet')}
            </Button>
            <Button variant="outline" size="xl" onClick={handleImport} className="w-full">
              {t('onboarding.importWallet')}
            </Button>
          </div>

          <p className="text-overline text-foreground-muted uppercase tracking-widest">
            {t('onboarding.securePrivateFast')}
          </p>
        </div>
      </div>
    )
  }

  // Render Mnemonic step
  if (step === 'mnemonic') {
    const words = mode === 'create' ? mnemonic.split(' ') : mnemonicWords

    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe pb-safe overflow-hidden overscroll-none">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center px-5 h-14 shrink-0">
            <button
              onClick={() => goBack('welcome')}
              aria-label={t('common.back')}
              className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
            >
              <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5">
            {/* Title area */}
            <div className="mb-5">
              <h2 className="text-title text-foreground mb-1">
                {mode === 'create' ? t('onboarding.secretRecoveryKey') : t('onboarding.walletRecovery')}
              </h2>
              <p className="text-caption text-foreground-muted leading-relaxed whitespace-pre-line">
                {mode === 'create'
                  ? t('onboarding.mnemonicWarning')
                  : t('onboarding.enterRecoveryPhrase')}
              </p>
            </div>

            {mode === 'import' && (
              <div className="relative flex p-1 bg-muted rounded-lg mb-4">
                <div
                  className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-brand rounded-md shadow-sm transition-transform duration-200 ease-out"
                  style={{ left: '4px', transform: wordCount === 24 ? 'translateX(100%)' : 'translateX(0)' }}
                />
                <button
                  onClick={() => handleWordCountChange(12)}
                  className={`relative z-10 flex-1 py-2 rounded-md text-caption font-semibold transition-colors duration-200 ${
                    wordCount === 12 ? 'text-white' : 'text-foreground-muted'
                  }`}
                >
                  {t('onboarding.words12')}
                </button>
                <button
                  onClick={() => handleWordCountChange(24)}
                  className={`relative z-10 flex-1 py-2 rounded-md text-caption font-semibold transition-colors duration-200 ${
                    wordCount === 24 ? 'text-white' : 'text-foreground-muted'
                  }`}
                >
                  {t('onboarding.words24')}
                </button>
              </div>
            )}

            {/* Word grid */}
            <div className="bg-background-card rounded-2xl p-4 mb-4">
              <div className={`grid grid-flow-col ${wordCount === 24 ? 'grid-cols-3 grid-rows-8' : 'grid-cols-2 grid-rows-6'} gap-x-3 gap-y-1`}>
                {(mode === 'create' ? words : mnemonicWords).map((word, i) => {
                  const rows = wordCount === 24 ? 8 : 6
                  const isLastRow = (i + 1) % rows === 0
                  return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 py-2.5 ${
                      !isLastRow ? 'border-b border-muted' : ''
                    }`}
                  >
                    <span className="text-label tabular-nums text-foreground-subtle w-5 text-right shrink-0">{i + 1}</span>
                    {mode === 'create' ? (
                      <span className="text-body font-medium text-foreground">{word}</span>
                    ) : (
                      <input
                        ref={(el) => { inputRefs.current[i] = el }}
                        type="text"
                        value={word}
                        onChange={(e) => handleWordChange(i, e.target.value)}
                        onKeyDown={(e) => handleWordKeyDown(i, e)}
                        onFocus={(e) => {
                          focusedWordIndexRef.current = i
                          setFocusedWordIndex(i)
                          if (word) e.target.select()
                        }}
                        onBlur={() => {
                          const blurredIndex = i
                          setTimeout(() => {
                            // Only clear if focus hasn't moved to another word input
                            if (focusedWordIndexRef.current === blurredIndex) {
                              focusedWordIndexRef.current = null
                              setFocusedWordIndex(null)
                            }
                          }, 150)
                        }}
                        className="flex-1 bg-transparent outline-none text-body font-medium text-foreground min-w-0"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    )}
                  </div>
                  )
                })}
              </div>
            </div>

            {/* Autocomplete suggestions */}
            {mode === 'import' && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {suggestions.map(s => (
                  <button
                    key={s}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectSuggestion(s)}
                    className="px-3 py-1.5 bg-background-card rounded-lg text-caption font-medium text-foreground active:bg-muted transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {mode === 'create' && (
              <>
                {/* Copy & Regenerate */}
                <div className="flex items-center justify-center gap-4 mb-5">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(mnemonic)
                      setMnemonicCopied(true)
                      setTimeout(() => setMnemonicCopied(false), 2000)
                    }}
                    className="flex items-center gap-1.5 text-caption font-medium text-foreground-muted active:opacity-60 transition-opacity px-3 py-2"
                  >
                    {mnemonicCopied ? <Check className="w-4 h-4 text-brand" /> : <Copy className="w-4 h-4" />}
                    {mnemonicCopied ? t('common.copied') : t('onboarding.copyToClipboard')}
                  </button>
                  <span className="text-border">|</span>
                  <button
                    onClick={handleRegenerate}
                    className="flex items-center gap-1.5 text-caption font-medium text-foreground-muted active:opacity-60 transition-opacity px-3 py-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t('onboarding.regenerateMnemonic')}
                  </button>
                </div>

                {/* Confirm checkbox */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={backupConfirmed}
                  onClick={() => setBackupConfirmed(!backupConfirmed)}
                  className="w-full flex items-center gap-3 active:opacity-70 transition-opacity"
                >
                  <div className={`
                    w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                    ${backupConfirmed
                      ? 'border-brand bg-brand'
                      : 'border-foreground-subtle'}
                  `}>
                    {backupConfirmed && (
                      <Check className="w-3.5 h-3.5 text-white" />
                    )}
                  </div>
                  <span className={`text-caption text-left leading-snug ${backupConfirmed ? 'text-foreground font-medium' : 'text-foreground-muted'}`}>
                    {t('onboarding.mnemonicSavedConfirm')}
                  </span>
                </button>
              </>
            )}

            {mnemonicError && (
              <div className="animate-fadeIn mt-4 bg-accent-danger/[0.08] px-3 py-2.5 rounded-xl">
                <p className="text-label text-accent-danger font-semibold">{mnemonicError}</p>
              </div>
            )}
          </div>

          {/* Bottom CTA */}
          <div className="px-5 pb-5 pt-3 space-y-2">
            {mode === 'import' && (
              <button
                onClick={handlePasteFromClipboard}
                className="w-full flex items-center justify-center gap-1.5 py-3 text-caption font-medium text-foreground-muted active:opacity-60 transition-opacity"
              >
                <ClipboardPaste className="w-4 h-4" />
                {t('common.paste')}
              </button>
            )}
            <Button
              variant="brand"
              size="xl"
              onClick={handleMnemonicNext}
              disabled={
                (mode === 'create' && !backupConfirmed) ||
                (mode === 'import' && !isImportComplete) ||
                isLoading
              }
              className="w-full"
            >
              {mode === 'create' ? t('onboarding.recordComplete') : t('onboarding.recoverWallet')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Render PIN step (set or confirm)
  if (step === 'pin' || step === 'pin-confirm') {
    const isConfirming = step === 'pin-confirm'
    const currentPin = isConfirming ? confirmPin : pin

    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe pb-safe overflow-hidden overscroll-none">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center px-5 h-14 shrink-0">
            <button
              onClick={() => goBack(isConfirming ? 'pin' : 'mnemonic')}
              aria-label={t('common.back')}
              className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
            >
              <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
            </button>
          </header>

          <div className="flex-1 flex flex-col items-center justify-center px-5">
            <p className="text-foreground-muted text-body mb-8 text-center">
              {isConfirming ? t('onboarding.reenterPin') : t('onboarding.enterNewPin')}
            </p>

            {/* PIN dots */}
            <div
              className="flex gap-3"
              role="status"
              aria-live="polite"
              aria-label={t('onboarding.pinDigitsEntered', { count: currentPin.length, total: 6 })}
            >
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full transition-all duration-150"
                  aria-hidden="true"
                  style={{
                    transform: currentPin.length > i ? 'scale(1)' : 'scale(0.75)',
                    backgroundColor: currentPin.length > i ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) 20%, transparent)',
                  }}
                />
              ))}
            </div>

            {(pinError || error) && (
              <div className="animate-fadeIn border-l-2 border-accent-danger bg-accent-danger/[0.06] px-3 py-2 text-caption text-accent-danger font-medium mt-4">
                {pinError || error}
              </div>
            )}

            {isLoading && (
              <div className="animate-fadeIn flex flex-col items-center gap-3 mt-4">
                <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                <span className="text-caption text-foreground-muted">
                  {loadingMessage}
                </span>
              </div>
            )}
          </div>

          <NumericKeypad
            onKeyPress={handlePinKeyPress}
            disabled={isLoading}
            deleteAriaLabel={t('common.delete')}
          />
        </div>
      </div>
    )
  }

  // Render Recovering step
  if (step === 'recovering') {
    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col items-center justify-center p-4 pt-safe pb-safe overflow-hidden overscroll-none">
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <div
            className="mb-6"
            role="status"
            aria-live="polite"
            aria-label={mode === 'import' ? t('onboarding.recoveringWallet') : t('onboarding.creatingWallet')}
          >
            <img
              src={creatingWalletSvg}
              alt=""
              className="w-64 h-64"
              aria-hidden="true"
            />
          </div>

          <h2 className="text-title mb-2">
            {mode === 'import'
              ? t('onboarding.recoveringWalletDesc')
              : t('onboarding.creatingWalletDesc')
            }
          </h2>
          <p className="text-caption text-foreground-muted">
            {t('onboarding.pleaseWait')}
          </p>
        </div>
      </div>
    )
  }

  return null
}
