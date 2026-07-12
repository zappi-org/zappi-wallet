import { useCallback, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, type PanInfo } from 'motion/react'
import { useFormatSats } from '@/utils/format'
import { formatRelativeTime } from '../token-view-model'
import type { PendingTokenView } from '../types'

export interface ReclaimSheetProps {
  isOpen: boolean
  onClose: () => void
  /** Tokens to reclaim. One entry for single-token flow, many for "Reclaim all". */
  tokens: PendingTokenView[]
  /** Per-token receive fee in sats. */
  reclaimFeePerToken?: number
  /** Called when user taps the Reclaim CTA — awaited so the button can show busy state. */
  onConfirm: (tokens: PendingTokenView[]) => Promise<void> | void
}

export function ReclaimSheet({
  isOpen,
  onClose,
  tokens,
  reclaimFeePerToken = 2,
  onConfirm,
}: ReclaimSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const [busy, setBusy] = useState(false)

  const totalAmount = tokens.reduce((sum, tk) => sum + tk.amount, 0)
  const totalFee = tokens.reduce(
    (sum, tk) => sum + (tk.reclaimFee ?? reclaimFeePerToken),
    0,
  )
  const netAmount = Math.max(0, totalAmount - totalFee)

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (busy) return
      if (info.offset.y > 100 || info.velocity.y > 500) {
        onClose()
      }
    },
    [busy, onClose],
  )

  const handleConfirm = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm(tokens)
    } finally {
      setBusy(false)
      onClose()
    }
  }, [busy, onConfirm, onClose, tokens])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-[60]"
            onClick={busy ? undefined : onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl z-[70] max-h-[85vh] bg-background-elevated"
          >
            <div className="flex justify-center py-2.5 cursor-grab active:cursor-grabbing touch-none">
              <div className="w-10 h-1 rounded-full bg-foreground/20" />
            </div>

            <div className="px-5 pb-1">
              <h3 className="text-title-sm font-bold text-foreground text-center">
                {t('token.reclaim.title')}
              </h3>
            </div>

            <div className="px-5 pt-3">
              <p className="text-caption text-[#6C6C6C] text-center">
                {t('token.reclaim.context', { count: tokens.length })}
              </p>
            </div>

            <div
              className="px-5 pt-4"
              style={{ paddingBottom: 'var(--app-bottom-padding)' }}
            >
              <div className="flex flex-col gap-3 rounded-xl bg-background px-4 py-4">
                {tokens.map((tk) => (
                  <div key={tk.id} className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-caption font-medium text-foreground truncate">
                        {tk.memo}
                      </span>
                      <span className="text-caption text-[#6C6C6C]">
                        {formatRelativeTime(t, tk.createdAt)}
                      </span>
                    </div>
                    <span className="text-caption font-medium text-foreground shrink-0">
                      {formatSats(tk.amount)}
                    </span>
                  </div>
                ))}
              </div>

              <dl className="mt-6 flex flex-col gap-2 px-[7px] text-caption">
                <div className="flex items-center justify-between">
                  <dt className="font-medium text-foreground">
                    {t('token.reclaim.summaryTotal')}
                  </dt>
                  <dd className="text-foreground">{formatSats(totalAmount)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="font-medium text-foreground">
                    {t('token.reclaim.summaryFee')}
                  </dt>
                  <dd className="text-foreground">− {formatSats(totalFee)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="font-medium text-foreground">
                    {t('token.reclaim.summaryNet')}
                  </dt>
                  <dd className="font-bold text-foreground">{formatSats(netAmount)}</dd>
                </div>
              </dl>

              <div className="mt-6 flex items-center justify-center gap-[190px]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="px-3 py-2.5 text-caption font-medium text-accent-danger disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={busy}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-[25px] bg-brand text-caption font-bold text-white active:scale-[0.98] disabled:opacity-60 transition-transform"
                  style={{
                    boxShadow:
                      '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)',
                  }}
                >
                  <Undo2 className="w-4 h-4" strokeWidth={2} />
                  <span>{t('token.reclaim.confirm')}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export default ReclaimSheet
