import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, type PanInfo } from 'motion/react'
import { useAppStore } from '@/store'
import { useFormatSats } from '@/utils/format'

export interface TokenRawSheetProps {
  isOpen: boolean
  onClose: () => void
  tokenString?: string
  /** Token amount in sats — shown at the top of the metadata list. */
  amount: number
  mintName: string
  unit: string
  /** Fee in sats — shown as "수취 수수료". Hidden when undefined. */
  receiveFee?: number
  /** Fires the first time the user taps the token box 10 times in a row. */
  onTriggerEasterEgg?: () => void
  /** When provided, renders a "내역 삭제" link; caller handles confirmation + deletion. */
  onDelete?: () => Promise<void> | void
}

/**
 * Bottom sheet showing the raw cashu token string plus origin metadata.
 * Opened from TokenDetailScreen's ">토큰 원문 보기".
 */
export function TokenRawSheet({
  isOpen,
  onClose,
  tokenString,
  amount,
  mintName,
  unit,
  receiveFee,
  onTriggerEasterEgg,
  onDelete,
}: TokenRawSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((s) => s.addToast)
  const [clicks, setClicks] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!isOpen) setConfirming(false)
  }, [isOpen])

  const handleDeleteTap = useCallback(() => {
    if (!onDelete || deleting) return
    setConfirming(true)
  }, [onDelete, deleting])

  const handleConfirmYes = useCallback(async () => {
    if (!onDelete || deleting) return
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }, [onDelete, deleting])

  const handleConfirmNo = useCallback(() => {
    setConfirming(false)
  }, [])

  useEffect(() => {
    if (!isOpen) setClicks(0)
  }, [isOpen])

  useEffect(() => {
    if (clicks === 10) onTriggerEasterEgg?.()
  }, [clicks, onTriggerEasterEgg])

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 500) {
        onClose()
      }
    },
    [onClose],
  )

  const handleTokenClick = useCallback(async () => {
    setClicks((n) => n + 1)
    if (!tokenString) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tokenString)
        addToast({ type: 'success', message: t('token.reclaimable.copiedToClipboard') })
      }
    } catch {
      /* clipboard blocked */
    }
  }, [tokenString, addToast, t])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-[60]"
            onClick={onClose}
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

            <div className="relative flex items-center justify-center px-5 pb-4">
              <h3 className="text-[20px] font-bold text-foreground">
                {t('token.detail.raw.title')}
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 -m-2 p-2 flex items-center justify-center rounded-lg text-foreground hover:bg-foreground/[0.06] active:bg-foreground/[0.1] transition-colors"
              >
                <X className="w-6 h-6" strokeWidth={1.6} />
              </button>
            </div>

            <div
              className="px-5 pb-6"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={handleTokenClick}
                  className="block w-full h-[160px] rounded-xl bg-background p-5 text-left overflow-hidden active:scale-[0.99] transition-transform"
                >
                  {tokenString ? (
                    <p className="text-[14px] leading-[1.5] text-foreground break-all font-mono">
                      {tokenString}
                    </p>
                  ) : (
                    <p className="text-[14px] text-foreground-muted">
                      {t('token.detail.raw.empty')}
                    </p>
                  )}
                </button>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 right-0 bottom-0 h-16 rounded-b-xl"
                  style={{
                    background:
                      'linear-gradient(to bottom, rgba(248,249,252,0) 0%, var(--background) 100%)',
                  }}
                />
              </div>

              <dl className="mt-6 flex flex-col gap-3 px-[7px] text-caption">
                <div className="flex items-center justify-between">
                  <dt className="font-medium text-foreground">
                    {t('token.detail.amountLabel')}
                  </dt>
                  <dd className="font-bold text-foreground">{formatSats(amount)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="font-medium text-foreground">
                    {t('token.detail.raw.issuingMint')}
                  </dt>
                  <dd className="font-bold text-foreground truncate max-w-[60%]">
                    {mintName}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="font-medium text-foreground">
                    {t('token.detail.raw.unit')}
                  </dt>
                  <dd className="font-bold text-foreground uppercase">{unit}</dd>
                </div>
                {receiveFee !== undefined && (
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-foreground">
                      {t('token.detail.raw.receiveFee')}
                    </dt>
                    <dd className="font-bold text-foreground">{receiveFee}</dd>
                  </div>
                )}
              </dl>

              {onDelete && (
                <div className="mt-3 flex justify-end items-center gap-3 px-[7px]">
                  {confirming ? (
                    <>
                      <span className="text-caption font-medium text-foreground-muted">
                        내역 삭제?
                      </span>
                      <button
                        type="button"
                        onClick={handleConfirmYes}
                        disabled={deleting}
                        className="text-caption font-bold text-accent-danger hover:underline disabled:opacity-60"
                      >
                        {deleting ? '삭제 중…' : '예'}
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmNo}
                        disabled={deleting}
                        className="text-caption font-medium text-foreground-muted hover:underline disabled:opacity-60"
                      >
                        아니오
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDeleteTap}
                      className="text-caption font-medium text-accent-danger hover:underline"
                    >
                      내역 삭제
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export default TokenRawSheet
