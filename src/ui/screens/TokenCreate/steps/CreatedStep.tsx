import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Confetti } from '@/ui/components/payment/Confetti'
import sendSuccessImg from '@/assets/send-success.png'
import { useFormatSats } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useOwnPaymentEvent } from '@/ui/hooks/use-own-payment-event'
import { useSendClaimed } from '@/ui/hooks/use-send-claimed'
import { useAppStore } from '@/store'
import { hapticSuccess } from '@/ui/utils/haptic'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Copy, Eye, Share2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface CreatedStepProps {
  amount: number
  memo: string
  senderPaysFee: boolean
  mintUrl: string
  /** Cashu token string produced by send. Empty if unavailable. */
  tokenString: string
  /** Transaction id of the pending send — used for live fee quote. */
  txId?: string
  onClose: () => void
  /** Reclaim the created token — returns to token tab on success. */
  onCancelToken?: () => Promise<void> | void
  /** Live reclaim/receive fee quote. Returns null if unavailable. */
  onQuoteReclaim?: (txId: string) => Promise<number | null>
}

const SPENT_AUTO_DISMISS_MS = 3000

export function CreatedStep({
  amount,
  memo,
  senderPaysFee,
  mintUrl,
  tokenString,
  txId,
  onClose,
  onCancelToken,
  onQuoteReclaim,
}: CreatedStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((s) => s.addToast)
  const [veiled, setVeiled] = useState(true)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [receiveFee, setReceiveFee] = useState<number | null>(null)
  const [isSpent, setIsSpent] = useState(false)
  const spentGuardRef = useRef(false)
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)
  const mintName = getDisplayName(mintUrl)

  // Claim this tx for full-screen UX ownership — suppresses the global
  // "사용되었어요" toast so the user doesn't see duplicate notifications.
  useOwnPaymentEvent(txId)

  // Subscribe to send:claimed event filtered by this tx —
  // fires when the recipient claims/uses the token (send-token-observer).
  const handleSpent = useCallback(() => {
    if (spentGuardRef.current) return
    spentGuardRef.current = true
    setIsSpent(true)
    hapticSuccess()
  }, [])
  useSendClaimed(txId, handleSpent)

  // Auto-dismiss a few seconds after the token is claimed.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!isSpent) return
    const timer = window.setTimeout(() => onCloseRef.current(), SPENT_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [isSpent])

  useEffect(() => {
    if (!txId || !onQuoteReclaim) return
    let cancelled = false
    onQuoteReclaim(txId)
      .then((fee) => {
        if (!cancelled) setReceiveFee(fee)
      })
      .catch(() => {
        /* ignore — fee line simply won't show */
      })
    return () => {
      cancelled = true
    }
  }, [txId, onQuoteReclaim])

  const displayedAmount = senderPaysFee ? amount + (receiveFee ?? 0) : amount

  const copyToken = useCallback(async () => {
    if (!tokenString) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tokenString)
        hapticSuccess()
        addToast({ type: 'success', message: t('token.reclaimable.copiedToClipboard') })
      }
    } catch {
      /* clipboard blocked — silent */
    }
  }, [tokenString, addToast, t])

  const shareToken = useCallback(async () => {
    if (!tokenString) return
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ text: tokenString })
        return
      }
      // Fallback to clipboard copy
      await copyToken()
    } catch {
      /* user cancelled share sheet — silent */
    }
  }, [tokenString, copyToken])

  const handleCancel = useCallback(async () => {
    if (cancelBusy || !onCancelToken || isSpent) return
    setCancelBusy(true)
    try {
      await onCancelToken()
    } finally {
      setCancelBusy(false)
    }
  }, [cancelBusy, onCancelToken, isSpent])

  return (
    <div className="flex flex-col h-full bg-background relative">
      {isSpent && <Confetti />}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <X className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold text-foreground pointer-events-none">
          {isSpent ? t('send.tokenCreate.spentTitle') : t('send.tokenCreate.createdTitle')}
        </h1>
        <div className="w-10" />
      </header>

      {isSpent ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-4">
          <motion.img
            src={sendSuccessImg}
            alt="Success"
            className="w-[120px] h-[120px] object-contain mb-2"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
          />
          <p className="text-heading font-semibold text-foreground text-center">
            {t('send.tokenCreate.spentMessage', { amount: formatSats(displayedAmount) })}
          </p>
          <p className="text-body text-foreground-muted text-center">
            {memo ? `${memo} · ` : ''}
            {mintName}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pt-2 flex flex-col gap-6">
          {/* QR — veiled until tapped; QR fills the outer frame */}
          <button
            type="button"
            onClick={() => setVeiled((v) => !v)}
            className="relative aspect-square w-full max-w-[360px] mx-auto rounded-card overflow-hidden flex items-center justify-center bg-white p-4"
          >
            {tokenString ? (
              <div
                className={`w-full h-full flex items-center justify-center transition-all ${
                  veiled ? 'blur-md opacity-40' : ''
                }`}
              >
                <QRCodeDisplay value={tokenString} level="M" fill />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-foreground-muted">
                <div className="text-5xl">🔳</div>
                <span className="text-caption">{t('token.detail.raw.empty')}</span>
              </div>
            )}

            {veiled && tokenString && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                <div className="text-5xl">🙈</div>
                <div className="flex items-center gap-1.5 text-caption text-foreground-muted">
                  <Eye className="w-4 h-4" strokeWidth={1.8} />
                  <span>{t('send.tokenCreate.tapToReveal')}</span>
                </div>
              </div>
            )}
          </button>

          {/* Amount + meta */}
          <div className="flex flex-col items-center gap-1">
            <p className="text-heading leading-none font-semibold text-foreground">
              {formatSats(displayedAmount)}
            </p>
            <p className="text-body text-foreground-muted mt-2">
              {memo ? `${memo} · ` : ''}
              {mintName}
            </p>
            {!senderPaysFee && receiveFee !== null && receiveFee > 0 && (
              <p className="text-caption text-foreground-muted mt-1">
                {t('send.tokenCreate.receiveFeeAmount', { amount: formatSats(receiveFee) })}
              </p>
            )}
          </div>

          {/* Copy / Share */}
          <div className="flex items-center gap-3 mt-2">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              icon={<Copy className="w-4 h-4" strokeWidth={1.8} />}
              onClick={copyToken}
              disabled={!tokenString}
            >
              {t('common.copy')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              icon={<Share2 className="w-4 h-4" strokeWidth={1.8} />}
              onClick={shareToken}
              disabled={!tokenString}
            >
              {t('send.tokenCreate.share')}
            </Button>
          </div>
        </div>
      )}

      <BottomActionBar extraBottom={16} gap="sm">
        {!isSpent && onCancelToken && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelBusy}
            className="w-full h-11 text-body text-foreground-muted hover:text-foreground transition-colors disabled:opacity-60"
          >
            {cancelBusy
              ? t('send.tokenCreate.reclaiming')
              : receiveFee !== null && receiveFee > 0
                ? t('send.tokenCreate.reclaimWithFee', { fee: formatSats(receiveFee) })
                : t('send.tokenCreate.reclaim')}
          </button>
        )}
        <Button variant="brand" size="xl" onClick={onClose} className="w-full">
          {t('common.confirm')}
        </Button>
      </BottomActionBar>
    </div>
  )
}
