/**
 * ReceiveQRStep — Display QR code for invoice/payment request
 * Subscribes to payment detection (Lightning: quote subscription, Ecash: GiftWrap listener)
 * Modern layout: bg-[#faf9f6], no borders
 */

import { useState, useCallback, useEffect } from 'react'
import { ArrowLeft, Copy, Check, Share2, Radio } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticTap, hapticSuccess } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
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

  // ======= Ecash NUT-18 payment detection =======
  const lastReceivedRequestId = useAppStore((s) => s.lastReceivedRequestId)
  const lastReceivedAmount = useAppStore((s) => s.lastReceivedAmount)
  const setLastReceivedPayment = useAppStore((s) => s.setLastReceivedPayment)

  useEffect(() => {
    if (method !== 'ecash' || !ecashRequestId || !lastReceivedRequestId) return

    if (lastReceivedRequestId === ecashRequestId) {
      hapticSuccess()
      onPaymentDetected(lastReceivedAmount)
      setLastReceivedPayment(null, 0)
    }
  }, [method, ecashRequestId, lastReceivedRequestId, lastReceivedAmount, setLastReceivedPayment, onPaymentDetected])

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
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header — no border */}
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{t('receive.qr.title')}</h1>
        <div className="w-11" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-5 gap-5">
        <p className="text-sm text-foreground-muted text-center">
          {t('receive.qr.showToSender')}
        </p>

        {/* Amount */}
        <p className="text-3xl font-bold">{formatSats(amount)}</p>
        {(() => { const f = formatFiat(amount); return f ? (
          <p className="text-sm text-foreground-muted -mt-2">≈ {f}</p>
        ) : null })()}

        {/* QR Code */}
        {qrValue && (
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <QRCodeSVG
              value={qrValue}
              size={200}
              level="M"
              includeMargin={false}
            />
          </div>
        )}

        {/* Listening indicator */}
        <div className="flex items-center gap-2 px-4 py-2 bg-accent-primary/10 rounded-full">
          <div className="animate-pulse">
            <Radio className="w-4 h-4 text-accent-primary" />
          </div>
          <span className="text-sm text-foreground-muted">
            {t('receive.qr.willNotify', { mint: mintName })}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 w-full max-w-xs">
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#f0f0f0] font-medium text-sm active:scale-95 transition-transform min-h-[44px]"
          >
            <Share2 className="w-4 h-4" />
            {t('receive.qr.share')}
          </button>
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#f0f0f0] font-medium text-sm active:scale-95 transition-transform min-h-[44px]"
          >
            {copied ? <Check className="w-4 h-4 text-accent-primary" /> : <Copy className="w-4 h-4" />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
      </div>

      {/* Bottom — Cancel, no border */}
      <div className="p-5 pb-safe">
        <button
          onClick={onBack}
          className="w-full text-center text-sm text-foreground-muted font-medium py-3 min-h-[44px]"
        >
          {t('receive.qr.cancel')}
        </button>
      </div>
    </div>
  )
}
