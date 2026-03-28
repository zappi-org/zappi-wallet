/**
 * TokenReceiveStep — First screen of the receive flow (conversational)
 * "받을 게 있나요?" with optional token paste/scan input.
 * Empty input → go to amount step. Token input → validate and route.
 */

import { useState, useCallback } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Trans } from 'react-i18next'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import { useTranslation } from 'react-i18next'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { Button } from '@/ui/components/common/Button'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
import { validateInput, type ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'
import { hapticTap, hapticError } from '@/utils/haptic'
import { useAppStore } from '@/store'

interface TokenReceiveStepProps {
  onBack: () => void
  onTokenDetected: (token: ValidatedCashuToken) => void
  onNext: () => void
  mintUrl: string
}

type StepState = 'idle' | 'validating'

export function TokenReceiveStep({
  onBack,
  onTokenDetected,
  onNext,
  mintUrl: _mintUrl,
}: TokenReceiveStepProps) {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)

  const [state, setState] = useState<StepState>('idle')
  const [tokenInput, setTokenInput] = useState('')
  const [showScanner, setShowScanner] = useState(false)

  const handleDetectedInput = useCallback(
    async (input: string) => {
      if (state === 'validating') return

      const trimmed = input.trim()
      if (!trimmed) return

      setState('validating')
      hapticTap()

      try {
        const detected = detectInputType(trimmed)

        if (detected.type !== 'cashu-token') {
          hapticError()
          addToast({
            type: 'error',
            message: t('payment.tokenOnly'),
            duration: 3000,
          })
          setState('idle')
          return
        }

        const result = await validateInput(detected)

        if (!result.valid) {
          hapticError()
          addToast({
            type: 'error',
            message: result.error,
            duration: 3000,
          })
          setState('idle')
          return
        }

        hapticTap()
        onTokenDetected(result.data as ValidatedCashuToken)
      } catch {
        hapticError()
        addToast({
          type: 'error',
          message: t('errors.generic'),
          duration: 3000,
        })
        setState('idle')
      }
    },
    [state, addToast, onTokenDetected, t],
  )

  const handleScan = useCallback(
    (result: string) => {
      setShowScanner(false)
      handleDetectedInput(result)
    },
    [handleDetectedInput],
  )

  const handleNext = useCallback(() => {
    const trimmed = tokenInput.trim()
    if (!trimmed) {
      // Empty input → go to amount step
      hapticTap()
      onNext()
      return
    }
    // Has text → validate as token
    handleDetectedInput(trimmed)
  }, [tokenInput, onNext, handleDetectedInput])

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
          {t('receive.title')}
        </h1>
        <div className="w-10" />
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* Question */}
        <h2 className="text-heading font-semibold text-foreground">
          {t('receive.tokenInputStep.haveToken')}
        </h2>

        {/* Token input — same style as send destination */}
        <div className="mt-6">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleNext()
                }
              }}
              disabled={state === 'validating'}
              onPaste={(e) => {
                e.preventDefault()
                const text = e.clipboardData.getData('text')
                if (text) {
                  setTokenInput(text.trim())
                  handleDetectedInput(text.trim())
                }
              }}
              placeholder={t('receive.tokenInputStep.placeholder')}
              className="flex-1 min-w-0 bg-transparent py-1.5 text-title font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => setShowScanner(true)}
              disabled={state === 'validating'}
              aria-label={t('scanner.title')}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors shrink-0 disabled:opacity-50"
            >
              <CameraFilled className="text-foreground-muted" />
            </button>
          </div>

          {/* Validating spinner — fixed height */}
          <div className="h-7 mt-1 flex items-center">
            {state === 'validating' && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                <p className="text-caption text-foreground-muted">{t('scanner.validating')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom — hint + button */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        {!tokenInput.trim() && (
          <div className="flex items-start gap-2.5 bg-foreground/[0.04] rounded-xl px-4 py-3 mb-3">
            <span className="text-caption leading-relaxed mt-px">💡</span>
            <p className="text-caption text-foreground-muted leading-relaxed">
              <Trans
                i18nKey="receive.tokenInputStep.hint"
                components={{ b: <span className="font-semibold text-foreground" /> }}
              />
            </p>
          </div>
        )}
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={state === 'validating'}
          className="w-full"
        >
          {tokenInput.trim() ? t('receive.next') : t('common.no')}
        </Button>
      </div>

      {/* QR Scanner Modal — center modal */}
      {showScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={() => setShowScanner(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-background rounded-2xl w-full max-w-sm overflow-hidden animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-subtitle font-semibold">{t('scanner.title')}</h2>
              <button
                onClick={() => setShowScanner(false)}
                className="text-body font-medium text-brand active:opacity-70"
              >
                {t('common.close')}
              </button>
            </div>
            <div className="px-4 pb-5">
              <QrScanner onScan={handleScan} active={showScanner} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
