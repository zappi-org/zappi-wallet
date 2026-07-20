/**
 * ReceiveAmountSheet — keypad amount entry as an overlay on the landing so
 * the user never loses their address-QR context.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SquarePen } from 'lucide-react'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { Button } from '@/ui/components/common/Button'
import { MemoSheet } from '@/ui/screens/Send/MemoSheet'
import { AmountEntry } from '@/ui/components/payment/AmountEntry'
import { hapticTap } from '@/ui/utils/haptic'

export interface ReceiveAmountSheetProps {
  isOpen: boolean
  onClose: () => void
  mintUrl: string | null
  mintDisplayName: string
  onEditMint: () => void
  initialAmount: number
  initialMemo: string
  isLoading?: boolean
  onConfirm: (data: { amount: number; memo: string }) => void
}

export function ReceiveAmountSheet({
  isOpen, onClose, mintUrl, mintDisplayName, onEditMint,
  initialAmount, initialMemo, isLoading = false, onConfirm,
}: ReceiveAmountSheetProps) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState(initialMemo)
  const [memoOpen, setMemoOpen] = useState(false)

  // Re-seed when reopened (edit-from-request path passes current values) —
  // render-phase adjustment so a stale draft doesn't leak into the next open;
  // an effect here would cascade renders. Bumping amountEntryKey forces a fresh
  // AmountEntry instance because its internal fiat-toggle state (mode + fiat
  // string) is never derived from the value prop: reopen could reuse a
  // still-exiting instance (BottomSheet unmounts only after its exit
  // animation), and reset would otherwise leave fiatInput populated so the
  // next fiat keystroke appends to the old digits.
  const [prevOpen, setPrevOpen] = useState(isOpen)
  const [amountEntryKey, setAmountEntryKey] = useState(0)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) {
      setAmount(initialAmount > 0 ? String(initialAmount) : '')
      setMemo(initialMemo)
      setAmountEntryKey((k) => k + 1)
    }
  }

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} title={t('receive.title')}>
        <div className="flex h-[70dvh] flex-col pb-safe">
          <AmountEntry
            key={amountEntryKey}
            value={amount}
            onChange={setAmount}
            topSlot={
              <button
                type="button"
                onClick={() => { hapticTap(); onEditMint() }}
                className="mx-auto mt-1 flex items-center gap-1 text-subtitle text-foreground-muted active:text-foreground"
              >
                {mintDisplayName}
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
              </button>
            }
            bottomSlot={
              <div className="px-6">
                <button
                  type="button"
                  onClick={() => { hapticTap(); setMemoOpen(true) }}
                  className="mx-auto mb-3 flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground"
                >
                  <SquarePen className="w-4 h-4" />
                  {memo || t('send.memo.changeTitle')}
                </button>
                <div className="flex gap-3">
                  <Button
                    variant="secondary" size="xl"
                    onClick={() => { hapticTap(); setAmount(''); setAmountEntryKey((k) => k + 1) }}
                    className="flex-none px-6"
                  >
                    {t('common.reset')}
                  </Button>
                  <Button
                    variant="brand" size="xl" loading={isLoading}
                    disabled={(parseInt(amount, 10) || 0) <= 0 || !mintUrl}
                    onClick={() => { hapticTap(); onConfirm({ amount: parseInt(amount, 10) || 0, memo }) }}
                    className="flex-1"
                  >
                    {t('common.confirm')}
                  </Button>
                </div>
              </div>
            }
          />
        </div>
      </BottomSheet>

      {/* Sibling, not a child of the sheet above: BottomSheet's motion.div carries a
          transform (drag/animation), which makes it a containing block for
          position:fixed descendants — nesting MemoSheet inside would confine its
          backdrop/sheet to the parent's box instead of the viewport. */}
      <MemoSheet isOpen={memoOpen} memo={memo} onSave={(m) => { setMemo(m); setMemoOpen(false) }} onClose={() => setMemoOpen(false)} />
    </>
  )
}
