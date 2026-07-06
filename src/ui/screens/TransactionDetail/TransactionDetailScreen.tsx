import type { TranslationKey } from '@/i18n'
import { toNumber } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import { getDisplayFee, getTotalCost, getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useReclaim } from '@/ui/hooks/use-reclaim'
import { useTransactionMgmt } from '@/ui/hooks/use-transaction-mgmt'
import { formatTransactionFiat, useFormatFiat, useFormatSats, truncateStr } from '@/utils/format'
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  MoreVertical,
  QrCode,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TokenQrModal } from './TokenQrModal'
import { TokenSpentByRecipientError } from '@/core/errors/reclaim'

export interface TransactionDetailScreenProps {
  transaction: Transaction
  onBack: () => void
  mintUrls?: string[]
}

export default function TransactionDetailScreen({
  transaction: initialTx,
  onBack,
  mintUrls = [],
}: TransactionDetailScreenProps) {
  const { reclaim } = useReclaim()
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const { getDisplayName } = useMintMetadata(mintUrls)
  const txMgmt = useTransactionMgmt()
  const [tx, setTx] = useState(initialTx)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [isReclaiming, setIsReclaiming] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showTokenQr, setShowTokenQr] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const addToast = useAppStore((s) => s.addToast)

  const txType = getTransactionType(tx)
  const meta = getTxMeta(tx)
  const amountSats = toNumber(getTotalCost(tx))
  const displayFee = getDisplayFee(tx)
  const isReceive = tx.direction === 'receive'
  const isSwap = txType === 'swap'
  const isLightning = txType === 'lightning'
  const isEcashToken = txType === 'ecash-token'
  const isEcash = txType === 'ecash' || isEcashToken
  const isNutzap = txType === 'nutzap'
  const metadata = tx.metadata as Record<string, unknown> | undefined

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  // Kiosk order detection
  const kioskOrder = useMemo(() => {
    if (metadata?.type !== 'kiosk_order') return null
    return metadata as {
      type: 'kiosk_order'
      items: Array<{ productName: string; price: number; quantity: number; subtotal: number }>
      itemCount: number
      total: number
    }
  }, [metadata])

  // ─── Copy helper ───
  const handleCopy = useCallback(
    async (text: string, field: string) => {
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
      setCopiedField(field)
      addToast({ type: 'success', message: t('txDetail.copied'), duration: 1500 })
      setTimeout(() => setCopiedField(null), 2000)
    },
    [addToast, t],
  )

  // ─── Check state then reclaim (one-click) ───
  const handleCheckAndReclaim = useCallback(async () => {
    if (!meta.token) return
    setIsReclaiming(true)
    try {
      const result = await reclaim(tx.id)

      if (!result.success) {
        //Check spent by TokenSpentByRecipientError
        if (result.error instanceof TokenSpentByRecipientError) {
          setTx((prev) => ({
            ...prev,
            status: 'settled',
            outcome: 'claimed',
            completedAt: Date.now()
          }))
          // 토스트는 useReclaim 훅에서 처리
        }
        // 기타 에러도 훅에서 처리
      } else {
        // 성공: reclaimed 상태로 업데이트
        setTx((prev) => ({
          ...prev,
          status: 'settled',
          outcome: 'reclaimed',
          completedAt: Date.now()
        }))
      }
    } catch (err) {
      console.error('[TxDetail] Check & reclaim failed:', err)
      // 예외는 훅에서 처리하지 않으므로 여기서 토스트 필요
      addToast({ type: 'error', message: t('txDetail.reclaimFailed'), duration: 3000 })
    } finally {
      setIsReclaiming(false)
    }
  }, [meta.token, tx.id, reclaim, addToast, t])

  // ─── Share ───
  const handleShare = useCallback(async () => {
    if (!meta.token) return
    if (navigator.share) {
      await navigator.share({ text: meta.token }).catch(() => { })
    } else {
      handleCopy(meta.token, 'token')
    }
  }, [meta.token, handleCopy])

  // ─── Delete ───
  const handleDelete = useCallback(async () => {
    await txMgmt.delete(tx.id)
    useAppStore.getState().triggerTxRefresh()
    onBack()
  }, [tx.id, onBack, txMgmt])

  // ─── Type label ───
  const isReclaimed = isEcashToken && !!meta.reclaimedFrom

  const typeLabel = useMemo(() => {
    if (isSwap) return t('history.swap')
    if (isLightning && isReceive) return t('history.lightningReceive')
    if (isLightning && !isReceive) return t('history.lightningSend')
    if (isNutzap) return 'NutZap'
    if (isReclaimed) return t('history.ecashReclaim')
    if (isEcashToken) return isReceive ? t('history.ecashRegister') : t('history.ecashToken')
    if (isEcash && isReceive) return t('history.ecashReceive')
    return t('history.ecashSend')
  }, [isSwap, isLightning, isEcash, isEcashToken, isNutzap, isReceive, isReclaimed, t])

  // ─── Status config ───
  const statusConfig = useMemo(() => {
    switch (tx.status) {
      case 'settled':
        return { label: t('history.completed'), color: 'text-card-brand-dark' }
      case 'pending':
        return { label: t('history.pendingStatus'), color: 'text-badge-lightning-text' }
      case 'failed':
        return { label: t('history.failedStatus'), color: 'text-accent-danger' }
    }
  }, [tx.status, t])

  // ─── Context sentence ───
  const contextSentence = useMemo(() => {
    const mintName = getDisplayName(tx.accountId)

    if (isSwap && meta.fromMintUrl && meta.toMintUrl) {
      const from = getDisplayName(meta.fromMintUrl)
      const to = getDisplayName(meta.toMintUrl)
      return t('txDetail.swappedFromTo', { from, to })
    }
    if (isSwap) {
      return t('txDetail.swappedAt', { mint: mintName })
    }

    if (isLightning && !isReceive && meta.destination) {
      return t('txDetail.sentViaLightning', { address: meta.destination })
    }

    if (isReceive) {
      // POS/KIOSK source — "강남점에서 받음"
      if (meta.source && ['zappi-pos', 'zappi-kiosk', 'zappi-api'].includes(meta.source)) {
        const name = typeof metadata?.storeName === 'string' ? metadata.storeName : t(`txDetail.source.${meta.source}` as TranslationKey)
        return t('txDetail.receivedFromPOS', { name })
      }
      // 내 지갑으로 받음 — "Zappi Alpha Mint 지갑으로 받음"
      return t('txDetail.receivedToWallet', { wallet: mintName })
    }

    // Send (ecash-token or ecash)
    if (isReclaimed) return t('history.ecashReclaim')
    if (isEcashToken) return t('txDetail.tokenCreated')
    if (isEcash) return t('txDetail.sentEcash')
    // Lightning send without destination
    if (isLightning) return t('history.lightningSend')
    return typeLabel
  }, [tx, isSwap, isLightning, isReceive, isEcash, isEcashToken, isReclaimed, meta, metadata, getDisplayName, typeLabel, t])

  // ─── Source label ───
  const sourceLabel = useMemo(() => {
    if (!meta.source || meta.source === 'unknown') return null
    return t(`txDetail.source.${meta.source}` as TranslationKey)
  }, [meta.source, t])

  // ─── Helpers ───
  function formatDate(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // ─── Reusable row components ───
  function InfoRow({ label, value, copyable, field }: {
    label: string
    value: string
    copyable?: boolean
    field?: string
  }) {
    return (
      <button
        onClick={copyable && field ? () => handleCopy(value, field) : undefined}
        className={`flex items-center justify-between w-full py-3 border-b border-border/30 last:border-b-0 ${copyable ? 'active:bg-foreground/[0.02] transition-colors' : ''
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

  // ─── eCash unclaimed check ───
  const showUnclaimedCard = isEcash && !isReceive && meta.token && tx.outcome === 'unclaimed' && meta.tokenState !== 'spent' && tx.status !== 'failed'

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

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
        <div className="flex-1" />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
          >
            <MoreVertical className="w-5 h-5 text-foreground-muted" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-background-card rounded-xl shadow-lg border border-border/50 py-1 min-w-[140px] z-50">
              <button
                onClick={() => {
                  setShowMenu(false)
                  setShowDeleteConfirm(true)
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-caption text-accent-danger hover:bg-accent-danger/5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {t('txDetail.delete')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-app">

        {/* ── Hero: Amount + Context ── */}
        <div className="flex flex-col items-center px-6 pt-6 pb-8">
          {/* Amount */}
          <span className={`text-display font-bold font-display tracking-tight leading-tight ${isReceive ? 'text-card-brand-dark' : 'text-foreground'
            }`}>
            {isReceive ? '+' : '-'}{formatSats(amountSats)}
          </span>

          {/* Fiat */}
          {(() => {
            const f = formatTransactionFiat(tx.displaySnapshot, amountSats, formatFiat)
            return f ? (
              <span className="text-body text-foreground-muted mt-1">{f}</span>
            ) : null
          })()}

          {/* Context sentence */}
          <span className="text-body text-foreground-muted mt-3">
            {contextSentence}
          </span>

          {/* Time + Status */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-body text-foreground-muted">
              {formatDate(tx.createdAt)}
            </span>
            <span className="text-body text-foreground-muted">·</span>
            <span className={`text-caption font-medium ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>
        </div>

        {/* ── Transaction Info Section ── */}
        <div className="px-5">
          <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
            {t('txDetail.txInfo')}
          </p>
          <div className="bg-background-card rounded px-4">
            <InfoRow label={t('txDetail.type')} value={typeLabel} />
            {tx.memo && <InfoRow label={t('txDetail.memo')} value={tx.memo} />}
            {sourceLabel && <InfoRow label={t('txDetail.source')} value={sourceLabel} />}
            {typeof metadata?.failureReason === 'string' && metadata.failureReason !== 'reclaimed' && (
              <div className="flex items-center justify-between py-3 border-b border-border/30 last:border-b-0">
                <span className="text-body text-foreground-muted">{t('txDetail.failureReason')}</span>
                <span className="text-body font-medium text-accent-danger">{metadata.failureReason as string}</span>
              </div>
            )}
            {/* TX ID */}
            <div className="py-3 border-b border-border/30 last:border-b-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-body text-foreground-muted">{t('txDetail.txId')}</span>
                <button
                  onClick={() => handleCopy(tx.id, 'txId')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
                >
                  {copiedField === 'txId' ? (
                    <Check className="w-4 h-4 text-card-brand-dark" />
                  ) : (
                    <Copy className="w-4 h-4 text-foreground-muted" />
                  )}
                </button>
              </div>
              <p className="text-caption font-mono text-foreground-muted break-all leading-relaxed">
                {tx.id}
              </p>
            </div>

            {/* Token */}
            {showUnclaimedCard && meta.token && (
              <div className="py-3 border-b border-border/30 last:border-b-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-body text-foreground-muted">{t('txDetail.sentToken')}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopy(meta.token!, 'token')}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
                    >
                      {copiedField === 'token' ? (
                        <Check className="w-4 h-4 text-card-brand-dark" />
                      ) : (
                        <Copy className="w-4 h-4 text-foreground-muted" />
                      )}
                    </button>
                    {typeof navigator.share === 'function' && (
                      <button
                        onClick={handleShare}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
                      >
                        <Share2 className="w-4 h-4 text-foreground-muted" />
                      </button>
                    )}
                    <button
                      onClick={() => setShowTokenQr(true)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
                    >
                      <QrCode className="w-4 h-4 text-foreground-muted" />
                    </button>
                  </div>
                </div>
                <p className="text-caption font-mono text-foreground-muted break-all leading-relaxed line-clamp-3">
                  {meta.token}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Lightning Send: Payment Info ── */}
        {isLightning && !isReceive && (
          <div className="px-5 mt-6">
            <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {t('txDetail.paymentInfo')}
            </p>
            <div className="bg-background-card rounded px-4">
              {meta.destination && (
                <InfoRow label={t('txDetail.destination')} value={meta.destination} copyable field="destination" />
              )}
              {displayFee && (
                <InfoRow label={t('txDetail.fee')} value={formatSats(toNumber(displayFee))} />
              )}
              {meta.preimage && (
                <InfoRow label={t('txDetail.preimage')} value={meta.preimage} copyable field="preimage" />
              )}
              {meta.bolt11 && (
                <InfoRow label={t('txDetail.bolt11')} value={meta.bolt11} copyable field="bolt11" />
              )}
            </div>
          </div>
        )}

        {/* ── Lightning Receive ── */}
        {isLightning && isReceive && (meta.bolt11 || meta.preimage || typeof metadata?.quoteId === 'string') && (
          <div className="px-5 mt-6">
            <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {t('txDetail.details')}
            </p>
            <div className="bg-background-card rounded px-4">
              {meta.preimage && (
                <InfoRow label={t('txDetail.preimage')} value={meta.preimage} copyable field="preimage" />
              )}
              {meta.bolt11 && (
                <InfoRow label={t('txDetail.bolt11')} value={meta.bolt11} copyable field="bolt11" />
              )}
              {typeof metadata?.quoteId === 'string' && (
                <InfoRow label={t('txDetail.quoteId')} value={metadata.quoteId} copyable field="quoteId" />
              )}
            </div>
          </div>
        )}

        {/* ── Swap Info ── */}
        {isSwap && (meta.fromMintUrl || meta.toMintUrl) && (
          <div className="px-5 mt-6">
            <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {t('txDetail.swapInfo')}
            </p>
            <div className="bg-background-card rounded px-4">
              {meta.fromMintUrl && (
                <InfoRow label={t('txDetail.fromMint')} value={getDisplayName(meta.fromMintUrl)} />
              )}
              {meta.toMintUrl && (
                <InfoRow label={t('txDetail.toMint')} value={getDisplayName(meta.toMintUrl)} />
              )}
              {displayFee && (
                <InfoRow label={t('txDetail.fee')} value={formatSats(toNumber(displayFee))} />
              )}
            </div>
          </div>
        )}

        {/* ── Ecash Send: Fee Info ── */}
        {isEcash && !isReceive && displayFee && toNumber(displayFee) > 0 && (
          <div className="px-5 mt-6">
            <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {t('txDetail.details')}
            </p>
            <div className="bg-background-card rounded px-4">
              <InfoRow label={t('txDetail.fee')} value={formatSats(toNumber(displayFee))} />
            </div>
          </div>
        )}

        {/* ── Ecash Receive: Fee Info ── */}
        {isEcash && isReceive && displayFee && toNumber(displayFee) > 0 && (
          <div className="px-5 mt-6">
            <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {t('txDetail.details')}
            </p>
            <div className="bg-background-card rounded px-4">
              <InfoRow label={t('txDetail.fee')} value={formatSats(toNumber(displayFee))} />
            </div>
          </div>
        )}

        {/* ── Kiosk Order Items ── */}
        {kioskOrder && (
          <div className="px-5 mt-6">
            <p className="text-label font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {t('txDetail.orderItems')}
            </p>
            <div className="bg-background-card rounded px-4 py-1">
              {kioskOrder.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-b-0">
                  <span className="text-body text-foreground">
                    {item.productName} <span className="text-foreground-muted">x{item.quantity}</span>
                  </span>
                  <span className="text-body font-display font-mono font-medium text-foreground">
                    {formatSats(item.subtotal)}
                  </span>
                </div>
              ))}
              <div className="h-px bg-border/50 -mx-4" />
              <div className="flex items-center justify-between py-3">
                <span className="text-body font-bold text-foreground">{t('txDetail.orderTotal')}</span>
                <span className="text-body font-display font-mono font-bold text-foreground">
                  {formatSats(kioskOrder.total)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── eCash Unclaimed: Reclaim action ── */}
        {showUnclaimedCard && (
          <div className="px-5 mt-6">
            <button
              onClick={handleCheckAndReclaim}
              disabled={isReclaiming}
              className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl text-caption font-medium text-foreground-muted hover:text-foreground hover:bg-foreground/[0.03] transition-colors disabled:opacity-50"
            >
              {isReclaiming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Undo2 className="w-4 h-4" />
              )}
              {isReclaiming ? t('txDetail.reclaiming') : t('txDetail.reclaimAction')}
            </button>
          </div>
        )}

        {/* bottom spacing */}
        <div className="h-8" />
      </div>

      {/* Token QR Modal */}
      {meta.token && (
        <TokenQrModal
          isOpen={showTokenQr}
          token={meta.token}
          onClose={() => setShowTokenQr(false)}
        />
      )}

      {/* Delete Confirmation Overlay */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-50 flex items-end bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="w-full bg-background-card rounded-t-3xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-body font-semibold text-foreground">{t('txDetail.deleteConfirm')}</p>
            <p className="text-body text-foreground-muted">{t('txDetail.deleteWarning')}</p>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" onClick={() => setShowDeleteConfirm(false)} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" size="lg" onClick={handleDelete} className="flex-1">
                {t('txDetail.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
