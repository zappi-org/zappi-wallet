/**
 * ReceiveRequestStep — request-QR screen: unified/cashu/lightning QR hero,
 * protocol tabs, a summary card, and payment detection across all three
 * transports. Detection effects (Lightning quote settlement, Nostr NUT-18,
 * HTTP poll fallback) are ported verbatim from ReceiveQRStep — battle-tested,
 * do not rewrite. First detection across all three wins; the rest are cancelled.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Copy, Check, Share2, SquarePen, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { DirectionalTabPanel } from '@/ui/components/common/DirectionalTabPanel'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { useAppStore } from '@/store'
import { hapticTap, hapticSuccess } from '@/ui/utils/haptic'
import { useFormatSats } from '@/utils/format'
import { usePaymentRequest } from '@/ui/hooks/use-payment-request'
import { SegmentControl } from '@/ui/components/common/SegmentControl'

type ReceiveQrProtocol = 'unified' | 'cashu' | 'lightning'

interface ProtocolOption {
  id: ReceiveQrProtocol
  label: string
  value: string
}

export interface ReceiveRequestStepProps {
  onBack: () => void
  onEdit: () => void
  onRegenerate: () => void
  isRegenerating?: boolean
  amount: number
  mintUrl: string
  mintDisplayName: string
  mintIconUrl?: string | null
  memo: string
  // Lightning
  invoice: string | null
  quoteId: string | null
  // Ecash
  ecashRequest: string | null
  ecashRequestId: string | null
  httpEndpoint: string | null
  /**
   * Absolute deadline (epoch ms) for the underlying payment request.
   * Forwarded to the HTTP poller so it self-stops at expiry instead of
   * continuing to hit the mint until the 30-min max-duration timeout fires.
   */
  expiresAt?: number | null
  onPaymentDetected: (amount: number, method: 'bolt11' | 'ecash', wasRequestFulfilled?: boolean) => void
  /**
   * Process an incoming token that fulfills our ReceiveRequest.
   * Caller wires this to the domain use case (incomingPayment.processIncoming).
   * `paymentRef` is the requestId returned by the transport — used downstream
   * for ReceiveRequest matching and idempotency.
   */
  onReceiveRequestFulfilled?: (token: string, paymentRef: string) => Promise<{ amount: number; requestFulfilled?: boolean }>
}

// Waiting animation — a dotted flow toward the mint, the receive mirror of
// the send receipt's "in transit" language.
function FlowArrow() {
  const reduceMotion = useReducedMotion()
  return (
    <span className="flex flex-1 items-center justify-center gap-1" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="h-1 w-1 rounded-full bg-foreground-muted"
          animate={reduceMotion ? { opacity: 0.6 } : { opacity: [0.15, 0.9, 0.15] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 1.4, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
      <span className="ml-0.5 text-foreground-muted">→</span>
    </span>
  )
}

// Owns the 1s tick so the parent (QR hero + detection effects) doesn't
// re-render every second; self-gates to the final minute like the old inline line.
function ExpiryCountdown({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const remainingMs = expiresAt - now
  if (remainingMs >= 60_000) return null
  return (
    <p className="mt-3 text-caption text-foreground-muted">
      {t('receive.request.expiresIn', { seconds: Math.max(0, Math.ceil(remainingMs / 1000)) })}
    </p>
  )
}

export function ReceiveRequestStep({
  onBack,
  onEdit,
  onRegenerate,
  isRegenerating = false,
  amount,
  mintUrl,
  mintDisplayName,
  mintIconUrl,
  memo,
  invoice,
  quoteId,
  ecashRequest,
  ecashRequestId,
  httpEndpoint,
  expiresAt,
  onPaymentDetected,
  onReceiveRequestFulfilled,
}: ReceiveRequestStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((s) => s.addToast)
  const paymentReq = usePaymentRequest()
  const [copied, setCopied] = useState(false)

  const setPendingEcashRequestId = useAppStore((s) => s.setPendingEcashRequestId)

  // Expiry is a single deadline crossing, not a ticking clock: one setTimeout
  // armed at expiresAt keeps the per-second re-render (and the QR + detection
  // effects with it) out of this component. The visible countdown line ticks
  // inside ExpiryCountdown instead. State stores WHICH deadline passed, so a
  // regenerated expiresAt reads as not-expired without any reset logic.
  const [passedDeadline, setPassedDeadline] = useState<number | null>(() =>
    expiresAt != null && expiresAt - Date.now() <= 0 ? expiresAt : null,
  )
  useEffect(() => {
    if (expiresAt == null) return
    const id = setTimeout(() => setPassedDeadline(expiresAt), Math.max(0, expiresAt - Date.now()))
    return () => clearTimeout(id)
  }, [expiresAt])
  const expired = expiresAt != null && passedDeadline === expiresAt

  // Register/unregister pending ecash request ID for GiftWrapListener matching
  useEffect(() => {
    if (ecashRequestId) {
      setPendingEcashRequestId(ecashRequestId)
    }
    return () => {
      setPendingEcashRequestId(null)
    }
  }, [ecashRequestId, setPendingEcashRequestId])

  // Shared payment detection guard — first detection wins
  const paymentDetectedRef = useRef(false)

  const protocolOptions = useMemo<ProtocolOption[]>(() => {
    const options: ProtocolOption[] = []

    if (invoice && ecashRequest) {
      options.push({
        id: 'unified',
        label: t('receive.qr.protocols.unified'),
        value: paymentReq.buildUnifiedBitcoinUri({
          lightningInvoice: invoice,
          cashuRequest: ecashRequest,
        }),
      })
    }

    if (ecashRequest) {
      options.push({
        id: 'cashu',
        label: t('receive.qr.protocols.cashu'),
        value: ecashRequest,
      })
    }

    if (invoice) {
      options.push({
        id: 'lightning',
        label: t('receive.qr.protocols.lightning'),
        value: invoice.toUpperCase(),
      })
    }

    return options
  }, [ecashRequest, invoice, paymentReq, t])

  const [selectedProtocol, setSelectedProtocol] = useState<ReceiveQrProtocol>('unified')
  const activeProtocol = protocolOptions.some((option) => option.id === selectedProtocol)
    ? selectedProtocol
    : protocolOptions[0]?.id ?? 'unified'
  const selectedOption = protocolOptions.find((option) => option.id === activeProtocol) ?? protocolOptions[0] ?? null
  const qrValue = selectedOption?.value ?? null
  const shareText = selectedOption?.value ?? null

  // ======= Lightning payment detection (via Coco MintQuoteWatcher → store) =======
  const lastRedeemedQuoteId = useAppStore((s) => s.lastRedeemedQuoteId)
  const lastRedeemedQuoteAmount = useAppStore((s) => s.lastRedeemedQuoteAmount)
  const setLastRedeemedQuote = useAppStore((s) => s.setLastRedeemedQuote)

  // No expiry gate: this is an exact quote-ID match, so it can't false-fire.
  // A payment settling seconds after the countdown hits zero must still surface.
  useEffect(() => {
    if (!quoteId || !lastRedeemedQuoteId) return
    if (paymentDetectedRef.current) return

    if (lastRedeemedQuoteId === quoteId) {
      paymentDetectedRef.current = true
      setLastRedeemedQuote(null, 0)
      hapticSuccess()
      onPaymentDetected(lastRedeemedQuoteAmount ?? amount, 'bolt11')
    }
  }, [quoteId, lastRedeemedQuoteId, lastRedeemedQuoteAmount, setLastRedeemedQuote, amount, onPaymentDetected, ecashRequestId])

  // ======= Ecash NUT-18 payment detection (Nostr) =======
  const lastReceivedRequestId = useAppStore((s) => s.lastReceivedRequestId)
  const lastReceivedAmount = useAppStore((s) => s.lastReceivedAmount)
  const setLastReceivedPayment = useAppStore((s) => s.setLastReceivedPayment)

  // No expiry gate: exact request-ID match, so a settlement just past the
  // countdown must still surface instead of being silently dropped.
  useEffect(() => {
    if (!ecashRequestId || !lastReceivedRequestId) return
    if (paymentDetectedRef.current) return

    if (lastReceivedRequestId === ecashRequestId) {
      paymentDetectedRef.current = true
      hapticSuccess()
      onPaymentDetected(lastReceivedAmount, 'ecash')
      setLastReceivedPayment(null, 0)
    }
  }, [ecashRequestId, lastReceivedRequestId, lastReceivedAmount, setLastReceivedPayment, onPaymentDetected])

  // ======= Ecash NUT-18 HTTP polling (fallback) =======
  const httpPollerRef = useRef<{ stop: () => void } | null>(null)

  // Keep the expiry gate here: the poller keeps hitting the mint, so once the
  // request has expired we stop it rather than let it run to the max-duration.
  useEffect(() => {
    if (expired) return
    if (!httpEndpoint || !ecashRequestId) return

    const poller = paymentReq.startHttpPoller({
      endpoint: httpEndpoint,
      requestId: ecashRequestId,
      expiresAt: expiresAt ?? undefined,
    })

    httpPollerRef.current = poller

    poller.onPayment(async (payload) => {
      if (paymentDetectedRef.current) return
      paymentDetectedRef.current = true

      console.log(`[ReceiveQR] HTTP payment received for ${payload.requestId}`)

      try {
        const result = onReceiveRequestFulfilled
          ? await onReceiveRequestFulfilled(payload.token, payload.requestId)
          : { amount: 0, requestFulfilled: false }
        hapticSuccess()
        onPaymentDetected(result.amount, 'ecash', result.requestFulfilled)
      } catch (error) {
        console.error('[ReceiveQR] HTTP token processing error:', error)
        hapticSuccess()
        onPaymentDetected(amount, 'ecash')
      }
    })

    poller.onError((error) => {
      console.warn('[ReceiveQR] HTTP poll error:', error.message)
    })

    return () => {
      poller.stop()
      httpPollerRef.current = null
    }
  }, [expired, httpEndpoint, ecashRequestId, amount, mintUrl, expiresAt, onPaymentDetected, onReceiveRequestFulfilled, paymentReq])

  // Cancel HTTP poller when payment detected via Nostr
  useEffect(() => {
    if (paymentDetectedRef.current && httpPollerRef.current) {
      httpPollerRef.current.stop()
      httpPollerRef.current = null
    }
  }, [lastReceivedRequestId])

  // ======= Actions =======

  const handleCopy = useCallback(async () => {
    if (!shareText) return
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      hapticTap()
      addToast({ type: 'success', message: t('common.copied'), duration: 2000 })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError'), duration: 3000 })
    }
  }, [shareText, addToast, t])

  const handleShare = useCallback(async () => {
    if (!shareText) return
    hapticTap()
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText })
      } else {
        await handleCopy()
      }
    } catch {
      // User cancelled share
    }
  }, [shareText, handleCopy])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('receive.qr.title')} onBack={onBack} />

      {/* Center the QR + tabs + summary + actions as one block so leftover
          height splits evenly top/bottom, instead of pooling into a flat band
          below the actions that read as a distinct empty area (siblings like
          the receipt step center their content the same way). Centering via an
          inner my-auto (not justify-center) so overflow on short viewports
          scrolls instead of clipping the top of the block. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-6">
        <div className="my-auto flex w-full shrink-0 flex-col items-center py-6">
        {/* QR Code — stays the first paint. Only this subtree swaps per protocol;
            detection effects and the summary card live outside the animation. */}
        {qrValue && (
          <DirectionalTabPanel
            tabKey={activeProtocol}
            tabIndex={protocolOptions.findIndex((option) => option.id === activeProtocol)}
          >
            <button
              type="button"
              aria-label={t('common.copy')}
              onClick={handleCopy}
              className={`mt-4 cursor-pointer active:scale-95 motion-reduce:active:scale-100 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl ${expired ? 'blur-sm opacity-40 pointer-events-none' : ''}`}
            >
              <QRCodeDisplay
                value={qrValue}
                size={200}
                className="rounded-2xl p-3 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
              />
            </button>
          </DirectionalTabPanel>
        )}

        {/* Protocol tabs below the QR */}
        {protocolOptions.length > 1 && (
          <SegmentControl
            value={activeProtocol}
            onChange={setSelectedProtocol}
            options={protocolOptions.map((option) => ({ value: option.id, label: option.label }))}
            className="mt-5 w-full max-w-[360px]"
          />
        )}

        {/* Summary card */}
        <div className="mt-6 w-full max-w-[360px] rounded-2xl bg-background-card p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between">
            <span className="text-caption text-foreground-muted">{t('receive.request.summary')}</span>
            <button
              type="button"
              onClick={() => { hapticTap(); onEdit() }}
              aria-label={t('common.edit')}
              className="text-foreground-muted active:text-foreground"
            >
              <SquarePen className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-title-sm font-bold">{formatSats(amount)}</span>
            <FlowArrow />
            <span className="flex items-center gap-1.5 text-body font-medium">
              <MintIcon iconUrl={mintIconUrl ?? undefined} imgSize="w-5 h-5" className="w-5 h-5" circle />
              {mintDisplayName}
            </span>
          </div>
          {memo && (
            <div className="mt-2 flex items-center gap-1.5 text-caption text-foreground-muted">
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="truncate">{memo}</span>
            </div>
          )}
        </div>

        {expired ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <p className="text-body text-foreground-muted">{t('receive.request.expired')}</p>
            <Button variant="brand" size="lg" loading={isRegenerating} onClick={() => { hapticTap(); onRegenerate() }}>
              {t('receive.request.regenerate')}
            </Button>
          </div>
        ) : (
          <>
            {/* Action buttons — minimal text style */}
            <div className="flex gap-10 mt-6">
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all"
              >
                <Share2 className="w-5 h-5" />
                {t('receive.qr.share')}
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all"
              >
                {copied ? <Check className="w-5 h-5 text-brand" /> : <Copy className="w-5 h-5" />}
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>

            {expiresAt != null && <ExpiryCountdown expiresAt={expiresAt} />}
          </>
        )}
        </div>
      </div>
    </div>
  )
}
