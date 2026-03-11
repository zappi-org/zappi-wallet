/**
 * TokenCreateStep — Create an eCash token to share
 * Toss-style underline inputs, minimal mint row
 */

import { useState, useCallback } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWallet } from '@/hooks/use-wallet'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'
import { formatSats } from '@/utils/format'
import { MintSelectBottomSheet } from '@/ui/components/payment'
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
  const { balance } = useWallet()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)
  const addToast = useAppStore((s) => s.addToast)

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState('')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(
    initialMintUrl || settings.mints[0] || null
  )
  const [showMintSelect, setShowMintSelect] = useState(false)

  const mintBalance = selectedMintUrl ? (balance.byMint[selectedMintUrl] || 0) : 0
  const mintName = selectedMintUrl ? getDisplayName(selectedMintUrl) : ''

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
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{t('send.tokenCreate.title')}</h1>
        <div className="w-11" />
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6 space-y-12">
        {/* Mint — narrative text + change button on right */}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[22px] leading-snug">
              <span className="font-normal">{t('send.fromMintPrefix')}</span>
              <span className="font-bold">{mintName || t('payment.selectMint')}</span>
              <span className="font-normal text-foreground-muted">{t('send.fromMintSuffix')}</span>
            </p>
            <button
              onClick={() => setShowMintSelect(true)}
              className="text-sm text-accent-primary font-medium px-3 py-1.5 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] flex items-center shrink-0"
            >
              {t('common.change')}
            </button>
          </div>
          <p className="text-[15px] text-foreground-muted mt-1">{t('common.balance')} {formatSats(mintBalance)}</p>
        </div>

        {/* Amount — question as input placeholder */}
        <div className="relative">
          {amount && <span className="absolute left-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-[22px]">₿</span>}
          <input
            type="text"
            inputMode="numeric"
            value={amount ? Number(amount).toLocaleString() : ''}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={t('send.tokenCreate.howMuch')}
            className={`w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none py-2 text-[22px] focus:outline-none focus:border-b-foreground transition-colors ${amount ? 'pl-8 font-bold text-foreground' : 'pl-0 font-normal text-foreground placeholder:text-foreground-muted/40'}`}
          />
        </div>

        {/* Memo — question as input placeholder */}
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={t('send.tokenCreate.memo')}
          className="w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none px-0 py-2 text-[22px] font-bold text-foreground placeholder:font-normal placeholder:text-foreground-muted/40 focus:outline-none focus:border-b-foreground transition-colors"
        />
      </div>

      {/* Bottom Action — no border-t */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          className="w-full !bg-[#3b7df5] !text-white !rounded-lg !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.next')}
        </Button>
      </div>

      {/* Mint Select */}
      <MintSelectBottomSheet
        isOpen={showMintSelect}
        onClose={() => setShowMintSelect(false)}
        onSelect={setSelectedMintUrl}
        selectedMintUrl={selectedMintUrl}
        filterFn={(mint) => mint.balance > 0}
      />
    </div>
  )
}
