import { useState, useCallback, useRef, useEffect } from 'react'

import { ArrowLeft, Copy, Check, RefreshCw } from 'lucide-react'
import { NumericKeypad } from '@/ui/components/common/NumericKeypad'
import { Button } from '@/ui/components/common/Button'
import { useTranslation } from 'react-i18next'
import creatingWalletSvg from '@/assets/creating-wallet.svg'
import zappiImg from '@/assets/zappi.png'

export type OnboardingStep = 'welcome' | 'mnemonic' | 'pin' | 'pin-confirm' | 'recovering'

export interface OnboardingScreenProps {
  onComplete: (data: OnboardingData) => Promise<boolean>
  onGenerateMnemonic: () => string
}

export interface OnboardingData {
  mnemonic: string
  password: string
}

export function OnboardingScreen({
  onComplete,
  onGenerateMnemonic,
}: OnboardingScreenProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<OnboardingStep>('welcome')

  // Invite code gate
  const [inviteUnlocked, setInviteUnlocked] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteAttempts, setInviteAttempts] = useState(() => {
    const saved = localStorage.getItem('zappi_invite_attempts')
    return saved ? parseInt(saved, 10) : 0
  })
  const [inviteLockUntil, setInviteLockUntil] = useState(() => {
    const saved = localStorage.getItem('zappi_invite_lock_until')
    return saved ? parseInt(saved, 10) : 0
  })

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (inviteLockUntil <= 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [inviteLockUntil])
  const isInviteLocked = inviteLockUntil > now

  const handleInviteSubmit = useCallback(() => {
    if (isInviteLocked) return

    const trimmed = inviteCode.trim()
    const MASTER = 'weareallzappi!'
    const ALPHA = 'izappiyou!'
    // 2026-05-04 00:00 KST through 2026-05-10 23:59:59 KST.
    const ALPHA_START = new Date('2026-05-03T15:00:00Z').getTime()
    const ALPHA_EXPIRY = new Date('2026-05-10T15:00:00Z').getTime()

    if (trimmed === MASTER) {
      setInviteUnlocked(true)
      localStorage.setItem('zappi_invite_attempts', '0')
      return
    }

    const nowMs = Date.now()
    if (trimmed === ALPHA && nowMs >= ALPHA_START && nowMs < ALPHA_EXPIRY) {
      setInviteUnlocked(true)
      localStorage.setItem('zappi_invite_attempts', '0')
      return
    }

    const newAttempts = inviteAttempts + 1
    setInviteAttempts(newAttempts)
    localStorage.setItem('zappi_invite_attempts', String(newAttempts))

    if (newAttempts >= 5) {
      const lockUntil = Date.now() + 5 * 60 * 1000
      setInviteLockUntil(lockUntil)
      localStorage.setItem('zappi_invite_lock_until', String(lockUntil))
      setInviteAttempts(0)
      localStorage.setItem('zappi_invite_attempts', '0')
      setInviteError(t('onboarding.inviteLocked'))
    } else {
      setInviteError(t('onboarding.inviteInvalidCount', { current: newAttempts, max: 5 }))
    }
    setInviteCode('')
  }, [inviteCode, inviteAttempts, isInviteLocked, t])
  const [mnemonic, setMnemonic] = useState('')
  const [mnemonicError, setMnemonicError] = useState('')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [isLoading, _setIsLoading] = useState(false)
  const [loadingMessage, _setLoadingMessage] = useState('')
  const [error, setError] = useState('')
  const [mnemonicCopied, setMnemonicCopied] = useState(false)

  // Welcome step - create a new local wallet only.
  const handleCreate = useCallback(() => {
    const newMnemonic = onGenerateMnemonic()
    setMnemonic(newMnemonic)
    setStep('mnemonic')
  }, [onGenerateMnemonic])

  const handleRegenerate = useCallback(() => {
    const newMnemonic = onGenerateMnemonic()
    setMnemonic(newMnemonic)
    setMnemonicCopied(false)
    setBackupConfirmed(false)
  }, [onGenerateMnemonic])

  // Mnemonic step
  const handleMnemonicNext = useCallback(() => {
    if (!backupConfirmed) {
      setMnemonicError(t('onboarding.backupConfirmRequired'))
      return
    }
    setStep('pin')
  }, [backupConfirmed, t])

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
  }, [mnemonic, onComplete, t])

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

  // Render Welcome step
  if (step === 'welcome') {
    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col items-center justify-center p-4 pt-safe overflow-hidden overscroll-none">
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <img src={zappiImg} alt="Zappi" className="w-40 h-40 object-contain mb-4" />
          <h1 className="text-title font-bold text-brand mb-1">{t('onboarding.appName')}</h1>
          <p className="text-caption text-foreground-muted mb-12">
            {t('onboarding.tagline')}
          </p>

          {inviteUnlocked ? (
            <>
              <div className="w-full space-y-3 mb-10">
                <Button variant="brand" size="xl" onClick={handleCreate} className="w-full">
                  {t('onboarding.createWallet')}
                </Button>
              </div>
              <p className="text-overline font-medium text-foreground-muted uppercase tracking-widest">
                {t('onboarding.securePrivateFast')}
              </p>
            </>
          ) : (
            <div className="w-full max-w-[280px]">
              <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => { setInviteCode(e.target.value); setInviteError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleInviteSubmit() }}
                  placeholder={t('onboarding.invitePlaceholder')}
                  disabled={isInviteLocked}
                  className="flex-1 bg-transparent py-2 text-body font-medium text-foreground text-center placeholder:text-foreground-muted focus:outline-none disabled:opacity-40"
                />
              </div>
              {inviteError && (
                <p className="text-caption text-accent-danger text-center mt-2">{inviteError}</p>
              )}
              {isInviteLocked && (() => {
                const remainSec = Math.max(0, Math.ceil((inviteLockUntil - now) / 1000))
                const min = Math.floor(remainSec / 60)
                const sec = remainSec % 60
                return (
                  <p className="text-caption text-foreground-muted text-center mt-1">
                    {min}:{sec.toString().padStart(2, '0')}
                  </p>
                )
              })()}
              <Button
                variant="brand"
                size="xl"
                onClick={handleInviteSubmit}
                disabled={!inviteCode.trim() || isInviteLocked}
                className="w-full mt-4"
              >
                {t('common.confirm')}
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Render Mnemonic step
  if (step === 'mnemonic') {
    const words = mnemonic.split(' ')

    return (
      <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden overscroll-none">
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
              <h2 className="text-title font-bold text-foreground mb-1">
                {t('onboarding.secretRecoveryKey')}
              </h2>
              <p className="text-caption text-foreground-muted leading-relaxed whitespace-pre-line">
                {t('onboarding.mnemonicWarning')}
              </p>
            </div>

            {/* Word grid */}
            <div className="bg-background-card rounded-2xl p-4 mb-4">
              <div className="grid grid-flow-col grid-cols-2 grid-rows-6 gap-x-3 gap-y-1">
                {words.map((word, i) => {
                  const rows = 6
                  const isLastRow = (i + 1) % rows === 0
                  return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 py-2.5 ${
                      !isLastRow ? 'border-b border-muted' : ''
                    }`}
                  >
                    <span className="text-label font-medium tabular-nums text-foreground-subtle w-5 text-right shrink-0">{i + 1}</span>
                    <span className="text-body font-medium text-foreground">{word}</span>
                  </div>
                  )
                })}
              </div>
            </div>

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

            {mnemonicError && (
              <div className="animate-fadeIn mt-4 bg-accent-danger/[0.08] px-3 py-2.5 rounded-xl">
                <p className="text-label text-accent-danger font-semibold">{mnemonicError}</p>
              </div>
            )}
          </div>

          {/* Bottom CTA */}
          <div className="px-5 pb-5 pt-3 space-y-4">
            <button
              type="button"
              role="checkbox"
              aria-checked={backupConfirmed}
              onClick={() => setBackupConfirmed(!backupConfirmed)}
              className="w-full flex items-center justify-center gap-3 rounded-xl px-1 py-2 active:opacity-70 transition-opacity"
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
              <span className={`text-caption text-center leading-snug ${backupConfirmed ? 'text-foreground font-medium' : 'text-foreground-muted'}`}>
                {t('onboarding.mnemonicSavedConfirm')}
              </span>
            </button>
            <Button
              variant="brand"
              size="xl"
              onClick={handleMnemonicNext}
              disabled={!backupConfirmed || isLoading}
              className="w-full"
            >
              {t('onboarding.recordComplete')}
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
      <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden overscroll-none">
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
      <div className="fixed inset-0 bg-background text-foreground flex flex-col items-center justify-center p-4 pt-safe overflow-hidden overscroll-none">
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <div
            className="mb-6"
            role="status"
            aria-live="polite"
            aria-label={t('onboarding.creatingWallet')}
          >
            <img
              src={creatingWalletSvg}
              alt=""
              className="w-64 h-64"
              aria-hidden="true"
            />
          </div>

          <h2 className="text-title font-bold mb-2">
            {t('onboarding.creatingWalletDesc')}
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
