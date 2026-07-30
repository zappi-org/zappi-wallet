/**
 * DirectReceiptStep — the bearer token printed as a receipt with the QR on the
 * paper (the gift card you hand over). Creation is instant, so the receipt feeds
 * out fast (no printing crawl) and waits, unstamped, "awaiting pickup". The seal
 * lands only when useSendClaimed reports the recipient claimed it — same grammar
 * as a routed send's pending→settled stamp.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Share2 } from 'lucide-react'
import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { PaymentReceipt, type PaymentReceiptRow } from '@/ui/components/payment/PaymentReceipt'
import sendSuccessImg from '@/assets/send-success.png'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useCopyFeedback } from '@/ui/hooks/use-copy-feedback'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useOwnPaymentEvent } from '@/ui/hooks/use-own-payment-event'
import { useSendClaimed } from '@/ui/hooks/use-send-claimed'
import { hapticSuccess } from '@/ui/utils/haptic'

/** Minimal action pair, shared verbatim with ReceiveRequestStep. */
const ACTION_CLASS =
  'flex min-h-11 items-center gap-1.5 rounded-lg px-3 -mx-3 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

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
  const { isCopied, isShared, copy, share } = useCopyFeedback()
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

  const copyToken = useCallback(() => copy(tokenString), [tokenString, copy])
  const shareToken = useCallback(() => share(tokenString), [tokenString, share])

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
            title={claimed ? t('send.receipt.title') : t('send.receipt.pendingTitle')}
            amount={formatSats(amount)}
            fiat={formatFiat(amount) || null}
            rows={rows}
            qr={tokenString ? <QRCodeDisplay value={tokenString} level="M" fill /> : undefined}
            qrVeiled={veiled}
            onToggleQr={() => setVeiled((v) => !v)}
            qrRevealLabel={t('send.tokenCreate.tapToReveal')}
            statusLine={claimed ? undefined : t('send.direct.awaitingClaim')}
            doneLine={claimed ? stampedAt : undefined}
            stampSrc={claimed ? sendSuccessImg : undefined}
            stampLabel={t('send.direct.claimed')}
          />
        </div>
      </div>

      {/* Copy/share and reclaim keep their layout footprint after the claim
          (hidden, not removed) so the receipt above stays put instead of
          dropping as the four pre-claim actions collapse to one confirm. */}
      {/* Same minimal pair as the receive request screen — one copy/share
          language across both flows. Copy left, share right. */}
      <div
        className={`flex items-center justify-center gap-10 px-6 pb-5 ${claimed ? 'invisible' : ''}`}
        aria-hidden={claimed}
      >
        <button
          type="button"
          onClick={copyToken}
          disabled={claimed || !tokenString}
          className={ACTION_CLASS}
        >
          {isCopied() ? <Check className="h-5 w-5 text-brand" /> : <Copy className="h-5 w-5" />}
          {isCopied() ? t('common.copied') : t('common.copy')}
        </button>
        <button
          type="button"
          onClick={shareToken}
          disabled={claimed || !tokenString}
          className={ACTION_CLASS}
        >
          {isShared() ? <Check className="h-5 w-5 text-brand" /> : <Share2 className="h-5 w-5" />}
          {t('send.tokenCreate.share')}
        </button>
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
          {t('receive.request.exit')}
        </Button>
      </BottomActionBar>
    </div>
  )
}
