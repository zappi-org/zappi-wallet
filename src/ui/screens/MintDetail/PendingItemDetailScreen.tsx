import { useState, useCallback, useEffect, useMemo } from 'react'
import { ArrowLeft, Copy, Check, Clock, Loader2, RefreshCw, Download, QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFormatSats, useFormatFiat, getLocaleCode } from '@/utils/format'
import { useMintMetadata } from '@/hooks'
import { Button } from '@/ui/components/common/Button'
import { useAppStore } from '@/store'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import type { PendingItem } from '@/hooks/usePendingItems'
import { isReceiveRequest, isSendToken, isOfflineToken } from '@/ui/types/pending-item-details'

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
  const reqDetails = isReceiveRequest(item) ? item.details : undefined
  const sendDetails = isSendToken(item) ? item.details : undefined
  const offlineDetails = isOfflineToken(item) ? item.details : undefined
  const tokenStr = sendDetails?.token ?? offlineDetails?.token
  const operationId = sendDetails?.operationId
  const [invoice, setInvoice] = useState<string | null>(reqDetails?.invoice || null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState<string | null>(null)
  const [isCheckingQuote, setIsCheckingQuote] = useState(false)
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [qrValue, setQrValue] = useState<string | null>(null)
  const addToast = useAppStore((s) => s.addToast)

  const mintUrls = useMemo(() => [item.accountId], [item.accountId])
  const { getDisplayName } = useMintMetadata(mintUrls)
  const quoteId = reqDetails?.quoteId || item.id

  // Fetch invoice from coco for orphan quotes (no invoice in item)
  useEffect(() => {
    if (!reqDetails || reqDetails.invoice) return
    let cancelled = false
    ;(async () => {
      try {
        const { getMintQuote } = await import('@/coco/manager')
        const quote = await getMintQuote(item.accountId, quoteId)
        if (!cancelled && quote?.request) {
          setInvoice(quote.request)
        }
      } catch {
        // Quote may have expired
      }
    })()
    return () => { cancelled = true }
  }, [reqDetails, item.accountId, quoteId])

  const handleCopy = useCallback(async (text: string, field: string) => {
    await copyToClipboard(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  // === Action handlers ===

  const handleRedeem = useCallback(async () => {
    if (!tokenStr) return
    setIsProcessing(true)
    try {
      const { PaymentService } = await import('@/services/payment/payment.service')
      const service = new PaymentService()
      const result = await service.receiveEcash(tokenStr)
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
  }, [tokenStr, item.id, onBack, addToast, t])

  const handleReclaim = useCallback(async () => {
    if (!operationId && !tokenStr) return
    setIsProcessing(true)
    const { getDatabase } = await import('@/data/database/schema')
    const db = getDatabase()
    try {
      if (operationId) {
        const { rollbackSendToken } = await import('@/coco/cashuService')
        await rollbackSendToken(operationId)
      } else if (tokenStr) {
        const { receiveToken } = await import('@/coco/cashuService')
        await receiveToken(tokenStr)
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
  }, [operationId, tokenStr, item.id, onBack, addToast, t])

  const handleCheckQuote = useCallback(async () => {
    setIsCheckingQuote(true)
    setQuoteStatus(null)
    try {
      const { getMintQuote } = await import('@/coco/manager')
      const quote = await getMintQuote(item.accountId, quoteId)
      if (quote) {
        setQuoteStatus(quote.state)
      } else {
        setQuoteStatus('UNKNOWN')
      }
    } catch {
      setQuoteStatus('ERROR')
    } finally {
      setIsCheckingQuote(false)
    }
  }, [item.accountId, quoteId])

  const handleRedeemQuote = useCallback(async () => {
    setIsRedeeming(true)
    try {
      const { redeemMintQuote } = await import('@/coco/cashuService')
      await redeemMintQuote(item.accountId, quoteId, item.amount)

      if (reqDetails?.quoteId) {
        const { findByQuoteId, completeReceiveRequest } = await import('@/services/receive-request')
        const req = await findByQuoteId(quoteId)
        if (req && req.status === 'pending') {
          await completeReceiveRequest(req.id, 'lightning')
        }
      }

      addToast({ type: 'success', message: t('pending.redeemSuccess'), duration: 2000 })
      onBack()
    } catch (err) {
      console.error('[PendingDetail] Redeem quote failed:', err)
      addToast({ type: 'error', message: t('pending.redeemFailed'), duration: 2000 })
    } finally {
      setIsRedeeming(false)
    }
  }, [item.accountId, reqDetails?.quoteId, quoteId, item.amount, onBack, addToast, t])

  const locale = getLocaleCode(i18n.language)

  const title = item.direction === 'receive' && item.kind === 'token'
    ? t('mintDetail.ecashToken')
    : item.direction === 'receive' && item.kind === 'request'
      ? t('mintDetail.receiveRequest')
      : t('mintDetail.sentToken')

  const isReceive = item.direction === 'receive'

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

  function CopyableSection({ label, value, field, showQr }: {
    label: string
    value: string
    field: string
    showQr?: boolean
  }) {
    return (
      <div className="py-3 border-b border-border/30 last:border-b-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-body text-foreground-muted">{label}</span>
          <div className="flex items-center gap-1">
            {showQr && (
              <button
                onClick={() => setQrValue(value)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
              >
                <QrCode className="w-4 h-4 text-foreground-muted" />
              </button>
            )}
            <button
              onClick={() => handleCopy(value, field)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
            >
              {copiedField === field ? (
                <Check className="w-4 h-4 text-card-brand-dark" />
              ) : (
                <Copy className="w-4 h-4 text-foreground-muted" />
              )}
            </button>
          </div>
        </div>
        <p className="text-caption font-mono text-foreground-muted break-all leading-relaxed line-clamp-3">
          {value}
        </p>
      </div>
    )
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
          copyable ? 'active:bg-foreground/[0.02] transition-colors' : ''
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
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Hero: Amount + Context */}
        <div className="flex flex-col items-center px-6 pt-6 pb-8">
          <span className={`text-display font-bold font-display tracking-tight leading-tight ${
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
          <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
            {t('txDetail.txInfo')}
          </p>
          <div className="bg-background-card rounded px-4">
            <InfoRow label={t('txDetail.type')} value={title} />
            <InfoRow label={t('txDetail.mint')} value={getDisplayName(item.accountId)} />
            {item.memo && <InfoRow label={t('txDetail.memo')} value={item.memo} />}

            {expiryRemaining && (
              <div className="flex items-center justify-between py-3 border-b border-border/30 last:border-b-0">
                <span className="text-body text-foreground-muted">{t('mintDetail.pendingExpiry')}</span>
                <span className="text-body font-medium text-accent-danger">{expiryRemaining}</span>
              </div>
            )}

            {reqDetails?.quoteId && (
              <div className="flex items-center justify-between py-3 border-b border-border/30 last:border-b-0">
                <span className="text-body text-foreground-muted">{t('pending.quoteStatus')}</span>
                <div className="flex items-center gap-2">
                  {quoteStatus ? (
                    <span className={`text-body font-semibold ${
                      quoteStatus === 'PAID' ? 'text-card-brand-dark' :
                      quoteStatus === 'ISSUED' ? 'text-foreground-muted' :
                      quoteStatus === 'UNPAID' ? 'text-badge-lightning-text' :
                      'text-accent-danger'
                    }`}>
                      {quoteStatus}
                    </span>
                  ) : (
                    <span className="text-body text-foreground-muted">—</span>
                  )}
                  <button
                    onClick={handleCheckQuote}
                    disabled={isCheckingQuote}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
                  >
                    {isCheckingQuote ? (
                      <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
                    ) : (
                      <RefreshCw className="w-4 h-4 text-foreground-muted" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payment Methods (for receive-request) */}
        {reqDetails && (
          <div className="px-5 mt-6">
            <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {t('pending.payment')}
            </p>
            <div className="bg-background-card rounded px-4">
              {reqDetails.bip321Uri && (
                <CopyableSection
                  label={t('pending.unified')}
                  value={reqDetails.bip321Uri}
                  field="bip321Uri"
                  showQr
                />
              )}

              {reqDetails.ecashRequest && (
                <CopyableSection
                  label={t('pending.ecashRequest')}
                  value={reqDetails.ecashRequest}
                  field="ecashRequest"
                  showQr
                />
              )}

              {invoice && (
                <CopyableSection
                  label={t('pending.lightningInvoice')}
                  value={invoice}
                  field="invoice"
                  showQr
                />
              )}

              {reqDetails.quoteId && (
                <CopyableSection
                  label="Quote ID"
                  value={reqDetails.quoteId}
                  field="quoteId"
                />
              )}
            </div>
          </div>
        )}

        {/* Redeem button (when quote is PAID) */}
        {reqDetails && quoteStatus === 'PAID' && (
          <div className="px-5 mt-4">
            <Button
              variant="brand"
              size="lg"
              onClick={handleRedeemQuote}
              disabled={isRedeeming}
              loading={isRedeeming}
              icon={!isRedeeming ? <Download className="w-4 h-4" /> : undefined}
              className="w-full"
            >
              {t('pending.redeemQuote')}
            </Button>
          </div>
        )}

        {/* bottom spacing */}
        <div className="h-8" />
      </div>

      {/* Action Button (type-specific) */}
      {item.direction === 'receive' && item.kind === 'token' && (
        <div className="px-5 pb-4 pt-2 shrink-0">
          <Button
            variant="brand"
            size="lg"
            onClick={handleRedeem}
            disabled={isProcessing || !tokenStr}
            loading={isProcessing}
            className="w-full"
          >
            {t('pending.redeemAction')}
          </Button>
        </div>
      )}

      {item.direction === 'send' && item.kind === 'token' && (
        <div className="px-5 pb-4 pt-2 shrink-0">
          <button
            onClick={handleReclaim}
            disabled={isProcessing || (!tokenStr && !operationId)}
            className="w-full py-3.5 rounded-xl bg-foreground/[0.06] text-foreground font-semibold text-caption flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t('pending.reclaimAction')}
          </button>
        </div>
      )}

      {/* QR Modal */}
      {qrValue && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center pointer-events-none">
          <div
            onClick={() => setQrValue(null)}
            className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto animate-fadeIn"
          />
          <div className="bg-background w-full max-w-[340px] rounded-2xl pointer-events-auto relative z-10 shadow-2xl animate-slideInUp overflow-hidden">
            <div className="flex items-center justify-end px-5 pt-5">
              <button
                onClick={() => setQrValue(null)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-muted"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-center px-8 py-6">
              <QRCodeDisplay
                value={qrValue}
                size={220}
                level="L"
                className="rounded-2xl"
              />
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={() => handleCopy(qrValue, 'qrModal')}
                className="w-full flex items-center justify-center gap-2 bg-background-card text-foreground border border-border py-3.5 rounded-xl font-semibold text-caption active:scale-[0.98] transition-transform shadow-sm"
              >
                {copiedField === 'qrModal' ? (
                  <><Check className="w-4 h-4" /> {t('common.copied')}</>
                ) : (
                  <><Copy className="w-4 h-4" /> {t('common.copy')}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
