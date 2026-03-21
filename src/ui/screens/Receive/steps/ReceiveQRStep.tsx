/**
 * ReceiveQRStep — Display QR code for invoice/payment request
 * Subscribes to payment detection (Lightning: quote subscription, Ecash: GiftWrap listener + HTTP polling)
 * Modern layout: bg-background, no borders
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, Copy, Check, Share2, Radio, Wifi, Globe } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticTap, hapticSuccess } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { startNut18HttpPoller } from '@/services/cashu/nut18-http'
import { receiveP2PKToken } from '@/coco'
import type { ReceiveMethod } from '../ReceiveFlow'

interface ReceiveQRStepProps {
  onBack: () => void
  onPaymentDetected: (amount: number) => void
  method: ReceiveMethod
  amount: number
  mintUrl: string
  // Lightning
  invoice: string | null
  quoteId: string | null
  // Ecash
  ecashRequest: string | null
  ecashRequestId: string | null
  httpEndpoint: string | null
  // Lightning subscription
  onSubscribeToQuote: (
    mintUrl: string,
    quoteId: string,
    amount: number,
    onPaid: () => void,
    onError?: (error: Error) => void
  ) => Promise<(() => void) | null>
}

export function ReceiveQRStep({
  onBack,
  onPaymentDetected,
  method,
  amount,
  mintUrl,
  invoice,
  quoteId,
  ecashRequest,
  ecashRequestId,
  httpEndpoint,
  onSubscribeToQuote,
}: ReceiveQRStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const { getDisplayName } = useMintMetadata(settings.mints)
  const [copied, setCopied] = useState(false)

  const mintName = getDisplayName(mintUrl)
  const qrValue = method === 'lightning' ? invoice?.toUpperCase() : ecashRequest

  // Nostr connection status from store
  const nostrConnectionStatus = useAppStore((s) => s.nostrConnectionStatus)

  // ======= Lightning payment subscription =======
  const [resubTrigger, setResubTrigger] = useState(0)

  // Re-subscribe on visibility change (app returning from background)
  useEffect(() => {
    if (method !== 'lightning' || !quoteId) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setResubTrigger((v) => v + 1)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [method, quoteId])

  // Subscribe to quote for Lightning
  useEffect(() => {
    if (method !== 'lightning' || !quoteId) return

    let cancelled = false
    let unsubscribe: (() => void) | null = null

    const handlePaid = () => {
      if (cancelled) return
      cancelled = true
      hapticSuccess()
      onPaymentDetected(amount)
    }

    const setup = async () => {
      try {
        const canceller = await onSubscribeToQuote(
          mintUrl,
          quoteId,
          amount,
          handlePaid,
        )
        if (cancelled) {
          canceller?.()
          return
        }
        if (canceller) unsubscribe = canceller
      } catch (err) {
        console.warn('[ReceiveQR] Subscription setup failed:', err)
      }
    }

    setup()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [method, quoteId, amount, mintUrl, onSubscribeToQuote, onPaymentDetected, resubTrigger])

  // ======= Ecash NUT-18 payment detection (Nostr) =======
  const lastReceivedRequestId = useAppStore((s) => s.lastReceivedRequestId)
  const lastReceivedAmount = useAppStore((s) => s.lastReceivedAmount)
  const setLastReceivedPayment = useAppStore((s) => s.setLastReceivedPayment)
  const paymentDetectedRef = useRef(false)

  useEffect(() => {
    if (method !== 'ecash' || !ecashRequestId || !lastReceivedRequestId) return
    if (paymentDetectedRef.current) return

    if (lastReceivedRequestId === ecashRequestId) {
      paymentDetectedRef.current = true
      hapticSuccess()
      onPaymentDetected(lastReceivedAmount)
      setLastReceivedPayment(null, 0)
    }
  }, [method, ecashRequestId, lastReceivedRequestId, lastReceivedAmount, setLastReceivedPayment, onPaymentDetected])

  // ======= Ecash NUT-18 HTTP polling (fallback) =======
  const httpPollerRef = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    if (method !== 'ecash' || !httpEndpoint || !ecashRequestId) return

    const poller = startNut18HttpPoller({
      endpoint: httpEndpoint,
      requestId: ecashRequestId,
    })

    httpPollerRef.current = poller

    poller.onPayment(async (payload) => {
      if (paymentDetectedRef.current) return
      paymentDetectedRef.current = true

      console.log(`[ReceiveQR] HTTP payment received for ${payload.requestId}`)

      try {
        // Process the token via P2PK receive
        const p2pkPrivkey = useAppStore.getState().nostrPrivkey
        if (p2pkPrivkey) {
          const result = await receiveP2PKToken(payload.token, p2pkPrivkey)
          hapticSuccess()
          onPaymentDetected(result.amount)
        } else {
          // Fallback: try to detect amount from token
          hapticSuccess()
          onPaymentDetected(amount)
        }
      } catch (error) {
        console.error('[ReceiveQR] HTTP token processing error:', error)
        // Still notify with requested amount on error
        hapticSuccess()
        onPaymentDetected(amount)
      }
    })

    poller.onError((error) => {
      console.warn('[ReceiveQR] HTTP poll error:', error.message)
    })

    return () => {
      poller.cancel()
      httpPollerRef.current = null
    }
  }, [method, httpEndpoint, ecashRequestId, amount, onPaymentDetected])

  // Cancel HTTP poller when payment detected via Nostr
  useEffect(() => {
    if (paymentDetectedRef.current && httpPollerRef.current) {
      httpPollerRef.current.cancel()
      httpPollerRef.current = null
    }
  }, [lastReceivedRequestId])

  // ======= Transport status =======
  const getTransportStatus = () => {
    if (method !== 'ecash') return null

    const hasNostr = nostrConnectionStatus === 'connected'
    const hasHttp = !!httpEndpoint

    if (hasNostr && hasHttp) return 'nostr-and-http'
    if (hasHttp && !hasNostr) return 'http-only'
    if (hasNostr && !hasHttp) return 'nostr-only'
    return 'nostr-only' // connecting state
  }

  const transportStatus = getTransportStatus()

  // ======= Actions =======

  const handleCopy = useCallback(async () => {
    const text = method === 'lightning' ? invoice : ecashRequest
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      hapticTap()
      addToast({ type: 'success', message: t('common.copied'), duration: 2000 })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError'), duration: 3000 })
    }
  }, [method, invoice, ecashRequest, addToast, t])

  const handleShare = useCallback(async () => {
    const text = method === 'lightning' ? invoice : ecashRequest
    if (!text) return
    hapticTap()
    try {
      if (navigator.share) {
        await navigator.share({ text })
      } else {
        await handleCopy()
      }
    } catch {
      // User cancelled share
    }
  }, [method, invoice, ecashRequest, handleCopy])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — no border */}
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-subtitle">{t('receive.qr.title')}</h1>
        <div className="w-11" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-5 gap-5">
        <p className="text-caption text-foreground-muted text-center">
          {t('receive.qr.showToSender')}
        </p>

        {/* Amount */}
        <p className="text-display font-display">{formatSats(amount)}</p>
        {(() => { const f = formatFiat(amount); return f ? (
          <p className="text-caption text-foreground-muted -mt-2">≈ {f}</p>
        ) : null })()}

        {/* QR Code */}
        {qrValue && (
          <div className="bg-background-card p-3 rounded-xl shadow-sm">
            <QRCodeSVG
              value={qrValue}
              size={200}
              level="M"
              includeMargin={false}
            />
          </div>
        )}

        {/* Transport status indicator */}
        {method === 'ecash' && transportStatus ? (
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2 px-4 py-2 bg-accent-primary/10 rounded-full">
              <div className="animate-pulse">
                <Radio className="w-4 h-4 text-accent-primary" />
              </div>
              <span className="text-caption text-foreground-muted">
                {t('receive.qr.willNotify', { mint: mintName })}
              </span>
            </div>
            {/* Transport detail badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted">
              {transportStatus === 'nostr-and-http' && (
                <>
                  <Wifi className="w-3 h-3 text-green-600" />
                  <Globe className="w-3 h-3 text-blue-500" />
                  <span className="text-label text-foreground-muted">{t('receive.transport.nostrAndHttp')}</span>
                </>
              )}
              {transportStatus === 'http-only' && (
                <>
                  <Globe className="w-3 h-3 text-blue-500" />
                  <span className="text-label text-amber-600">{t('receive.transport.httpOnly')}</span>
                </>
              )}
              {transportStatus === 'nostr-only' && (
                <>
                  <Wifi className="w-3 h-3 text-green-600" />
                  <span className="text-label text-foreground-muted">{t('receive.transport.nostrOnly')}</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2 bg-accent-primary/10 rounded-full">
            <div className="animate-pulse">
              <Radio className="w-4 h-4 text-accent-primary" />
            </div>
            <span className="text-caption text-foreground-muted">
              {t('receive.qr.willNotify', { mint: mintName })}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 w-full max-w-xs">
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted font-medium text-caption active:scale-95 transition-transform min-h-[44px]"
          >
            <Share2 className="w-4 h-4" />
            {t('receive.qr.share')}
          </button>
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted font-medium text-caption active:scale-95 transition-transform min-h-[44px]"
          >
            {copied ? <Check className="w-4 h-4 text-accent-primary" /> : <Copy className="w-4 h-4" />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
      </div>

      {/* Bottom — Cancel, no border */}
      <div className="p-4 pb-safe">
        <button
          onClick={onBack}
          className="w-full text-center text-label text-foreground-muted font-medium py-3.5 min-h-[44px]"
        >
          {t('receive.qr.cancel')}
        </button>
      </div>
    </div>
  )
}
