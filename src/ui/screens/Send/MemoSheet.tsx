import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { Button } from '@/ui/components/common/Button'
import { useKeyboardInset } from '@/ui/hooks/use-keyboard-inset'

const MEMO_MAX_LENGTH = 200

interface MemoSheetProps {
  isOpen: boolean
  memo: string
  onSave: (memo: string) => void
  onClose: () => void
}

/** Memo editor for the confirm step. No delivery hint in the copy —
 *  the memo only travels on NUT-18 sends, not lightning. */
export function MemoSheet({ isOpen, memo, onSave, onClose }: MemoSheetProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(memo)
  // Keyboard-attached: the sheet rides above the soft keyboard so the field
  // and the save action are never buried under it.
  const keyboardInset = useKeyboardInset()

  // Re-seed on open so a cancelled edit doesn't leak into the next one —
  // render-phase adjustment; an effect here would cascade renders
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setDraft(memo)
  }

  // Blur before closing so the keyboard starts retracting as the sheet leaves,
  // instead of the viewport collapsing after unmount. The bottom offset is
  // CSS-transitioned below, so the resulting inset→0 change eases down with the
  // exit slide rather than snapping the still-lifted sheet to bottom:0 mid-exit
  // (the jump seen on backdrop-tap/save, and after a manual keyboard dismiss).
  const dismiss = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    onClose()
  }, [onClose])

  const save = () => {
    onSave(draft.trim())
    dismiss()
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={dismiss}
      title={t('send.memo.changeTitle')}
      sheetClassName="bg-background-elevated rounded-t-3xl overflow-hidden transition-[bottom] duration-200 ease-out motion-reduce:transition-none"
      bottomOffset={keyboardInset}
      scrollable={false}
    >
      <div className="px-5 pt-4 pb-app">
        {/* The field must read as a field before focus: elevated sheets are the
            same white as background-card, so the input takes the page tint and
            a brand hairline instead. */}
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
          placeholder={t('send.memo.placeholder')}
          maxLength={MEMO_MAX_LENGTH}
          className="w-full rounded-2xl border border-brand/40 bg-background px-4 py-3.5 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-brand/70 focus:ring-2 focus:ring-brand/15"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-caption text-foreground-muted tabular-nums">
            {draft.length} / {MEMO_MAX_LENGTH}
          </span>
          <Button variant="brand" size="md" className="rounded-full px-7" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
