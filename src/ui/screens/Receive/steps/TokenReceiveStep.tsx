/**
 * TokenReceiveStep — First screen of the receive flow (conversational)
 * "받을 게 있나요?" with optional token paste/scan input.
 * Empty input → go to amount step. Token input → validate and route.
 */

import { useState, useCallback } from 'react'
import { Trans } from 'react-i18next'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import { useTranslation } from 'react-i18next'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import type { ValidatedCashuToken } from '@/core/domain/input-types'
import { hapticTap, hapticError } from '@/ui/utils/haptic'
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
  const inputParser = useInputParser()

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
        const detected = inputParser.detectAndClassify(trimmed)

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

        const validated = await inputParser.validateAsync(detected)

        hapticTap()
        onTokenDetected(validated as ValidatedCashuToken)
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
    [state, addToast, onTokenDetected, t, inputParser],
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
      <ScreenHeader title={t('receive.title')} onBack={onBack} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* Question */}
        <h2 className="text-heading font-semibold text-foreground">
          {t('receive.tokenInputStep.haveToken')}
        </h2>
        {!tokenInput.trim() && (
          <p className="text-body text-foreground/70 leading-relaxed mt-2 break-keep">
            <Trans
              i18nKey="receive.tokenInputStep.hint"
              components={{ b: <span className="font-semibold text-foreground" /> }}
            />
          </p>
        )}

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

      {/* Bottom — button */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={state === 'validating'}
          className="w-full"
        >
          {t('receive.next')}
        </Button>
      </div>

      <QrScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} onScan={handleScan} />
    </div>
  )
}
