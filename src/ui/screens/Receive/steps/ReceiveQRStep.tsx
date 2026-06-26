/**
 * ReceiveQRStep — Display protocol-selectable receive QR codes
 * Subscribes to BOTH Lightning + eCash payment detection simultaneously.
 * First detection wins; both subscriptions are cancelled.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Copy, Check, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { useAppStore } from '@/store'
import { hapticTap, hapticSuccess } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { usePaymentRequest } from '@/ui/hooks/use-payment-request'
import { Tabs, TabsList, TabsTrigger } from '@/ui/primitives/tabs'

type ReceiveQrProtocol = 'unified' | 'cashu' | 'lightning'

interface ProtocolOption {
  id: ReceiveQrProtocol
  label: string
  value: string
}


interface ReceiveQRStepProps {
  onBack: () => void
  onPaymentDetected: (amount: number, method: 'bolt11' | 'ecash', wasRequestFulfilled?: boolean) => void
  amount: number
  mintUrl: string
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
  /**
   * Process an incoming token that fulfills our ReceiveRequest.
   * Caller wires this to the domain use case (incomingPayment.processIncoming).
   * `paymentRef` is the requestId returned by the transport — used downstream
   * for ReceiveRequest matching and idempotency.
   */
  onReceiveRequestFulfilled?: (token: string, paymentRef: string) => Promise<{ amount: number; requestFulfilled?: boolean }>
}

export function ReceiveQRStep({
  onBack,
  onPaymentDetected,
  amount,
  mintUrl,
  invoice,
  quoteId,
  ecashRequest,
  ecashRequestId,
  httpEndpoint,
  expiresAt,
  onReceiveRequestFulfilled,
}: ReceiveQRStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const addToast = useAppStore((s) => s.addToast)
  const paymentReq = usePaymentRequest()
  const [copied, setCopied] = useState(false)

  const setPendingEcashRequestId = useAppStore((s) => s.setPendingEcashRequestId)

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

  useEffect(() => {
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
  }, [httpEndpoint, ecashRequestId, amount, mintUrl, expiresAt, onPaymentDetected, onReceiveRequestFulfilled, paymentReq])

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

      {/* Content — centered */}
      <div className="flex-1 flex flex-col items-center px-6 pt-6">
        {/* Message */}
        <p className="text-heading font-semibold text-center whitespace-pre-line break-keep break-words">
          {t('receive.qr.fullMessage', { amount: formatSats(amount) })}
        </p>
        {(() => { const f = formatFiat(amount); return f ? (
          <p className="text-body text-foreground-muted mt-2">{f}</p>
        ) : null })()}

        {protocolOptions.length > 1 && (
          <Tabs
            value={activeProtocol}
            onValueChange={(value) => setSelectedProtocol(value as ReceiveQrProtocol)}
            className="mt-5 w-full max-w-[360px]"
          >
            <TabsList className="h-11 w-full rounded-2xl bg-foreground/[0.04] p-1">
              {protocolOptions.map((option) => (
                <TabsTrigger
                  key={option.id}
                  value={option.id}
                  className="rounded-xl text-subtitle font-medium data-[state=active]:bg-background-card"
                >
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* QR Code */}
        {qrValue && (
          <div className="mt-6 cursor-pointer active:scale-95 transition-transform" onClick={handleCopy}>
            <QRCodeDisplay
              value={qrValue}
              size={200}
              className="rounded-2xl p-3 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
            />
          </div>
        )}

        {/* Action buttons — minimal text style */}
        <div className="flex gap-10 mt-6">
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 transition-all"
          >
            <Share2 className="w-5 h-5" />
            {t('receive.qr.share')}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 transition-all"
          >
            {copied ? <Check className="w-5 h-5 text-brand" /> : <Copy className="w-5 h-5" />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
      </div>
    </div>
  )
}
