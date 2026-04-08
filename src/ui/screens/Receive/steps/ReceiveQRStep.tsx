/**
 * ReceiveQRStep — Display unified BIP-321 QR code
 * Subscribes to BOTH Lightning + eCash payment detection simultaneously.
 * First detection wins; both subscriptions are cancelled.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, Check, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { useAppStore } from '@/store'
import { hapticTap, hapticSuccess } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { usePaymentRequest } from '@/hooks/use-payment-request'


interface ReceiveQRStepProps {
  onBack: () => void
  onPaymentDetected: (amount: number, method: 'lightning' | 'ecash') => void
  amount: number
  mintUrl: string
  // Lightning
  invoice: string | null
  quoteId: string | null
  // Ecash
  ecashRequest: string | null
  ecashRequestId: string | null
  httpEndpoint: string | null
  onReceiveP2PKToken?: (token: string, privkey: string) => Promise<{ amount: number }>
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
  onReceiveP2PKToken,
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

  // Build QR value: unified BIP-321 when both available, fallback otherwise
  const qrValue = (() => {
    if (invoice && ecashRequest) {
      return paymentReq.buildUnifiedBitcoinUri({
        lightningInvoice: invoice,
        cashuRequest: ecashRequest,
      })
    }
    if (invoice) return invoice.toUpperCase()
    if (ecashRequest) return ecashRequest
    return null
  })()

  // Text for copy/share (same as QR value)
  const shareText = qrValue

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
      onPaymentDetected(lastRedeemedQuoteAmount ?? amount, 'lightning')
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
    })

    httpPollerRef.current = poller

    poller.onPayment(async (payload) => {
      if (paymentDetectedRef.current) return
      paymentDetectedRef.current = true

      console.log(`[ReceiveQR] HTTP payment received for ${payload.requestId}`)

      try {
        const p2pkPrivkey = useAppStore.getState().nostrPrivkey
        if (p2pkPrivkey) {
          const result = onReceiveP2PKToken ? await onReceiveP2PKToken(payload.token, p2pkPrivkey) : { amount: 0 }
          hapticSuccess()
          onPaymentDetected(result.amount, 'ecash')
        } else {
          hapticSuccess()
          onPaymentDetected(amount, 'ecash')
        }
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
  }, [httpEndpoint, ecashRequestId, amount, mintUrl, onPaymentDetected, onReceiveP2PKToken, paymentReq])

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
        <p className="text-heading font-semibold text-center whitespace-pre-line">
          {t('receive.qr.fullMessage', { amount: formatSats(amount) })}
        </p>
        {(() => { const f = formatFiat(amount); return f ? (
          <p className="text-body text-foreground-muted mt-2">{f}</p>
        ) : null })()}

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
