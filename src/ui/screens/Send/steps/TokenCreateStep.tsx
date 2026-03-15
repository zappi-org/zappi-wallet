/**
 * TokenCreateStep — Create an eCash token to share
 * Toss-style underline inputs, minimal mint row
 */

import { useState, useCallback } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSatUnit } from '@/utils/format'
import { useWallet } from '@/hooks/use-wallet'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'
import { MintCardSelector } from '@/ui/components/wallet'
import { Button } from '@/ui/components/common/Button'

interface TokenCreateStepProps {
  onBack: () => void
  onNext: (data: { amount: number; mintUrl: string; memo: string }) => void
  initialAmount?: number
  initialMintUrl?: string | null
  isLoading?: boolean
}

export function TokenCreateStep({
  onBack,
  onNext,
  initialAmount = 0,
  initialMintUrl,
  isLoading = false,
}: TokenCreateStepProps) {
  const { t } = useTranslation()
  const unit = useSatUnit()
  const { balance } = useWallet()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState('')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(
    initialMintUrl || settings.mints[0] || null
  )

  const mintBalance = selectedMintUrl ? (balance.byMint[selectedMintUrl] || 0) : 0
  const isOverBalance = !!(amount && parseInt(amount, 10) > mintBalance)

  const handleNext = useCallback(() => {
    const numericAmount = parseInt(amount, 10)
    if (!numericAmount || numericAmount <= 0) {
      addToast({ type: 'error', message: t('send.amountRequired'), duration: 3000 })
      return
    }
    if (!selectedMintUrl) {
      addToast({ type: 'error', message: t('payment.selectMint'), duration: 3000 })
      return
    }
    if (numericAmount > mintBalance) {
      addToast({ type: 'error', message: t('payment.insufficientBalance'), duration: 3000 })
      return
    }

    hapticTap()
    onNext({ amount: numericAmount, mintUrl: selectedMintUrl, memo })
  }, [amount, selectedMintUrl, mintBalance, memo, onNext, addToast, t])

  return (
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header — no border */}
      <header className="relative flex items-center px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-lg font-semibold pointer-events-none">{t('send.tokenCreate.title')}</h1>
      </header>

      {/* Mint Card Selector — outside scroll container for full-width overflow */}
      <div className="shrink-0 pt-6 pb-8">
        <MintCardSelector
          selectedMintUrl={selectedMintUrl}
          onSelect={setSelectedMintUrl}
          filterFn={(mint) => mint.balance > 0}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 space-y-10">
        {/* Amount */}
        <div>
          <p className="text-[20px] font-normal text-foreground-muted leading-snug">{t('send.tokenCreate.howMuch')}</p>
          <div className="relative">
            {unit === '₿' ? (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-[22px]">{unit}</span>
            ) : (
              <span className="absolute right-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-[18px]">{unit}</span>
            )}
            <input
              type="text"
              inputMode="numeric"
              value={amount ? Number(amount).toLocaleString() : ''}
              placeholder="0"
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '')
                if (Number(v) > 2_100_000_000_000_000) return
                setAmount(v)
              }}
              onFocus={(e) => { if (!amount) e.target.select() }}
              className={`w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none ${unit === '₿' ? 'pl-8' : 'pr-12'} py-2 text-[22px] font-bold focus:outline-none focus:border-b-foreground transition-colors ${amount ? 'text-foreground' : 'text-foreground-muted/40'}`}
            />
          </div>
          {isOverBalance && (
            <p className="text-red-500 text-sm mt-1 font-bold">{t('payment.insufficientBalance')}</p>
          )}
        </div>

        {/* Memo */}
        <div>
          <p className="text-[16px] font-normal text-foreground-muted leading-snug">{t('send.tokenCreate.memo')} ({t('send.tokenCreate.memoPlaceholder')})</p>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none px-0 py-2 text-[18px] font-normal text-foreground focus:outline-none focus:border-b-foreground transition-colors"
          />
        </div>
      </div>

      {/* Bottom Action — no border-t */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          disabled={isOverBalance}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.next')}
        </Button>
      </div>

    </div>
  )
}
