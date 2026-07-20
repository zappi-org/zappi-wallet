/**
 * ReceiveAmountSheet — keypad amount entry as an overlay on the landing so
 * the user never loses their address-QR context.
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SquarePen } from 'lucide-react'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { NumericKeypad } from '@/ui/components/common/NumericKeypad'
import { Button } from '@/ui/components/common/Button'
import { MemoSheet } from '@/ui/screens/Send/MemoSheet'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import { useSatUnit, useFormatFiat, formatFiatInputForEditing } from '@/utils/format'
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
  const unit = useSatUnit()
  const toFiat = useFormatFiat()
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState(initialMemo)
  const [memoOpen, setMemoOpen] = useState(false)

  // Re-seed when reopened (edit-from-request path passes current values) —
  // render-phase adjustment so a stale draft doesn't leak into the next open;
  // an effect here would cascade renders
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) {
      setAmount(initialAmount > 0 ? String(initialAmount) : '')
      setMemo(initialMemo)
    }
  }

  const { isFiatMode, fiatInput, currencySymbol, showFiat, handleToggleFiat, handleFiatChange } =
    useFiatToggle(amount, setAmount)
  const numericAmount = parseInt(amount, 10) || 0

  const handleKey = useCallback((key: string) => {
    hapticTap()
    if (isFiatMode) {
      if (key === 'delete') handleFiatChange(fiatInput.slice(0, -1))
      else handleFiatChange(fiatInput + key)
      return
    }
    if (key === 'delete') { setAmount((p) => p.slice(0, -1)); return }
    if (!/^[0-9]$/.test(key)) return
    setAmount((p) => {
      const next = (p + key).replace(/^0+(?=\d)/, '')
      return Number(next) > 2_100_000_000_000_000 ? p : next
    })
  }, [isFiatMode, fiatInput, handleFiatChange])

  const displayAmount = isFiatMode
    ? `${currencySymbol}${fiatInput ? formatFiatInputForEditing(fiatInput) : '0'}`
    : `${unit === '₿' ? '₿ ' : ''}${numericAmount.toLocaleString()}${unit !== '₿' ? ` ${unit}` : ''}`

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} title={t('receive.title')}>
        <div className="flex flex-col px-6 pb-safe">
          {/* Mint row — the receiving account, editable in place */}
          <button type="button" onClick={() => { hapticTap(); onEditMint() }} className="mx-auto mt-1 flex items-center gap-1 text-subtitle text-foreground-muted active:text-foreground">
            {mintDisplayName}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
          </button>

          {/* Amount hero */}
          <div className="mt-6 text-center">
            <div className="text-[34px] font-bold leading-none tracking-tight">{displayAmount}</div>
            {showFiat && (
              <button type="button" onClick={handleToggleFiat} className="mt-2 text-subtitle text-foreground-muted active:text-foreground">
                {isFiatMode ? `${numericAmount.toLocaleString()} ${unit}` : (toFiat(numericAmount) ?? `${currencySymbol}0`)} ⇅
              </button>
            )}
          </div>

          {/* Memo */}
          <button type="button" onClick={() => { hapticTap(); setMemoOpen(true) }} className="mx-auto mt-4 flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground">
            <SquarePen className="w-4 h-4" />
            {memo || t('send.memo.changeTitle')}
          </button>

          <div className="mt-6">
            <NumericKeypad onKeyPress={handleKey} />
          </div>

          <div className="mt-2 flex gap-3">
            <Button variant="secondary" size="xl" onClick={() => { hapticTap(); setAmount(''); if (isFiatMode) handleFiatChange('') }} className="flex-none px-6">
              {t('common.reset')}
            </Button>
            <Button
              variant="brand" size="xl" loading={isLoading}
              disabled={numericAmount <= 0 || !mintUrl}
              onClick={() => { hapticTap(); onConfirm({ amount: numericAmount, memo }) }}
              className="flex-1"
            >
              {t('common.confirm')}
            </Button>
          </div>
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
