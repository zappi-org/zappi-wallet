/**
 * Amount Action Screen
 * Shows when a pure number is scanned/entered
 * - With mode: shows Lightning/Ecash choice directly (send/receive already chosen)
 * - Without mode: shows Send/Receive buttons that expand to Lightning/Ecash
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowLeft, ArrowUpRight, ArrowDownLeft, Zap, Banknote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hapticSelection, hapticTap } from '@/utils/haptic'

export interface AmountActionScreenProps {
  amount: number
  mode?: 'send' | 'receive'
  onBack: () => void
  onLightningSend: (amount: number) => void
  onLightningReceive: (amount: number) => void
  onEcashSend: (amount: number) => void
  onEcashReceive: (amount: number) => void
}

type ExpandedButton = 'send' | 'receive' | null

export function AmountActionScreen({
  amount,
  mode,
  onBack,
  onLightningSend,
  onLightningReceive,
  onEcashSend,
  onEcashReceive,
}: AmountActionScreenProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<ExpandedButton>(mode ?? null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close expanded buttons when clicking outside (only for no-mode)
  useEffect(() => {
    if (mode) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setExpanded(null)
      }
    }

    if (expanded) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [expanded, mode])

  const handleButtonClick = useCallback((button: 'send' | 'receive') => {
    hapticSelection()
    setExpanded(prev => prev === button ? null : button)
  }, [])

  const handleOptionClick = useCallback((action: () => void) => {
    hapticTap()
    action()
  }, [])

  // Determine header title
  const headerTitle = mode === 'send'
    ? t('common.send')
    : mode === 'receive'
      ? t('common.receive')
      : t('amountAction.title')

  return (
    <div className="h-dvh bg-background text-foreground font-sans flex flex-col pt-safe pb-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-visible">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-border-visible transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{headerTitle}</h1>
        <div className="w-9" />
      </header>

      {/* Content */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-6 gap-8"
        onClick={() => !mode && setExpanded(null)}
      >
        {/* Amount Display */}
        <p className="text-5xl font-bold tracking-tight text-center">
          ₿ {amount.toLocaleString()}
        </p>

        {/* Action Buttons */}
        <div
          ref={containerRef}
          className="w-full max-w-sm flex flex-col gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {mode ? (
            /* Mode set: show Lightning/Ecash directly */
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleOptionClick(() =>
                  mode === 'send' ? onLightningSend(amount) : onLightningReceive(amount)
                )}
                className="flex items-center justify-center gap-2 px-4 py-4 rounded-[12px] bg-accent-warning text-white shadow-[0_2px_8px_rgba(212,160,61,0.3)] active:scale-[0.95] transition-all"
              >
                <Zap className="w-5 h-5" />
                <span className="font-semibold">{t('amountAction.lightning')}</span>
              </button>
              <button
                onClick={() => handleOptionClick(() =>
                  mode === 'send' ? onEcashSend(amount) : onEcashReceive(amount)
                )}
                className="flex items-center justify-center gap-2 px-4 py-4 rounded-[12px] bg-accent-primary text-white shadow-[0_2px_8px_rgba(91,122,84,0.3)] active:scale-[0.95] transition-all"
              >
                <Banknote className="w-5 h-5" />
                <span className="font-semibold">{t('amountAction.ecash')}</span>
              </button>
            </div>
          ) : (
            /* No mode: show Send/Receive expandable buttons */
            <>
              {/* Send Button */}
              <div
                className={`w-full rounded-2xl transition-colors duration-200 ${
                  expanded === 'send'
                    ? 'bg-secondary text-foreground'
                    : 'bg-background-card text-foreground hover:bg-background-hover'
                } shadow-lg border border-border`}
              >
                <button
                  onClick={() => handleButtonClick('send')}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 active:scale-[0.95] transition-transform"
                >
                  <ArrowUpRight className="w-5 h-5" />
                  <span className="font-semibold">{t('amountAction.send')}</span>
                </button>

                {expanded === 'send' && (
                  <div className="overflow-hidden animate-fadeIn">
                    <div className="border-t border-border px-4 pb-4 pt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOptionClick(() => onLightningSend(amount))
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-warning text-white shadow-[0_2px_8px_rgba(212,160,61,0.3)] active:scale-[0.95] transition-all"
                      >
                        <Zap className="w-5 h-5" />
                        <span className="font-medium">{t('amountAction.lightning')}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOptionClick(() => onEcashSend(amount))
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-primary text-white shadow-[0_2px_8px_rgba(91,122,84,0.3)] active:scale-[0.95] transition-all"
                      >
                        <Banknote className="w-5 h-5" />
                        <span className="font-medium">{t('amountAction.ecash')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Receive Button */}
              <div
                className={`w-full rounded-2xl transition-colors duration-200 ${
                  expanded === 'receive'
                    ? 'bg-secondary text-foreground'
                    : 'bg-background-card text-foreground hover:bg-background-hover'
                } shadow-lg border border-border`}
              >
                <button
                  onClick={() => handleButtonClick('receive')}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 active:scale-[0.95] transition-transform"
                >
                  <ArrowDownLeft className="w-5 h-5" />
                  <span className="font-semibold">{t('amountAction.receive')}</span>
                </button>

                {expanded === 'receive' && (
                  <div className="overflow-hidden animate-fadeIn">
                    <div className="border-t border-border px-4 pb-4 pt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOptionClick(() => onLightningReceive(amount))
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-warning text-white shadow-[0_2px_8px_rgba(212,160,61,0.3)] active:scale-[0.95] transition-all"
                      >
                        <Zap className="w-5 h-5" />
                        <span className="font-medium">{t('amountAction.lightning')}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOptionClick(() => onEcashReceive(amount))
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-primary text-white shadow-[0_2px_8px_rgba(91,122,84,0.3)] active:scale-[0.95] transition-all"
                      >
                        <Banknote className="w-5 h-5" />
                        <span className="font-medium">{t('amountAction.ecash')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default AmountActionScreen
