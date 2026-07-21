/**
 * DirectReceiptStep — the bearer token printed as a receipt with the QR on the
 * paper (the gift card you hand over). Creation is instant, so the receipt feeds
 * out fast (no printing crawl) and waits, unstamped, "awaiting pickup". The seal
 * lands only when useSendClaimed reports the recipient claimed it — same grammar
 * as a routed send's pending→settled stamp.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Share2 } from 'lucide-react'
import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { PaymentReceipt, type PaymentReceiptRow } from '@/ui/components/payment/PaymentReceipt'
import sendSuccessImg from '@/assets/send-success.png'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useOwnPaymentEvent } from '@/ui/hooks/use-own-payment-event'
import { useSendClaimed } from '@/ui/hooks/use-send-claimed'
import { useAppStore } from '@/store'
import { hapticSuccess } from '@/ui/utils/haptic'

export interface DirectReceiptStepProps {
  amount: number
  memo: string
  mintUrl: string
  /** Cashu token string produced by send (the QR payload). */
  tokenString: string
  /** Transaction id — drives claim detection + reclaim fee quote. */
  txId?: string
  onExit: () => void
  /** Reclaim the unclaimed token, then leave the flow. */
  onReclaim?: () => Promise<void> | void
  /** Live reclaim/receive fee quote; null if unavailable. */
  onQuoteReclaim?: (txId: string) => Promise<number | null>
}

export function DirectReceiptStep({
  amount,
  memo,
  mintUrl,
  tokenString,
  txId,
  onExit,
  onReclaim,
  onQuoteReclaim,
}: DirectReceiptStepProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const addToast = useAppStore((s) => s.addToast)
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)
  const mintName = getDisplayName(mintUrl)

  const [veiled, setVeiled] = useState(true)
  const [claimed, setClaimed] = useState(false)
  const [claimedAt, setClaimedAt] = useState<number | null>(null)
  const [reclaimBusy, setReclaimBusy] = useState(false)
  const [receiveFee, setReceiveFee] = useState<number | null>(null)
  const claimGuardRef = useRef(false)

  // Own this tx for full-screen UX — suppresses the global "used" toast so the
  // stamp is the only claim notification the sender sees.
  useOwnPaymentEvent(txId)

  // The seal lands when the recipient claims the token — no auto-dismiss; the
  // stamp itself is the notification and the sender leaves on their own tap.
  const handleClaimed = useCallback(() => {
    if (claimGuardRef.current) return
    claimGuardRef.current = true
    setClaimed(true)
    setClaimedAt(Date.now())
    hapticSuccess()
  }, [])
  useSendClaimed(txId, handleClaimed)

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
      await copyToken()
    } catch {
      /* user cancelled share sheet — silent */
    }
  }, [tokenString, copyToken])

  const handleReclaim = useCallback(async () => {
    if (reclaimBusy || !onReclaim || claimed) return
    setReclaimBusy(true)
    try {
      await onReclaim()
    } finally {
      setReclaimBusy(false)
    }
  }, [reclaimBusy, onReclaim, claimed])

  const rows = useMemo<PaymentReceiptRow[]>(() => {
    const r: PaymentReceiptRow[] = []
    if (memo) r.push({ label: t('send.confirm.memo'), value: memo })
    r.push({ label: t('send.confirm.sourceMint'), value: mintName, strong: true })
    return r
  }, [memo, mintName, t])

  const stampedAt = useMemo(
    () =>
      claimedAt
        ? new Date(claimedAt).toLocaleString(i18n.language, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
    [claimedAt, i18n.language],
  )

  const reclaimLabel = reclaimBusy
    ? t('send.tokenCreate.reclaiming')
    : receiveFee !== null && receiveFee > 0
      ? t('send.tokenCreate.reclaimWithFee', { fee: formatSats(receiveFee) })
      : t('send.tokenCreate.reclaim')

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Scrollable so short viewports don't clip the actions below (the app
          shell is fixed-height); my-auto keeps the receipt centered when there
          is room, with stable geometry (the bottom bars keep their footprint). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
        <div className="my-auto flex w-full shrink-0 flex-col items-center py-4">
          <PaymentReceipt
            status={claimed ? 'done' : 'finishing'}
            title={t('send.receipt.title')}
            amount={formatSats(amount)}
            fiat={formatFiat(amount) || null}
            rows={rows}
            qr={tokenString ? <QRCodeDisplay value={tokenString} level="M" fill /> : undefined}
            qrVeiled={veiled}
            onToggleQr={() => setVeiled((v) => !v)}
            qrRevealLabel={t('send.tokenCreate.tapToReveal')}
            statusLine={claimed ? undefined : t('send.direct.awaitingClaim')}
            doneLine={claimed ? { left: stampedAt, right: t('send.direct.claimed') } : undefined}
            stampSrc={claimed ? sendSuccessImg : undefined}
          />
        </div>
      </div>

      {/* Copy/share and reclaim keep their layout footprint after the claim
          (hidden, not removed) so the receipt above stays put instead of
          dropping as the four pre-claim actions collapse to one confirm. */}
      <div
        className={`flex items-center gap-3 px-6 ${claimed ? 'invisible' : ''}`}
        aria-hidden={claimed}
      >
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          icon={<Copy className="h-4 w-4" strokeWidth={1.8} />}
          onClick={copyToken}
          disabled={claimed || !tokenString}
        >
          {t('common.copy')}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          icon={<Share2 className="h-4 w-4" strokeWidth={1.8} />}
          onClick={shareToken}
          disabled={claimed || !tokenString}
        >
          {t('send.tokenCreate.share')}
        </Button>
      </div>
      <BottomActionBar gap="sm">
        {onReclaim && (
          <button
            type="button"
            onClick={handleReclaim}
            disabled={reclaimBusy || claimed}
            aria-hidden={claimed}
            className={`h-11 w-full text-body text-foreground-muted transition-colors hover:text-foreground disabled:opacity-60 ${claimed ? 'invisible' : ''}`}
          >
            {reclaimLabel}
          </button>
        )}
        <Button variant="brand" size="xl" onClick={onExit} className="w-full">
          {t('common.confirm')}
        </Button>
      </BottomActionBar>
    </div>
  )
}
