import { useState, useCallback, useEffect, useMemo } from 'react'
import { ArrowLeft, Copy, Check, Clock, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFormatSats, useFormatFiat, getLocaleCode } from '@/utils/format'
import { useMintMetadata } from '@/hooks'
import { useAppStore } from '@/store'
import type { PendingItem } from '@/hooks/usePendingItems'

export interface PendingItemDetailScreenProps {
  item: PendingItem
  onBack: () => void
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

export function PendingItemDetailScreen({ item, onBack }: PendingItemDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const toFiat = useFormatFiat()
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const mintUrls = useMemo(() => [item.mintUrl], [item.mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)

  // Fetch invoice for receive-request
  useEffect(() => {
    if (item.type !== 'receive-request') {
      setInvoice(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { getMintQuote } = await import('@/coco/manager')
        const quote = await getMintQuote(item.mintUrl, item.id)
        if (!cancelled && quote?.request) {
          setInvoice(quote.request)
        }
      } catch {
        // Quote may have expired
      }
    })()
    return () => { cancelled = true }
  }, [item.type, item.mintUrl, item.id])

  const handleCopy = useCallback(async (text: string, field: string) => {
    await copyToClipboard(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  // === Action handlers ===

  const handleRedeem = useCallback(async () => {
    if (!item.token) return
    setIsProcessing(true)
    try {
      const { PaymentService } = await import('@/services/payment/payment.service')
      const service = new PaymentService()
      const result = await service.receiveEcash(item.token)
      if (result.isOk()) {
        const { getDatabase } = await import('@/data/database/schema')
        await getDatabase().pendingReceivedTokens.delete(item.id)
        addToast({ type: 'success', message: t('pending.redeemSuccess'), duration: 2000 })
        onBack()
      } else {
        addToast({ type: 'error', message: t('pending.redeemFailed'), duration: 2000 })
      }
    } catch {
      addToast({ type: 'error', message: t('pending.redeemFailed'), duration: 2000 })
    } finally {
      setIsProcessing(false)
    }
  }, [item.token, item.id, onBack, addToast, t])

  const handleReclaim = useCallback(async () => {
    if (!item.operationId && !item.token) return
    setIsProcessing(true)
    const { getDatabase } = await import('@/data/database/schema')
    const db = getDatabase()
    try {
      if (item.operationId) {
        const { rollbackSendToken } = await import('@/coco/cashuService')
        await rollbackSendToken(item.operationId)
      } else if (item.token) {
        const { receiveToken } = await import('@/coco/cashuService')
        await receiveToken(item.token)
      }
      const { markSendReclaimed } = await import('@/coco/sendTokenObserver')
      await markSendReclaimed(item.id)
      await db.pendingSendTokens.delete(item.id)
      addToast({ type: 'success', message: t('txDetail.reclaimSuccess'), duration: 2000 })
      onBack()
    } catch (err) {
      const msg = String(err).toLowerCase()
      if (msg.includes('spent') || msg.includes('finalized')) {
        const { markSendFinalized } = await import('@/coco/sendTokenObserver')
        await markSendFinalized(item.id)
        await db.pendingSendTokens.delete(item.id)
        addToast({ type: 'info', message: t('txDetail.alreadySpent'), duration: 2000 })
        onBack()
      } else {
        addToast({ type: 'error', message: t('txDetail.reclaimFailed'), duration: 2000 })
      }
    } finally {
      setIsProcessing(false)
    }
  }, [item.operationId, item.token, item.id, onBack, addToast, t])

  const locale = getLocaleCode(i18n.language)

  const title = item.type === 'unclaimed-token'
    ? t('mintDetail.ecashToken')
    : item.type === 'receive-request'
      ? t('mintDetail.receiveRequest')
      : t('mintDetail.sentToken')

  const isReceive = item.type !== 'sent-token'

  const fiatStr = toFiat(item.amount)

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(locale, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  const expiryRemaining = item.expiresAt
    ? (() => {
      const remaining = item.expiresAt! - Date.now()
      if (remaining <= 0) return t('mintDetail.pendingExpired')
      const hours = Math.floor(remaining / (1000 * 60 * 60))
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
      return hours > 0
        ? t('mintDetail.expiresIn', { time: `${hours}h ${minutes}m` })
        : t('mintDetail.expiresIn', { time: `${minutes}m` })
    })()
    : null

  function truncateStr(s: string, max = 36) {
    return s.length > max ? `${s.slice(0, 16)}...${s.slice(-16)}` : s
  }

  function InfoRow({ label, value, copyable, field }: {
    label: string
    value: string
    copyable?: boolean
    field?: string
  }) {
    return (
      <button
        onClick={copyable && field ? () => handleCopy(value, field) : undefined}
        className={`flex items-center justify-between w-full py-3 border-b border-border/30 last:border-b-0 ${
          copyable ? 'active:bg-black/[0.02] transition-colors' : ''
        }`}
        disabled={!copyable}
      >
        <span className="text-body text-foreground-muted">{label}</span>
        <span className="text-body font-medium text-foreground text-right max-w-[60%] truncate flex items-center gap-1.5">
          {copyable ? truncateStr(value) : value}
          {copyable && copiedField === field && (
            <Check className="w-3.5 h-3.5 text-card-brand-dark shrink-0" />
          )}
        </span>
      </button>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-background pt-safe pb-safe">
      {/* Header */}
      <header className="flex items-center px-4 h-14 shrink-0">
        <button
          onClick={onBack}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-black/[0.04] active:bg-black/[0.06] transition-colors"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Hero: Amount + Context */}
        <div className="flex flex-col items-center px-6 pt-6 pb-8">
          <span className={`text-display font-display tracking-tight leading-tight ${
            isReceive ? 'text-card-brand-dark' : 'text-foreground'
          }`}>
            {isReceive ? '+' : '-'}{formatSats(item.amount)}
          </span>

          {fiatStr && (
            <span className="text-body text-foreground-muted mt-1">{fiatStr}</span>
          )}

          <span className="text-body text-foreground-muted mt-3">
            {title}
          </span>

          {/* Time + Status */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-body text-foreground-muted">
              {formatDate(item.createdAt)}
            </span>
            <span className="text-body text-foreground-muted">·</span>
            <span className="text-caption font-medium text-badge-lightning-text flex items-center gap-1">
              <Clock size={12} />
              {t('history.pending')}
            </span>
          </div>
        </div>

        {/* Info Section */}
        <div className="px-5">
          <p className="text-label text-foreground-muted uppercase tracking-wider mb-1">
            {t('txDetail.txInfo')}
          </p>
          <div className="bg-background-card rounded px-4">
            <InfoRow label={t('txDetail.type')} value={title} />
            <InfoRow label={t('txDetail.mint')} value={getDisplayName(item.mintUrl)} />
            {item.memo && <InfoRow label={t('txDetail.memo')} value={item.memo} />}

            {expiryRemaining && (
              <div className="flex items-center justify-between py-3 border-b border-border/30 last:border-b-0">
                <span className="text-body text-foreground-muted">{t('mintDetail.pendingExpiry')}</span>
                <span className="text-body font-medium text-accent-danger">{expiryRemaining}</span>
              </div>
            )}

            {/* Item ID */}
            <div className="py-3 border-b border-border/30 last:border-b-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-body text-foreground-muted">ID</span>
                <button
                  onClick={() => handleCopy(item.id, 'itemId')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04] transition-colors"
                >
                  {copiedField === 'itemId' ? (
                    <Check className="w-4 h-4 text-card-brand-dark" />
                  ) : (
                    <Copy className="w-4 h-4 text-foreground-muted" />
                  )}
                </button>
              </div>
              <p className="text-caption font-mono text-foreground-muted break-all leading-relaxed">
                {item.id}
              </p>
            </div>
          </div>
        </div>

        {/* Invoice (for receive-request) */}
        {item.type === 'receive-request' && invoice && (
          <div className="px-5 mt-6">
            <p className="text-label text-foreground-muted uppercase tracking-wider mb-1">
              {t('txDetail.bolt11')}
            </p>
            <div className="bg-background-card rounded px-4">
              <div className="py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-body text-foreground-muted">Invoice</span>
                  <button
                    onClick={() => handleCopy(invoice, 'invoice')}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04] transition-colors"
                  >
                    {copiedField === 'invoice' ? (
                      <Check className="w-4 h-4 text-card-brand-dark" />
                    ) : (
                      <Copy className="w-4 h-4 text-foreground-muted" />
                    )}
                  </button>
                </div>
                <p className="text-caption font-mono text-foreground-muted break-all leading-relaxed line-clamp-3">
                  {invoice}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* bottom spacing */}
        <div className="h-8" />
      </div>

      {/* Action Button (type-specific) */}
      {item.type === 'unclaimed-token' && (
        <div className="px-5 pb-4 pt-2 shrink-0">
          <button
            onClick={handleRedeem}
            disabled={isProcessing || !item.token}
            className="w-full py-3.5 rounded-xl bg-brand text-white font-semibold text-caption flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t('pending.redeemAction')}
          </button>
        </div>
      )}

      {item.type === 'sent-token' && (
        <div className="px-5 pb-4 pt-2 shrink-0">
          <button
            onClick={handleReclaim}
            disabled={isProcessing || (!item.token && !item.operationId)}
            className="w-full py-3.5 rounded-xl bg-foreground/[0.06] text-foreground font-semibold text-caption flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t('pending.reclaimAction')}
          </button>
        </div>
      )}
    </div>
  )
}
