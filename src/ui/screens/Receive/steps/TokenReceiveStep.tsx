/**
 * TokenReceiveStep — Main receive screen (fullscreen)
 * QR scanner + token text input with paste button
 * "요청 생성" button navigates to the Lightning/eCash request creation flow
 */

import { useState, useCallback } from 'react'
import { ArrowLeft, ClipboardPaste } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
import { validateInput, type ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'
import { hapticTap, hapticError } from '@/utils/haptic'
import { useAppStore } from '@/store'

interface TokenReceiveStepProps {
  onBack: () => void
  onTokenDetected: (validated: ValidatedCashuToken) => void
  onGoToCreateRequest: () => void
}

type StepState = 'idle' | 'validating'

export function TokenReceiveStep({
  onBack,
  onTokenDetected,
  onGoToCreateRequest,
}: TokenReceiveStepProps) {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)
  const [state, setState] = useState<StepState>('idle')
  const [tokenInput, setTokenInput] = useState('')

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
      handleDetectedInput(result)
    },
    [handleDetectedInput],
  )

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setTokenInput(text.trim())
        handleDetectedInput(text)
      }
    } catch {
      addToast({
        type: 'error',
        message: t('errors.clipboardError'),
        duration: 3000,
      })
    }
  }, [handleDetectedInput, addToast, t])

  // Submit manually typed/pasted token from textarea
  const handleSubmitInput = useCallback(() => {
    if (tokenInput.trim()) {
      handleDetectedInput(tokenInput)
    }
  }, [tokenInput, handleDetectedInput])

  return (
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header */}
      <header className="relative flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-lg font-semibold pointer-events-none">
          {t('receive.title')}
        </h1>
        <button
          onClick={() => {
            hapticTap()
            onGoToCreateRequest()
          }}
          className="text-sm text-accent-primary font-medium min-h-[44px] px-2 flex items-center justify-center rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors z-10"
        >
          {t('receive.createRequest')}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pt-4 space-y-8">
        {/* QR Scanner */}
        <div>
          <p className="text-[20px] font-normal text-foreground-muted leading-snug mb-3">
            {t('receive.scanQr')}
          </p>
          <div className="relative rounded-[14px] overflow-hidden aspect-square max-h-[50vh] max-w-sm mx-auto">
            <QrScanner
              onScan={handleScan}
              active={state !== 'validating'}
            />

            {/* Validating overlay */}
            {state === 'validating' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-2xl p-4 flex flex-col items-center gap-2 shadow-xl">
                  <div className="w-8 h-8 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-foreground text-sm font-medium">
                    {t('scanner.validating')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Token Input */}
        <div>
          <p className="text-[20px] font-normal text-foreground-muted leading-snug">
            {t('receive.tokenInput')}
          </p>
          <div className="flex items-end gap-1 border-b border-b-gray-200 focus-within:border-b-foreground transition-colors">
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmitInput()
                }
              }}
              disabled={state === 'validating'}
              placeholder={t('receive.tokenInputPlaceholder')}
              className="flex-1 min-w-0 bg-transparent border-0 rounded-none px-0 py-2 text-[22px] font-bold text-foreground placeholder:text-foreground-muted/40 placeholder:font-normal placeholder:text-base focus:outline-none disabled:opacity-50"
            />
            <div className="shrink-0 pb-1">
              <button
                onClick={handlePaste}
                disabled={state === 'validating'}
                aria-label={t('scanner.paste')}
                className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
              >
                <ClipboardPaste className="w-5.5 h-5.5 text-accent-primary" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action */}
      <div className="p-5 pb-safe">
        <button
          onClick={handleSubmitInput}
          disabled={state === 'validating' || !tokenInput.trim()}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] bg-brand text-white font-medium shadow-lg shadow-brand/25 active:scale-[0.98] active:opacity-90 transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed min-h-[52px] text-lg"
        >
          {t('receive.token.receive')}
        </button>
      </div>
    </div>
  )
}
