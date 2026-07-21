import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { Button } from '@/ui/components/common/Button'
import { useIsActivityTop } from '@/ui/navigation/use-is-activity-top'

const MEMO_MAX_LENGTH = 200

interface MemoSheetProps {
  isOpen: boolean
  memo: string
  onSave: (memo: string) => void
  onClose: () => void
}

/** Memo editor for the confirm step. Built on Vaul so the drawer rides the iOS
 *  soft keyboard via VisualViewport (no manual keyboard-inset math) and dismisses
 *  by drag/backdrop with proper momentum. No delivery hint in the copy — the memo
 *  only travels on NUT-18 sends, not lightning. */
export function MemoSheet({ isOpen, memo, onSave, onClose }: MemoSheetProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(memo)
  const isTop = useIsActivityTop()

  // This drawer portals to document.body, so when another activity is pushed on
  // top of the owning screen (e.g. an incoming payment pushes Receive) stackflow
  // hides only that screen's DOM — the portal would stay modal over the new one.
  // Close via the parent's onClose so isOpen stays the single source of truth;
  // flipping the controlled prop here would desync it. Unsaved draft is discarded
  // by design: an interrupt is not a save.
  useEffect(() => {
    if (isOpen && !isTop) onClose()
  }, [isOpen, isTop, onClose])

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
    <Drawer.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-background-card outline-none"
        >
          {/* Plain handle — Vaul drags from anywhere on the content, so this is
              purely the visual grabber, styled to match the app's sheets. */}
          <div className="flex justify-center py-2.5">
            <div className="h-1 w-10 rounded-full bg-foreground-subtle" />
          </div>
          <div className="px-5 pb-3 border-b border-foreground-subtle/20">
            <Drawer.Title className="text-subtitle font-semibold text-foreground text-center">
              {t('send.memo.changeTitle')}
            </Drawer.Title>
          </div>
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
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
