import { useState, useCallback, useRef, useEffect } from 'react'

import { ArrowLeft, Copy, Check, ShieldCheck, RefreshCw, Key, Plus, Delete } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import creatingWalletSvg from '@/assets/creating-wallet.svg'

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

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Update word count array
  useEffect(() => {
    setMnemonicWords(Array(wordCount).fill(''))
  }, [wordCount])

  // Welcome step - choose create or import
  const handleCreate = useCallback(() => {
    const newMnemonic = onGenerateMnemonic()
    setMnemonic(newMnemonic)
    setMode('create')
    setStep('mnemonic')
  }, [onGenerateMnemonic])

  const handleImport = useCallback(() => {
    setMode('import')
    setMnemonicWords(Array(12).fill(''))
    setWordCount(12)
    setStep('mnemonic')
  }, [])

  // Handle word input change
  const handleWordChange = (index: number, value: string) => {
    // Handle paste of full mnemonic
    if (value.includes(' ')) {
      const words = value.trim().toLowerCase().split(/\s+/)
      if (words.length === 12 || words.length === 24) {
        setWordCount(words.length as 12 | 24)
        const newWords = Array(words.length).fill('')
        words.forEach((word, i) => {
          if (i < words.length) newWords[i] = word
        })
        setMnemonicWords(newWords)
        return
      }
    }

    const newWords = [...mnemonicWords]
    newWords[index] = value.toLowerCase().trim()
    setMnemonicWords(newWords)
    setMnemonicError('')
  }

  const handleWordKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !mnemonicWords[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
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

  // PIN handlers using numeric keypad - functional updates to avoid stale closures
  const handlePinInput = useCallback((num: string) => {
    if (step === 'pin') {
      setPin(prev => {
        if (prev.length >= 6) return prev
        const newPin = prev + num
        if (newPin.length === 6) {
          setTimeout(() => setStep('pin-confirm'), 200)
        }
        return newPin
      })
    } else if (step === 'pin-confirm') {
      setConfirmPin(prev => prev.length < 6 ? prev + num : prev)
    }
    setPinError(prev => prev ? '' : prev)
  }, [step])

  const handlePinDelete = useCallback(() => {
    if (step === 'pin') {
      setPin(prev => prev.slice(0, -1))
    } else if (step === 'pin-confirm') {
      setConfirmPin(prev => prev.slice(0, -1))
    }
    setPinError(prev => prev ? '' : prev)
  }, [step])

  // PIN confirm - complete onboarding
  const handlePinComplete = useCallback(async () => {
    if (pin !== confirmPin) {
      setPinError(t('onboarding.pinMismatch'))
      setConfirmPin('')
      return
    }

    // Show dedicated processing screen for both modes
    setStep('recovering')
    setError('')

    try {
      const success = await onComplete({
        mnemonic,
        password: pin,
        isRecovery: mode === 'import',
      })

      if (success) {
        window.location.reload()
        return
      } else {
        // Go back to pin-confirm on failure
        setStep('pin-confirm')
        setError(t('onboarding.walletSetupFailed'))
      }
    } catch {
      setStep('pin-confirm')
      setError(t('onboarding.walletSetupFailed'))
    }
  }, [pin, confirmPin, mnemonic, mode, onComplete, t])

  // Auto-submit when confirm PIN is complete
  useEffect(() => {
    if (step === 'pin-confirm' && confirmPin.length === 6 && !isLoading) {
      handlePinComplete()
    }
  }, [confirmPin, step, isLoading, handlePinComplete])

  // Go back handlers
  const goBack = useCallback((targetStep: OnboardingStep) => {
    setError('')
    setMnemonicError('')
    setPinError('')
    if (targetStep === 'pin') {
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
        {/* Background blobs */}
        <div className="absolute top-[-20%] right-[-20%] w-[80vmin] h-[80vmin] bg-accent-primary/10 rounded-full blur-3xl transform-gpu pointer-events-none" />
        <div className="absolute bottom-[-20%] left-[-20%] w-[80vmin] h-[80vmin] bg-primary/5 rounded-full blur-3xl transform-gpu pointer-events-none" />

        <div className="animate-fadeIn w-full max-w-md flex flex-col items-center text-center space-y-12 relative z-10">
          <div className="space-y-3">
            <div className="w-24 h-24 bg-primary rounded-[1.5rem] flex items-center justify-center shadow-xl mx-auto transform rotate-3 hover:rotate-6 transition-transform">
              <span className="text-3xl font-bold text-primary-foreground tracking-tighter">Z</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{t('onboarding.appName')}</h1>
            <p className="text-foreground-muted text-base max-w-xs mx-auto leading-relaxed">
              {t('onboarding.tagline')}
            </p>
          </div>

          <div className="w-full space-y-3">
            <button
              onClick={handleCreate}
              className="w-full bg-primary text-primary-foreground py-3 rounded-2xl font-bold text-base shadow-lg hover:bg-primary-hover active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t('onboarding.createWallet')}
            </button>
            <button
              onClick={handleImport}
              className="w-full bg-white border border-primary/10 text-foreground py-3 rounded-2xl font-bold text-base hover:bg-background-hover active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {t('onboarding.importWallet')}
            </button>
          </div>

          <p className="text-[10px] text-foreground-muted font-medium uppercase tracking-widest">
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
      <div className="fixed inset-0 bg-background text-foreground flex flex-col p-4 pt-safe pb-safe overflow-hidden overscroll-none">
        {/* Background blobs */}
        <div className="absolute top-[-20%] right-[-20%] w-[80vmin] h-[80vmin] bg-accent-primary/10 rounded-full blur-3xl transform-gpu pointer-events-none" />
        <div className="absolute bottom-[-20%] left-[-20%] w-[80vmin] h-[80vmin] bg-primary/5 rounded-full blur-3xl transform-gpu pointer-events-none" />

        <div className="animate-fadeIn flex-1 flex flex-col max-w-md mx-auto w-full relative z-10">
          <header className="flex items-center mb-4">
            <button
              onClick={() => goBack('welcome')}
              aria-label={t('common.back')}
              className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold ml-4">
              {mode === 'create' ? t('onboarding.secretRecoveryKey') : t('onboarding.walletRecovery')}
            </h2>
          </header>

          <div className="flex-1 overflow-y-auto">
            {mode === 'create' && (
              <div className="bg-accent-danger/10 border border-accent-danger/20 p-3 rounded-xl flex gap-2 mb-4">
                <ShieldCheck className="w-5 h-5 text-accent-danger shrink-0" />
                <p className="text-xs text-accent-danger font-bold leading-tight">
                  {t('onboarding.mnemonicWarning')}
                </p>
              </div>
            )}

            {mode === 'import' && (
              <>
                <p className="text-foreground-muted mb-3">
                  {t('onboarding.enterRecoveryPhrase')}
                </p>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setWordCount(12)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors active:scale-[0.98] ${
                      wordCount === 12
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-white/60 border border-white/50 hover:bg-white/80'
                    }`}
                  >
                    {t('onboarding.words12')}
                  </button>
                  <button
                    onClick={() => setWordCount(24)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors active:scale-[0.98] ${
                      wordCount === 24
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-white/60 border border-white/50 hover:bg-white/80'
                    }`}
                  >
                    {t('onboarding.words24')}
                  </button>
                </div>
              </>
            )}

            {/* Word grid */}
            <div className={`grid ${wordCount === 24 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 mb-4`}>
              {(mode === 'create' ? words : mnemonicWords).map((word, i) => (
                <div
                  key={i}
                  className="bg-white/60 p-2 rounded-xl border border-white/50 flex items-center gap-2"
                >
                  <span className="text-[10px] font-bold text-foreground-muted w-5">{i + 1}</span>
                  {mode === 'create' ? (
                    <span className="font-bold text-foreground">{word}</span>
                  ) : (
                    <input
                      ref={(el) => { inputRefs.current[i] = el }}
                      type="text"
                      value={word}
                      onChange={(e) => handleWordChange(i, e.target.value)}
                      onKeyDown={(e) => handleWordKeyDown(i, e)}
                      className="flex-1 bg-transparent outline-none font-bold text-foreground placeholder:text-foreground-muted/30"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="..."
                    />
                  )}
                </div>
              ))}
            </div>

            {mode === 'create' && (
              <>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(mnemonic)
                    setMnemonicCopied(true)
                    setTimeout(() => setMnemonicCopied(false), 2000)
                  }}
                  className="flex items-center gap-2 text-xs font-bold text-foreground-muted hover:text-foreground transition-colors mx-auto mb-4 px-3 py-2 rounded-full hover:bg-black/5"
                >
                  {mnemonicCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {mnemonicCopied ? t('common.copied') : t('onboarding.copyToClipboard')}
                </button>

                <button
                  type="button"
                  role="checkbox"
                  aria-checked={backupConfirmed}
                  onClick={() => setBackupConfirmed(!backupConfirmed)}
                  className={`
                    w-full p-3 rounded-xl border-2 transition-colors active:scale-[0.98]
                    flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                    ${backupConfirmed
                      ? 'border-primary bg-primary/10'
                      : 'border-primary/20 bg-white/50 hover:bg-white/80'}
                  `}
                >
                  <div className={`
                    w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                    ${backupConfirmed
                      ? 'border-primary bg-primary'
                      : 'border-foreground-muted'}
                  `}>
                    {backupConfirmed && (
                      <Check className="w-4 h-4 text-primary-foreground" />
                    )}
                  </div>
                  <span className={`text-xs font-bold ${backupConfirmed ? 'text-foreground' : 'text-foreground-muted'}`}>
                    {t('onboarding.mnemonicSavedConfirm')}
                  </span>
                </button>
              </>
            )}

            {mnemonicError && (
              <div className="animate-fadeIn mt-3 bg-accent-danger/10 text-accent-danger px-3 py-2 rounded-xl text-xs font-bold">
                {mnemonicError}
              </div>
            )}
          </div>

          <button
            onClick={handleMnemonicNext}
            disabled={
              (mode === 'create' && !backupConfirmed) ||
              (mode === 'import' && !isImportComplete) ||
              isLoading
            }
            className={`
              w-full py-3 rounded-2xl font-bold text-base transition-colors mt-3
              ${(mode === 'create' && !backupConfirmed) || (mode === 'import' && !isImportComplete)
                ? 'bg-primary/20 text-foreground/40 cursor-not-allowed'
                : 'bg-primary text-primary-foreground shadow-lg hover:bg-primary-hover active:scale-[0.98]'}
            `}
          >
            {mode === 'create' ? t('onboarding.recordComplete') : t('onboarding.recoverWallet')}
          </button>
        </div>
      </div>
    )
  }

  // Render PIN step (set or confirm)
  if (step === 'pin' || step === 'pin-confirm') {
    const isConfirming = step === 'pin-confirm'
    const currentPin = isConfirming ? confirmPin : pin

    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col p-4 pt-safe pb-safe overflow-hidden overscroll-none">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          <header className="flex items-center mb-6">
            <button
              onClick={() => goBack(isConfirming ? 'pin' : 'mnemonic')}
              aria-label={t('common.back')}
              className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold ml-4">
              {isConfirming ? t('onboarding.confirmPin') : t('onboarding.setPin')}
            </h2>
          </header>

          <div className="flex-1 flex flex-col items-center">
            <div className="w-14 h-14 bg-primary/5 rounded-xl flex items-center justify-center mb-4">
              <Key className="w-6 h-6 text-foreground" />
            </div>

            <p className="text-foreground-muted mb-6 text-center">
              {isConfirming ? t('onboarding.reenterPin') : t('onboarding.enterNewPin')}
            </p>

            {/* PIN dots - no motion, pure CSS */}
            <div
              className="flex gap-3 mb-6"
              role="status"
              aria-live="polite"
              aria-label={t('onboarding.pinDigitsEntered', { count: currentPin.length, total: 6 })}
            >
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full"
                  aria-hidden="true"
                  style={{
                    transform: currentPin.length > i ? 'scale(1)' : 'scale(0.75)',
                    backgroundColor: currentPin.length > i ? '#264032' : 'rgba(38, 64, 50, 0.2)',
                  }}
                />
              ))}
            </div>

            {(pinError || error) && (
              <div className="animate-fadeIn bg-accent-danger/10 text-accent-danger px-3 py-2 rounded-xl text-xs font-bold mb-3">
                {pinError || error}
              </div>
            )}

            {isLoading && (
              <div className="animate-fadeIn flex flex-col items-center gap-3 mb-3">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-foreground-muted text-xs font-medium">
                  {loadingMessage}
                </span>
              </div>
            )}
          </div>

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-3 pb-6">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handlePinInput(num.toString())}
                disabled={isLoading}
                className="h-14 rounded-xl text-xl font-bold text-foreground hover:bg-white/50 active:bg-white/80 active:scale-95 flex items-center justify-center disabled:opacity-50 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {num}
              </button>
            ))}
            <div />
            <button
              onClick={() => handlePinInput('0')}
              disabled={isLoading}
              className="h-14 rounded-xl text-xl font-bold text-foreground hover:bg-white/50 active:bg-white/80 active:scale-95 flex items-center justify-center disabled:opacity-50 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              0
            </button>
            <button
              onClick={handlePinDelete}
              disabled={isLoading}
              aria-label={t('common.delete')}
              className="h-14 rounded-xl text-foreground hover:bg-white/50 active:bg-white/80 active:scale-95 flex items-center justify-center disabled:opacity-50 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render Recovering step
  if (step === 'recovering') {
    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col items-center justify-center p-4 pt-safe pb-safe overflow-hidden overscroll-none">
        {/* Background blobs */}
        <div className="absolute top-[-20%] right-[-20%] w-[80vmin] h-[80vmin] bg-accent-primary/10 rounded-full blur-3xl transform-gpu pointer-events-none" />
        <div className="absolute bottom-[-20%] left-[-20%] w-[80vmin] h-[80vmin] bg-primary/5 rounded-full blur-3xl transform-gpu pointer-events-none" />

        <div className="animate-fadeIn w-full max-w-md flex flex-col items-center text-center relative z-10">
          <div
            className="animate-fadeIn mb-6"
            role="status"
            aria-live="polite"
            aria-label={mode === 'import' ? t('onboarding.recoveringWallet') : t('onboarding.creatingWallet')}
          >
            <img
              src={creatingWalletSvg}
              alt=""
              className="w-80 h-80"
              aria-hidden="true"
            />
          </div>

          <h2 className="text-2xl font-bold mb-2">
            {mode === 'import' ? t('onboarding.recoveringWallet') : t('onboarding.creatingWallet')}
          </h2>
          <p className="text-foreground-muted text-base mb-4 whitespace-pre-line">
            {mode === 'import'
              ? t('onboarding.recoveringWalletDesc')
              : t('onboarding.creatingWalletDesc')
            }
          </p>
          <p className="text-foreground-muted text-xs">
            {t('onboarding.pleaseWait')}
          </p>
        </div>
      </div>
    )
  }

  return null
}
