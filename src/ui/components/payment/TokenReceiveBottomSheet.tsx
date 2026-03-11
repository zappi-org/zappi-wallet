/**
 * Token Receive Bottom Sheet
 * QR scanner + paste for receiving Cashu tokens
 * Only accepts cashu-token type inputs; rejects everything else with error toast
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { Clipboard } from 'lucide-react'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { detectInputType } from '@/ui/components/scanner/InputTypeDetector'
import { validateInput, type ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'
import { hapticTap, hapticError } from '@/utils/haptic'
import { useAppStore } from '@/store'

export interface TokenReceiveBottomSheetProps {
  isOpen: boolean
  onClose: () => void
  onTokenDetected: (validated: ValidatedCashuToken) => void
}

/**
 * Wrapper: Inner unmounts when isOpen=false, remounts fresh when isOpen=true.
 * This naturally resets local state without effect-based setState.
 */
export function TokenReceiveBottomSheet({
  isOpen,
  ...rest
}: TokenReceiveBottomSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && <TokenReceiveBottomSheetInner {...rest} />}
    </AnimatePresence>
  )
}

type SheetState = 'idle' | 'validating'

function TokenReceiveBottomSheetInner({
  onClose,
  onTokenDetected,
}: Omit<TokenReceiveBottomSheetProps, 'isOpen'>) {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)
  const [state, setState] = useState<SheetState>('idle')

  // Process detected input through detect → validate pipeline
  const handleDetectedInput = useCallback(
    async (input: string) => {
      if (state === 'validating') return

      const trimmed = input.trim()
      if (!trimmed) return

      setState('validating')
      hapticTap()

      try {
        // Step 1: Detect input type (sync)
        const detected = detectInputType(trimmed)

        // Only accept cashu-token type
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

        // Step 2: Validate (async)
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

        // Success — must be ValidatedCashuToken since we filtered for cashu-token
        hapticTap()
        onTokenDetected(result.data as ValidatedCashuToken)
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
    [state, addToast, onTokenDetected, onClose, t],
  )

  // QR scan handler
  const handleScan = useCallback(
    (result: string) => {
      handleDetectedInput(result)
    },
    [handleDetectedInput],
  )

  // Paste from clipboard
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
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

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.5 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black z-[60]"
        onClick={state !== 'validating' ? onClose : undefined}
      />

      {/* Sheet */}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t('payment.receiveToken')}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="fixed bottom-0 left-0 right-0 bg-[#fffdf6] border-t border-[rgba(133,133,133,0.23)] rounded-t-[20px] z-[70] pb-safe"
      >
        {/* Handle */}
        <div className="flex justify-center py-2">
          <div className="w-8 h-1 bg-foreground-subtle rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-center px-4 pb-3">
          <h3 className="font-semibold text-lg text-foreground">
            {t('payment.receiveToken')}
          </h3>
        </div>

        {/* QR Scanner */}
        <div className="px-5 pb-3">
          <div className="relative rounded-xl overflow-hidden">
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

        {/* Paste Button */}
        <div className="px-5 pb-5">
          <button
            onClick={handlePaste}
            disabled={state === 'validating'}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border border-[rgba(133,133,133,0.23)] bg-white text-foreground font-medium active:scale-95 active:opacity-80 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            <Clipboard className="w-5 h-5 text-accent-primary" />
            {t('scanner.paste')}
          </button>
        </div>
      </motion.div>
    </>
  )
}
