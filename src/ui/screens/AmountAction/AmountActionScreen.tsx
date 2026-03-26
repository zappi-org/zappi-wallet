/**
 * Amount Action Screen
 * Shows when a pure number is scanned/entered
 * - With mode: navigates directly to send/receive flow with amount
 * - Without mode: shows Send/Receive buttons
 */

import { useCallback, useEffect } from 'react'
import { ArrowLeft, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFormatSats } from '@/utils/format'
import { hapticTap } from '@/utils/haptic'

export interface AmountActionScreenProps {
  amount: number
  mode?: 'send' | 'receive'
  onBack: () => void
  onSend: (amount: number) => void
  onReceive: (amount: number) => void
}

export function AmountActionScreen({
  amount,
  mode,
  onBack,
  onSend,
  onReceive,
}: AmountActionScreenProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  // If mode is set, navigate directly
  useEffect(() => {
    if (mode === 'send') {
      onSend(amount)
    } else if (mode === 'receive') {
      onReceive(amount)
    }
  }, [mode, amount, onSend, onReceive])

  const handleSend = useCallback(() => {
    hapticTap()
    onSend(amount)
  }, [amount, onSend])

  const handleReceive = useCallback(() => {
    hapticTap()
    onReceive(amount)
  }, [amount, onReceive])

  // Determine header title
  const headerTitle = mode === 'send'
    ? t('common.send')
    : mode === 'receive'
      ? t('common.receive')
      : t('amountAction.title')

  // If mode is set, we'll navigate away via useEffect — show minimal loading
  if (mode) {
    return (
      <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe pb-safe items-center justify-center">
        <p className="text-display font-bold font-display tracking-tight">{formatSats(amount)}</p>
      </div>
    )
  }

  return (
    <div className="h-dvh bg-background text-foreground font-primary flex flex-col pt-safe pb-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-4 py-3 border-b border-border-visible">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-border-visible transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{headerTitle}</h1>
        <div className="w-11" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        {/* Amount Display */}
        <p className="text-display font-bold font-display tracking-tight text-center">
          {formatSats(amount)}
        </p>

        {/* Action Buttons */}
        <div className="w-full max-w-sm flex flex-col gap-3">
          <button
            onClick={handleSend}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-brand text-white shadow-lg shadow-brand/25 active:scale-[0.95] transition-all min-h-[56px]"
          >
            <ArrowUpRight className="w-5 h-5" />
            <span className="font-semibold">{t('amountAction.send')}</span>
          </button>

          <button
            onClick={handleReceive}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-background-card text-foreground hover:bg-background-hover border border-border active:scale-[0.95] transition-all min-h-[56px]"
          >
            <ArrowDownLeft className="w-5 h-5" />
            <span className="font-semibold">{t('amountAction.receive')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default AmountActionScreen
