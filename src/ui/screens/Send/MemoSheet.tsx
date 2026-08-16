import { useState } from 'react'
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

/** Memo editor for the confirm step. The shared sheet owns the gesture and the
 *  dismissal; the keyboard offset is ours (useKeyboardInset + bottom), which is
 *  why this never used a library's input repositioning — that math threw the
 *  sheet to the top of the screen when iOS mis-reported the viewport. No
 *  delivery hint in the copy — the memo only travels on NUT-18 sends. */
export function MemoSheet({ isOpen, memo, onSave, onClose }: MemoSheetProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(memo)
  const keyboardInset = useKeyboardInset()

  // Re-seed on open so a cancelled edit doesn't leak into the next one —
  // render-phase adjustment; an effect here would cascade renders
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setDraft(memo)
  }

  const save = () => {
    onSave(draft.trim())
    onClose()
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('send.memo.changeTitle')}
      // Portalled, so it must fold when its screen is covered: an interrupt is
      // not a save, and the unsaved draft is discarded by design.
      portal
      closeWhenCovered
      scrollable={false}
      bottomOffset={keyboardInset}
      sheetClassName="rounded-t-sheet bg-background-card transition-[bottom] duration-200 ease-out motion-reduce:transition-none"
    >
          <div className="px-5 pt-4 pb-app">
            {/* The field must read as a field before focus: the card surface is
                the same white, so the input takes the page tint and a brand
                hairline instead. */}
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
