/**
 * ReceiveAmountStep — full-screen amount entry for the request path (promoted
 * from the old ReceiveAmountSheet so the keypad owns the screen instead of a
 * 70dvh sheet). The mint bar rides up as AmountEntry's topSlot; the memo
 * trigger sits in the middleSlot above the keypad; the 초기화/확인 row sits
 * in the bottomSlot.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, SquarePen } from 'lucide-react'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { MemoSheet } from '@/ui/screens/Send/MemoSheet'
import { AmountEntry } from '@/ui/components/payment/AmountEntry'
import { hapticTap } from '@/ui/utils/haptic'

export interface ReceiveAmountStepProps {
  mintUrl: string | null
  mintDisplayName: string
  mintIconUrl?: string | null
  onEditMint: () => void
  initialAmount: number
  initialMemo: string
  isLoading?: boolean
  onConfirm: (data: { amount: number; memo: string }) => void
  onBack: () => void
}

export function ReceiveAmountStep({
  mintUrl,
  mintDisplayName,
  mintIconUrl,
  onEditMint,
  initialAmount,
  initialMemo,
  isLoading = false,
  onConfirm,
  onBack,
}: ReceiveAmountStepProps) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState(initialMemo)
  const [memoOpen, setMemoOpen] = useState(false)

  // Bumped on reset to force a fresh AmountEntry instance: its internal
  // fiat-toggle draft is never derived from `value`, so a plain setAmount('')
  // would leave a stale fiat string that the next keystroke appends to.
  const [amountEntryKey, setAmountEntryKey] = useState(0)

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t('receive.title')} onBack={onBack} />

      <AmountEntry
        key={amountEntryKey}
        value={amount}
        onChange={setAmount}
        emptyPrompt={t('receive.amount.prompt')}
        topSlot={
          <button
            type="button"
            onClick={() => {
              hapticTap()
              onEditMint()
            }}
            className="mx-auto flex items-center justify-center gap-2 pt-2"
          >
            <MintIcon iconUrl={mintIconUrl ?? undefined} imgSize="w-6 h-6" className="w-6 h-6" circle />
            <span className="text-body font-medium text-foreground truncate max-w-[220px]">{mintDisplayName}</span>
            <ChevronDown className="w-4 h-4 text-foreground-muted shrink-0" strokeWidth={2} />
          </button>
        }
        middleSlot={
          /* Figma 금액지정: the memo lives with the amount it annotates, above
             the keypad, not with the bottom controls. */
          <button
            type="button"
            onClick={() => {
              hapticTap()
              setMemoOpen(true)
            }}
            /* min-h keeps the thumb target at 44px next to the keypad; the
               smaller margin offsets the added padding so the rhythm holds. */
            className="mx-auto mb-1 flex min-h-[44px] items-center gap-1.5 px-4 text-subtitle font-medium text-foreground-muted active:text-foreground"
          >
            <SquarePen className="h-4 w-4" />
            {memo || t('send.memo.changeTitle')}
          </button>
        }
        bottomSlot={
          <div className="px-6 pb-app">
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="xl"
                onClick={() => {
                  hapticTap()
                  setAmount('')
                  setAmountEntryKey((k) => k + 1)
                }}
                className="flex-none px-6"
              >
                {t('common.reset')}
              </Button>
              <Button
                variant="brand"
                size="xl"
                loading={isLoading}
                disabled={(parseInt(amount, 10) || 0) <= 0 || !mintUrl}
                onClick={() => {
                  hapticTap()
                  onConfirm({ amount: parseInt(amount, 10) || 0, memo })
                }}
                className="flex-1"
              >
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        }
      />

      <MemoSheet
        isOpen={memoOpen}
        memo={memo}
        onSave={(m) => {
          setMemo(m)
          setMemoOpen(false)
        }}
        onClose={() => setMemoOpen(false)}
      />
    </div>
  )
}
