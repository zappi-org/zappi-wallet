/**
 * SendConfirmSheet — Bottom-sheet review before sending.
 * Slides up over the amount screen (which stays visible behind a scrim).
 * Reuses the same data as the former full-screen confirm: recipient display,
 * fee, source mint. Handles the recipient send paths and the direct-transfer
 * (bearer token) branch.
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { PaymentRoute } from '@/ui/hooks/use-routing'
import type { SendableValidatedData } from './SendFlow'
import { getConfirmDisplayInfo } from './sendDisplayHelpers'

interface SendConfirmSheetProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  directTransfer?: boolean
  validatedData?: SendableValidatedData | null
  amount: number
  fee: number
  mintUrl: string
  error?: string | null
  route?: PaymentRoute
  displayName?: string
  /** Direct-transfer fee estimate (recipient sends pass a resolved fee instead). */
  onEstimateFee?: (mintUrl: string, amount: number) => Promise<number | null>
  /** Tappable source mint (recipient sends). */
  onChangeMint?: () => void
}

export function SendConfirmSheet({
  open,
  onClose,
  onConfirm,
  directTransfer = false,
  validatedData,
  amount,
  fee,
  mintUrl,
  error,
  route,
  displayName,
  onEstimateFee,
  onChangeMint,
}: SendConfirmSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  const mintName = getDisplayName(mintUrl)
  const mintIcon = getIconUrl(mintUrl)

  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!open) setBusy(false) }, [open])

  // Direct-transfer branch estimates its own fee; recipient sends pass `fee`.
  const [directFee, setDirectFee] = useState<number | null>(null)
  useEffect(() => {
    if (!open || !directTransfer || !onEstimateFee || amount <= 0) { setDirectFee(null); return }
    let cancelled = false
    onEstimateFee(mintUrl, amount)
      .then((v) => { if (!cancelled) setDirectFee(v) })
      .catch(() => { if (!cancelled) setDirectFee(null) })
    return () => { cancelled = true }
  }, [open, directTransfer, onEstimateFee, mintUrl, amount])

  const effectiveFee = directTransfer ? (directFee ?? 0) : fee
  const total = amount + effectiveFee

  const recipientName = useMemo(() => {
    if (directTransfer) return t('send.direct.label')
    if (!validatedData) return ''
    return getConfirmDisplayInfo(validatedData, route, t, displayName).recipient
  }, [directTransfer, validatedData, route, t, displayName])

  const title = directTransfer ? t('send.direct.createCta') : t('send.confirm.title')
  const confirmLabel = directTransfer ? t('send.direct.createCta') : t('send.confirm.send')

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="absolute inset-x-0 bottom-0 z-50 bg-background rounded-t-3xl px-6 pt-3 pb-app"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            <div className="w-10 h-1 rounded-full bg-foreground/15 mx-auto mb-4" />
            <h3 className="text-title font-bold text-foreground mb-4">{title}</h3>

            <div className="mb-4">
              <div className="flex justify-between py-3 border-b border-border/50">
                <span className="text-body text-foreground-muted">{t('send.confirm.recipient')}</span>
                <span className="text-body font-medium text-foreground truncate max-w-[200px]">{recipientName}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-border/50">
                <span className="text-body text-foreground-muted">{t('common.amount')}</span>
                <span className="text-body font-medium text-foreground">{formatSats(amount)}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-border/50">
                <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
                <span className="text-body font-medium text-foreground">{formatSats(effectiveFee)}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-border/50">
                <span className="text-body font-bold text-foreground">{t('send.confirm.total')}</span>
                <span className="text-right">
                  <span className="block text-body font-bold text-foreground">{formatSats(total)}</span>
                  {formatFiat(total) && (
                    <span className="block text-caption text-foreground-muted">≈ {formatFiat(total)}</span>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={onChangeMint ? () => { hapticTap(); onChangeMint() } : undefined}
                disabled={!onChangeMint}
                className="w-full flex items-center justify-between py-3"
              >
                <span className="text-body text-foreground-muted">{t('send.confirm.sourceMint')}</span>
                <span className="flex items-center gap-1.5 text-body font-medium text-foreground truncate max-w-[200px]">
                  <MintIcon iconUrl={mintIcon} imgSize="w-5 h-5" className="w-5 h-5" circle />
                  {mintName}
                  {onChangeMint && <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />}
                </span>
              </button>
            </div>

            {error && (
              <div className="px-4 py-3 bg-accent-danger/10 rounded-xl text-accent-danger text-caption mb-4">{error}</div>
            )}

            <Button variant="brand" size="xl" onClick={handleConfirm} loading={busy} className="w-full">
              {confirmLabel}
            </Button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
