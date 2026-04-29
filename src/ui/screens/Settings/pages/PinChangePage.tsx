import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { NumericKeypad } from '@/ui/components/common/NumericKeypad'
import type { usePinChange } from '../usePinChange'

type PinChangeState = ReturnType<typeof usePinChange>

interface PinChangePageProps {
  pinChange: PinChangeState
}

export function PinChangePage({ pinChange }: PinChangePageProps) {
  const { t } = useTranslation()

  const {
    step,
    currentPin,
    newPin,
    confirmPin,
    error: pinError,
    isVerifying,
    isChanging,
    close,
    handleCurrentPinChange,
    handleNewPinChange,
    handleConfirmPinChange,
    handleCurrentPinSubmit,
    handlePinChangeSubmit,
  } = pinChange

  const stepLabel = step === 'current'
    ? t('settings.currentPinLabel')
    : step === 'new'
    ? t('settings.newPinLabel')
    : t('settings.confirmPinLabel')

  const currentValue = step === 'current'
    ? currentPin
    : step === 'new'
    ? newPin
    : confirmPin

  // Auto-submit when 6 digits reached (fires after re-render with updated state)
  useEffect(() => {
    if (step === 'current' && currentPin.length === 6) {
      handleCurrentPinSubmit()
    }
  }, [currentPin, step, handleCurrentPinSubmit])

  useEffect(() => {
    if (step === 'confirm' && confirmPin.length === 6) {
      handlePinChangeSubmit()
    }
  }, [confirmPin, step, handlePinChangeSubmit])

  const handleKeyPress = (key: string) => {
    if (step === 'current') {
      if (key === 'delete') {
        handleCurrentPinChange(currentPin.slice(0, -1))
      } else if (currentPin.length < 6) {
        handleCurrentPinChange(currentPin + key)
      }
    } else if (step === 'new') {
      if (key === 'delete') {
        handleNewPinChange(newPin.slice(0, -1))
      } else if (newPin.length < 6) {
        handleNewPinChange(newPin + key)
      }
    } else {
      if (key === 'delete') {
        handleConfirmPinChange(confirmPin.slice(0, -1))
      } else if (confirmPin.length < 6) {
        handleConfirmPinChange(confirmPin + key)
      }
    }
  }

  const isLoading = isVerifying || isChanging

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe pb-safe overflow-hidden z-[65]">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
          <button
            onClick={close}
            aria-label={t('common.back')}
            className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
          >
            <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
          </button>
          <h1 className="absolute inset-0 flex items-center justify-center px-16 text-center text-heading font-bold text-foreground pointer-events-none truncate">{t('settings.changePin')}</h1>
          <div className="w-10" />
        </header>

        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-5">
          <p className="text-foreground-muted text-body mb-8 text-center">
            {stepLabel}
          </p>

          {/* PIN dots */}
          <div className="flex gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full transition-all duration-150"
                style={{
                  transform: currentValue.length > i ? 'scale(1)' : 'scale(0.75)',
                  backgroundColor: currentValue.length > i
                    ? 'var(--brand)'
                    : 'color-mix(in srgb, var(--brand) 20%, transparent)',
                }}
              />
            ))}
          </div>

          {/* Error */}
          {pinError && (
            <div className="animate-fadeIn border-l-2 border-accent-danger bg-accent-danger/[0.06] px-3 py-2 text-caption text-accent-danger font-medium mt-6">
              {pinError}
            </div>
          )}
        </div>

        {/* Keypad */}
        <NumericKeypad
          onKeyPress={handleKeyPress}
          disabled={isLoading}
          deleteAriaLabel={t('common.delete')}
        />
      </div>
    </div>
  )
}
