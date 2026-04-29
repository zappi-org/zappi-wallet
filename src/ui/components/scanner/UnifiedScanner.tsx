/**
 * Unified Scanner Modal
 * Scans QR codes and text input, detects type, validates, and routes to appropriate screen
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowLeft, ClipboardPaste } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import type { ValidatedData } from '@/core/domain/input-types'
import { hapticTap, hapticError } from '@/ui/utils/haptic'
import { useAppStore } from '@/store'

// ============= Types =============

export interface UnifiedScannerProps {
  isOpen: boolean
  onClose: () => void
  onValidated: (data: ValidatedData) => void
}

type ScannerState = 'idle' | 'validating'

// ============= Component =============

export function UnifiedScanner({ isOpen, onClose, onValidated }: UnifiedScannerProps) {
  const { t } = useTranslation()
  const inputParser = useInputParser()
  const [state, setState] = useState<ScannerState>('idle')
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const addToast = useAppStore((s) => s.addToast)

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState('idle')
      setInputValue('')
    }
  }, [isOpen])

  // Handle detected input (from QR scan or paste)
  const handleDetectedInput = useCallback(
    async (input: string) => {
      if (state === 'validating') return

      const trimmed = input.trim()
      if (!trimmed) return

      setState('validating')
      hapticTap()

      try {
        const detected = inputParser.detectAndClassify(trimmed)

        if (detected.type === 'unknown') {
          hapticError()
          addToast({
            type: 'error',
            message: t('scanner.unrecognizedFormat'),
            duration: 3000,
          })
          setState('idle')
          return
        }

        const validated = await inputParser.validateAsync(detected)

        hapticTap()
        onValidated(validated)
        onClose()
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
    [state, addToast, onValidated, onClose, t, inputParser]
  )

  // Handle QR scan result
  const handleScan = useCallback(
    (result: string) => {
      handleDetectedInput(result)
    },
    [handleDetectedInput]
  )

  // Handle paste button click
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setInputValue(text)
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

  // Handle keyboard paste (Ctrl+V / Cmd+V)
  const handleKeyboardPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData('text')
      if (text) {
        e.preventDefault()
        setInputValue(text)
        handleDetectedInput(text)
      }
    },
    [handleDetectedInput]
  )

  // Handle enter key for manual input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && inputValue.trim()) {
        handleDetectedInput(inputValue)
      }
    },
    [inputValue, handleDetectedInput]
  )

  if (!isOpen) return null

  return (
      <div
        className="fixed inset-0 z-50 bg-background animate-fadeIn pt-safe"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-visible">
          <button
            onClick={onClose}
            className="p-3 -ml-3 rounded-lg hover:bg-border-visible transition-colors"
            disabled={state === 'validating'}
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-subtitle font-semibold text-foreground">
            {t('scanner.title')}
          </h1>
          <div className="w-9" /> {/* Spacer for centering */}
        </div>

        {/* Content */}
        <div className="flex flex-col px-5 py-4 gap-4">
          {/* QR Scanner */}
          <div className="relative">
            <QrScanner
              onScan={handleScan}
              active={isOpen && state !== 'validating'}
            />
          </div>

          {/* Text Input */}
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPaste={handleKeyboardPaste}
              onKeyDown={handleKeyDown}
              placeholder={t('scanner.inputPlaceholder')}
              className="w-full px-4 py-3 pr-12 rounded-xl bg-background-card border border-border-visible text-foreground placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              disabled={state === 'validating'}
            />
            <button
              onClick={handlePaste}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-3 rounded-lg hover:bg-background-warm-hover transition-colors"
              disabled={state === 'validating'}
              title={t('scanner.paste')}
            >
              <ClipboardPaste className="w-5 h-5 text-accent-primary" />
            </button>
          </div>
        </div>

        {/* Validating Overlay */}
        {state === 'validating' && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 animate-fadeIn"
          >
            <div className="bg-background-card rounded-2xl p-6 flex flex-col items-center gap-3 shadow-xl">
              <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-foreground font-medium">{t('scanner.validating')}</p>
            </div>
          </div>
        )}
      </div>
  )
}
