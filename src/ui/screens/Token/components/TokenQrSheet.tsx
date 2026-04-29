import { useCallback } from 'react'
import { Copy, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, type PanInfo } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useAppStore } from '@/store'
import { useFormatSats } from '@/utils/format'

export interface TokenQrSheetProps {
  isOpen: boolean
  onClose: () => void
  tokenString?: string
  amount: number
  memo?: string
}

const PLASTIC_SHADOW =
  '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)'

/**
 * Bottom sheet with large QR for sharing a cashu token.
 * Tapping the QR or the Copy button copies the token string to clipboard.
 */
export function TokenQrSheet({
  isOpen,
  onClose,
  tokenString,
  amount,
  memo,
}: TokenQrSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((s) => s.addToast)

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 500) onClose()
    },
    [onClose],
  )

  const copyToken = useCallback(async () => {
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
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl z-[70] max-h-[95vh] bg-background-elevated"
          >
            <div className="flex justify-center pt-2.5 pb-2 cursor-grab active:cursor-grabbing touch-none">
              <div className="w-10 h-1 rounded-full bg-foreground/20" />
            </div>

            <div
              className="flex flex-col gap-4 px-5"
              style={{ paddingBottom: 24 }}
            >
              <div className="flex items-center justify-between pb-1">
                <div className="w-6 h-6 shrink-0" />
                <h3 className="text-title-sm font-bold text-foreground">
                  {t('token.detail.qr.title')}
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  className="w-6 h-6 shrink-0 flex items-center justify-center text-foreground"
                >
                  <X className="w-6 h-6" strokeWidth={1.6} />
                </button>
              </div>

              <button
                type="button"
                onClick={copyToken}
                disabled={!tokenString}
                className="w-full flex items-center justify-center active:scale-[0.99] transition-transform disabled:opacity-60"
              >
                {tokenString ? (
                  <div className="w-full aspect-square bg-white rounded-xl p-2 flex items-center justify-center">
                    <QRCodeSVG
                      value={tokenString}
                      size={400}
                      level="M"
                      includeMargin={false}
                      style={{ width: '100%', height: 'auto' }}
                    />
                  </div>
                ) : (
                  <div className="w-full aspect-square bg-background rounded-xl flex items-center justify-center text-foreground-muted text-caption">
                    {t('token.detail.raw.empty')}
                  </div>
                )}
              </button>

              <div className="flex flex-col items-center gap-1">
                <p className="text-title-sm font-medium text-foreground leading-none">
                  {formatSats(amount)}
                </p>
                {memo && (
                  <p className="text-caption text-foreground-muted">{memo}</p>
                )}
              </div>

              <div className="flex items-center justify-center pt-1 pb-1">
                <button
                  type="button"
                  onClick={copyToken}
                  disabled={!tokenString}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-[25px] bg-background-card text-caption font-medium text-foreground active:scale-[0.98] transition-transform disabled:opacity-60"
                  style={{ boxShadow: PLASTIC_SHADOW }}
                >
                  <Copy className="w-3.5 h-3.5" strokeWidth={2} />
                  <span>{t('token.detail.actions.copy')}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export default TokenQrSheet
