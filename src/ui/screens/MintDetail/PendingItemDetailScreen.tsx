import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'
import { PaymentReceipt, type PaymentReceiptRow } from '@/ui/components/payment/PaymentReceipt'
import { TxStateBar } from '@/ui/screens/TransactionDetail/TxStateBar'
import type { TxStateTrack } from '@/ui/screens/TransactionDetail/tx-state-machine'
import { TokenQrModal } from '@/ui/screens/TransactionDetail/TokenQrModal'
import { useMintMetadata } from '@/ui/hooks'
import { useTokenReclaim } from '@/ui/hooks/use-token-reclaim'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import type { PendingItem } from '@/ui/hooks/usePendingItems'
import { isOfflineToken, isReceiveRequest, isSendToken } from '@/ui/types/pending-item-details'
import { shareOrCopyText } from '@/ui/utils/share'
import { cn } from '@/ui/lib/utils'
import { getLocaleCode, useFormatFiat, useFormatSats } from '@/utils/format'
import { ArrowLeft, Check, ChevronDown, Copy, Download, Loader2, QrCode, RefreshCw, Share2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface PendingItemDetailCallbacks {
  onRedeemToken?: (tokenStr: string, itemId: string) => Promise<boolean>
  onCheckQuote?: (mintUrl: string, quoteId: string) => Promise<{ state: string; request?: string } | null>
  onRedeemQuote?: (mintUrl: string, quoteId: string, amount: number) => Promise<void>
  onDeleteItem?: (itemId: string, table: 'pendingReceivedTokens' | 'pendingSendTokens') => Promise<void>
  onPendingItemChanged?: () => Promise<void> | void
}

export interface PendingItemDetailScreenProps {
  item: PendingItem
  onBack: () => void
  callbacks?: PendingItemDetailCallbacks
  onItemRemoved?: () => Promise<void> | void
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

export function PendingItemDetailScreen({ item, onBack, callbacks, onItemRemoved }: PendingItemDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const serviceRegistry = useServiceRegistry()
  const { reclaimToken } = useTokenReclaim()
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
  const [isResolvingExpiry, setIsResolvingExpiry] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [qrPayload, setQrPayload] = useState<{ value: string; title: string; veil: boolean } | null>(null)
  const addToast = useAppStore((s) => s.addToast)

  const mintUrls = useMemo(() => [item.accountId], [item.accountId])
  const { getDisplayName } = useMintMetadata(mintUrls)
  const quoteId = reqDetails?.quoteId || item.id

  // Fetch invoice from coco for orphan quotes (no invoice in item)
  useEffect(() => {
    if (!reqDetails || reqDetails.invoice) return
    const checkQuote = callbacks?.onCheckQuote
    if (!checkQuote) return
    let cancelled = false
    ;(async () => {
      try {
        const quote = await checkQuote(item.accountId, quoteId)
        if (!cancelled && quote?.request) {
          setInvoice(quote.request)
        }
      } catch {
        // Quote may have expired
      }
    })()
    return () => { cancelled = true }
  }, [reqDetails, item.accountId, quoteId, callbacks])

  useEffect(() => {
    if (!reqDetails) return
    let cancelled = false

    setIsResolvingExpiry(true)
    void (async () => {
      try {
        const status = await serviceRegistry.pendingItems.checkEffectiveExpiry(item.id)
        if (cancelled) return

        if (status === 'fulfilled') {
          // Paid while this detail was open — the receive transaction now owns
          // the story, so close the request quietly with the right message.
          void callbacks?.onPendingItemChanged?.()
          void onItemRemoved?.()
          addToast({ type: 'success', message: t('pending.fulfilledClosed'), duration: 2500 })
          onBack()
          return
        }
        if (status !== 'expired') return

        await serviceRegistry.pendingItems.expireById(item.id)
        if (cancelled) return

        void callbacks?.onPendingItemChanged?.()
        void onItemRemoved?.()
        addToast({ type: 'info', message: t('pending.expiredRemoved'), duration: 2500 })
        onBack()
      } catch (error) {
        console.error('[PendingDetail] Failed to resolve effective expiry:', error)
      } finally {
        if (!cancelled) {
          setIsResolvingExpiry(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [reqDetails, serviceRegistry, item.id, callbacks, onItemRemoved, addToast, t, onBack])

  const handleCopy = useCallback(async (text: string, field: string) => {
    await copyToClipboard(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  // === Action handlers ===

  const handleRedeem = useCallback(async () => {
    if (!tokenStr || !callbacks?.onRedeemToken) return
    setIsProcessing(true)
    try {
      const success = await callbacks.onRedeemToken(tokenStr, item.id)
      if (success) {
        void callbacks.onPendingItemChanged?.()
        void onItemRemoved?.()
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
  }, [tokenStr, item.id, onBack, addToast, t, callbacks, onItemRemoved])

  const handleReclaim = useCallback(async () => {
    if (!operationId && !tokenStr) return
    setIsProcessing(true)
    try {
      const result = await reclaimToken(item.id)
      if (result.spentByRecipient || result.alreadySpent) {
        // Recipient already received it, or it was already spent
        void callbacks?.onPendingItemChanged?.()
        void onItemRemoved?.()
        onBack()
      } else if (result.success) {
        void callbacks?.onPendingItemChanged?.()
        void onItemRemoved?.()
        onBack()
      }
    } catch {
      addToast({ type: 'error', message: t('txDetail.reclaimFailed'), duration: 2000 })
    } finally {
      setIsProcessing(false)
    }
  }, [operationId, tokenStr, item.id, onBack, addToast, t, callbacks, onItemRemoved, reclaimToken])

  const handleCheckQuote = useCallback(async () => {
    if (!callbacks?.onCheckQuote) return
    setIsCheckingQuote(true)
    setQuoteStatus(null)
    try {
      const quote = await callbacks.onCheckQuote(item.accountId, quoteId)
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
  }, [item.accountId, quoteId, callbacks])

  const handleRedeemQuote = useCallback(async () => {
    if (!callbacks?.onRedeemQuote) return
    setIsRedeeming(true)
    try {
      await callbacks.onRedeemQuote(item.accountId, quoteId, item.amount)
      void callbacks.onPendingItemChanged?.()
      void onItemRemoved?.()
      addToast({ type: 'success', message: t('pending.redeemSuccess'), duration: 2000 })
      onBack()
    } catch (err) {
      console.error('[PendingDetail] Redeem quote failed:', err)
      addToast({ type: 'error', message: t('pending.redeemFailed'), duration: 2000 })
    } finally {
      setIsRedeeming(false)
    }
  }, [item.accountId, quoteId, item.amount, onBack, addToast, t, callbacks, onItemRemoved])

  const locale = getLocaleCode(i18n.language)

  const isIncomingToken = item.direction === 'receive' && item.kind === 'token'
  const isRequest = item.direction === 'receive' && item.kind === 'request'
  const isReceive = item.direction === 'receive'

  const typeLabel = isIncomingToken
    ? t('mintDetail.ecashToken')
    : isRequest
      ? t('mintDetail.receiveRequest')
      : t('mintDetail.sentToken')

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

  // Same lifecycle vocabulary as the archive: an unpaid request rests its
  // light on 요청함; an arrived-but-unredeemed token waits on 수신 대기.
  const track = useMemo<TxStateTrack>(() => {
    if (isRequest) {
      return {
        nodes: [
          { labelKey: 'txDetail.state.requested', tone: 'current', at: item.createdAt },
          { labelKey: 'txDetail.state.received', tone: 'todo' },
        ],
      }
    }
    if (isIncomingToken) {
      return {
        nodes: [
          { labelKey: 'txDetail.state.awaitingReceipt', tone: 'current', at: item.createdAt },
          { labelKey: 'txDetail.state.received', tone: 'todo' },
        ],
      }
    }
    return {
      nodes: [
        { labelKey: 'txDetail.state.created', tone: 'done', at: item.createdAt },
        { labelKey: 'txDetail.state.waiting', tone: 'current' },
        { labelKey: 'txDetail.state.used', tone: 'todo' },
      ],
      noteKey: 'txDetail.state.notePending',
    }
  }, [isRequest, isIncomingToken, item.createdAt])

  const receiptRows = useMemo<PaymentReceiptRow[]>(() => {
    const rows: PaymentReceiptRow[] = []
    rows.push({ label: t('txDetail.type'), value: typeLabel })
    rows.push({
      label: isReceive ? t('receive.receipt.toMint') : t('send.confirm.sourceMint'),
      value: getDisplayName(item.accountId),
      strong: true,
    })
    if (item.memo) rows.push({ label: isReceive ? t('receive.receipt.memo') : t('send.confirm.memo'), value: item.memo })
    if (expiryRemaining) rows.push({ label: t('mintDetail.pendingExpiry'), value: expiryRemaining })
    return rows
  }, [t, typeLabel, isReceive, getDisplayName, item.accountId, item.memo, expiryRemaining])

  // Long, copyable payloads live in the folded details, like the archive.
  const detailEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; value: string; qr?: boolean; veil?: boolean }> = []
    if (reqDetails?.bip321Uri) entries.push({ key: 'bip321Uri', label: t('pending.unified'), value: reqDetails.bip321Uri, qr: true })
    if (reqDetails?.ecashRequest) entries.push({ key: 'ecashRequest', label: t('pending.ecashRequest'), value: reqDetails.ecashRequest, qr: true })
    if (invoice) entries.push({ key: 'invoice', label: t('pending.lightningInvoice'), value: invoice, qr: true })
    if (reqDetails?.quoteId) entries.push({ key: 'quoteId', label: 'Quote ID', value: reqDetails.quoteId })
    if (tokenStr) entries.push({ key: 'token', label: t('txDetail.viewRawToken'), value: tokenStr })
    return entries
  }, [reqDetails, invoice, tokenStr, t])

  // The share/QR chips carry the actionable payload: the bearer token itself,
  // or the request's broadest payment URI.
  const chipPayload = tokenStr ?? reqDetails?.bip321Uri ?? reqDetails?.ecashRequest ?? invoice ?? null
  const chipVeil = !!tokenStr

  const handleShare = useCallback(async () => {
    if (!chipPayload) return
    await shareOrCopyText(chipPayload, () => {
      addToast({ type: 'success', message: t('token.reclaimable.copiedToClipboard') })
    })
  }, [chipPayload, addToast, t])

  const statusLine = `${formatDate(item.createdAt)} · ${t('history.pendingStatus')}`

  return (
    <div className="w-full h-full flex flex-col bg-background pt-safe">
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
      <div className="flex-1 overflow-y-auto pb-app">
        {/* ── Receipt paper — same sheet as the archive detail ── */}
        <div className="pt-2 pb-5">
          <PaymentReceipt
            status="pending"
            title={isReceive ? t('receive.receipt.title') : t('send.receipt.title')}
            amount={formatSats(item.amount)}
            fiat={toFiat(item.amount)}
            rows={receiptRows}
            statusLine={statusLine}
            extra={
              <>
                <TxStateBar track={track} t={t} locale={i18n.language} framed={false} />
                {detailEntries.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowDetails((v) => !v)}
                      className="mt-2 flex w-full items-center justify-between border-t-[1.5px] border-dashed border-border pt-3 pb-1.5"
                    >
                      <span className="text-caption font-semibold text-foreground-muted">{t('txDetail.details')}</span>
                      <ChevronDown className={cn('w-3.5 h-3.5 text-foreground-muted transition-transform', showDetails && 'rotate-180')} strokeWidth={1.8} />
                    </button>
                    {showDetails && (
                      <div className="mt-2 flex flex-col gap-4 text-left">
                        {detailEntries.map((entry) => (
                          <div key={entry.key}>
                            <div className="flex items-center justify-between">
                              <span className="text-caption text-foreground-muted">{entry.label}</span>
                              <span className="flex items-center">
                                {entry.qr && (
                                  <button
                                    onClick={() => setQrPayload({ value: entry.value, title: entry.label, veil: false })}
                                    className="w-9 h-9 flex items-center justify-center rounded-lg active:bg-foreground/[0.06]"
                                    aria-label="QR"
                                  >
                                    <QrCode className="w-4 h-4 text-foreground-muted" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleCopy(entry.value, entry.key)}
                                  className="w-9 h-9 flex items-center justify-center rounded-lg active:bg-foreground/[0.06]"
                                  aria-label={t('common.copy')}
                                >
                                  {copiedField === entry.key ? <Check className="w-4 h-4 text-accent-success" /> : <Copy className="w-4 h-4 text-foreground-muted" />}
                                </button>
                              </span>
                            </div>
                            <p className="text-overline font-mono text-foreground-muted break-all leading-relaxed line-clamp-3">
                              {entry.value}
                            </p>
                          </div>
                        ))}
                        {reqDetails?.quoteId && (
                          <div className="flex items-center justify-between">
                            <span className="text-caption text-foreground-muted">{t('pending.quoteStatus')}</span>
                            <span className="flex items-center gap-1.5">
                              <span className={cn('text-caption font-semibold', {
                                'text-accent-success': quoteStatus === 'PAID',
                                'text-foreground-muted': !quoteStatus || quoteStatus === 'ISSUED',
                                'text-status-pending': quoteStatus === 'UNPAID',
                                'text-accent-danger': quoteStatus === 'ERROR' || quoteStatus === 'UNKNOWN',
                              })}>
                                {quoteStatus ?? '—'}
                              </span>
                              <button
                                onClick={handleCheckQuote}
                                disabled={isCheckingQuote || isResolvingExpiry}
                                className="w-9 h-9 flex items-center justify-center rounded-lg active:bg-foreground/[0.06] disabled:opacity-50"
                                aria-label={t('pending.quoteStatus')}
                              >
                                {isCheckingQuote || isResolvingExpiry ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
                                ) : (
                                  <RefreshCw className="w-4 h-4 text-foreground-muted" />
                                )}
                              </button>
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            }
          />
        </div>

        <div className="px-5 flex flex-col gap-3">
          {/* ── Payload actions — QR/copy/share, same chip row as the archive ── */}
          {chipPayload && (
            <div className="flex gap-2">
              <button
                onClick={() => setQrPayload({ value: chipPayload, title: typeLabel, veil: chipVeil })}
                className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-full bg-background-card border border-border/60 text-caption font-semibold text-foreground active:scale-[0.98] transition-transform"
              >
                <QrCode className="w-4 h-4" strokeWidth={1.8} /> QR
              </button>
              <button
                onClick={() => handleCopy(chipPayload, 'chip')}
                className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-full bg-background-card border border-border/60 text-caption font-semibold text-foreground active:scale-[0.98] transition-transform"
              >
                {copiedField === 'chip' ? <Check className="w-4 h-4 text-accent-success" strokeWidth={1.8} /> : <Copy className="w-4 h-4" strokeWidth={1.8} />}
                {t('common.copy')}
              </button>
              <button
                onClick={handleShare}
                className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-full bg-background-card border border-border/60 text-caption font-semibold text-foreground active:scale-[0.98] transition-transform"
              >
                <Share2 className="w-4 h-4" strokeWidth={1.8} /> {t('txDetail.share')}
              </button>
            </div>
          )}

          {/* ── Primary CTA per item kind ── */}
          {isIncomingToken && (
            <Button
              variant="brand"
              size="lg"
              onClick={handleRedeem}
              disabled={isProcessing || !tokenStr}
              loading={isProcessing}
              className="mt-2 w-full"
            >
              {t('pending.redeemAction')}
            </Button>
          )}

          {isRequest && quoteStatus === 'PAID' && (
            <Button
              variant="brand"
              size="lg"
              onClick={handleRedeemQuote}
              disabled={isRedeeming}
              loading={isRedeeming}
              icon={!isRedeeming ? <Download className="w-4 h-4" /> : undefined}
              className="mt-2 w-full"
            >
              {t('pending.redeemQuote')}
            </Button>
          )}

          {item.direction === 'send' && item.kind === 'token' && (
            <button
              onClick={handleReclaim}
              disabled={isProcessing || (!tokenStr && !operationId)}
              className="mt-2 w-full py-3.5 rounded-full bg-foreground/[0.06] text-foreground font-semibold text-caption flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t('pending.reclaimAction')}
            </button>
          )}
        </div>

        <div className="h-8" />
      </div>

      {/* QR modal — bearer payloads veil, request URIs show plainly */}
      <TokenQrModal
        isOpen={qrPayload !== null}
        token={qrPayload?.value ?? ''}
        title={qrPayload?.title}
        veil={qrPayload?.veil ?? false}
        onClose={() => setQrPayload(null)}
      />
    </div>
  )
}
