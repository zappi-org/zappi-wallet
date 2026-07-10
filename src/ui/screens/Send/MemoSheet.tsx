import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { Button } from '@/ui/components/common/Button'

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

  // Re-seed on open so a cancelled edit doesn't leak into the next one —
  // render-phase adjustment; an effect here would cascade renders
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    if (isOpen) setDraft(memo)
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('send.memo.changeTitle')}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('send.memo.placeholder')}
        maxLength={200}
        className="w-full rounded-xl bg-background-card px-4 py-3 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-foreground/15"
      />
      <Button
        variant="brand"
        size="xl"
        className="w-full mt-4"
        onClick={() => {
          onSave(draft.trim())
          onClose()
        }}
      >
        {t('common.save')}
      </Button>
    </BottomSheet>
  )
}
