import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Zap,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Share2,
  Undo2,
  Trash2,
  Loader2,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { Transaction, TokenState } from '@/core/types'
import { useFormatSats } from '@/utils/format'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { TransactionRepository } from '@/data/repositories/transaction.repository'
import { getDecodedToken } from '@cashu/cashu-ts'
import { classifyCashuError } from '@/core/errors/cashu'
import { translateError } from '@/core/errors/translate'

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
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const { getDisplayName } = useMintMetadata(mintUrls)
  const [tx, setTx] = useState(initialTx)
  const [showDetails, setShowDetails] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [isCheckingState, setIsCheckingState] = useState(false)
  const [isReclaiming, setIsReclaiming] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const isReceive = tx.direction === 'receive'
  const isSwap = tx.type === 'swap'
  const isLightning = tx.type === 'lightning'
  const isEcash = tx.type === 'ecash'
  const isNutzap = tx.type === 'nutzap'


  const metadata = tx.metadata as Record<string, unknown> | undefined

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
      setTimeout(() => setCopiedField(null), 2000)
    },
    [],
  )

  // ─── Token state check ───
  const handleCheckTokenState = useCallback(async () => {
    if (!tx.token) return
    setIsCheckingState(true)
    try {
      const { CashuService } = await import('@/services/cashu/cashu.service')
      const cashu = new CashuService()
      const decoded = getDecodedToken(tx.token)
      const wallet = await cashu.getWallet(decoded.mint)
      const states = await wallet.checkProofsStates(decoded.proofs)

      let tokenState: TokenState = 'unknown'
      const spentCount = states.filter((s) => s.state === 'SPENT').length
      const pendingCount = states.filter((s) => s.state === 'PENDING').length

      if (spentCount === states.length) tokenState = 'spent'
      else if (pendingCount > 0) tokenState = 'pending'
      else if (spentCount === 0) tokenState = 'unspent'

      // Persist to DB
      const repo = new TransactionRepository()
      await repo.update(tx.id, { tokenState })
      setTx((prev) => ({ ...prev, tokenState }))
    } catch (err) {
      console.error('[TxDetail] Token state check failed:', err)
      addToast({ type: 'error', message: translateError(classifyCashuError(err)), duration: 3000 })
    } finally {
      setIsCheckingState(false)
    }
  }, [tx.token, tx.id, addToast])

  // ─── Check state then reclaim (one-click cancel) ───
  const handleCheckAndReclaim = useCallback(async () => {
    if (!tx.token) return
    setIsReclaiming(true)
    try {
      // Step 1: Check if token is still unspent
      const { CashuService } = await import('@/services/cashu/cashu.service')
      const cashu = new CashuService()
      const decoded = getDecodedToken(tx.token)
      const wallet = await cashu.getWallet(decoded.mint)
      const states = await wallet.checkProofsStates(decoded.proofs)

      const spentCount = states.filter((s) => s.state === 'SPENT').length
      const pendingCount = states.filter((s) => s.state === 'PENDING').length

      if (spentCount === states.length) {
        // Already spent — cannot reclaim
        const repo = new TransactionRepository()
        await repo.update(tx.id, { tokenState: 'spent' as TokenState })
        setTx((prev) => ({ ...prev, tokenState: 'spent' as TokenState }))
        addToast({ type: 'error', message: t('txDetail.alreadySpent'), duration: 3000 })
        return
      }

      if (pendingCount > 0) {
        const repo = new TransactionRepository()
        await repo.update(tx.id, { tokenState: 'pending' as TokenState })
        setTx((prev) => ({ ...prev, tokenState: 'pending' as TokenState }))
        addToast({ type: 'error', message: t('txDetail.tokenPending'), duration: 3000 })
        return
      }

      // Step 2: Unspent — reclaim it
      const { receiveToken } = await import('@/coco/cashuService')
      await receiveToken(tx.token)

      const repo = new TransactionRepository()
      await repo.update(tx.id, { tokenState: 'spent' as TokenState, status: 'failed', failureReason: 'reclaimed' })
      setTx((prev) => ({ ...prev, tokenState: 'spent' as TokenState, status: 'failed', failureReason: 'reclaimed' }))

      useAppStore.getState().triggerTxRefresh()
      addToast({ type: 'success', message: t('txDetail.reclaimSuccess'), duration: 3000 })
    } catch (err) {
      console.error('[TxDetail] Check & reclaim failed:', err)
      addToast({ type: 'error', message: t('txDetail.reclaimFailed'), duration: 3000 })
    } finally {
      setIsReclaiming(false)
    }
  }, [tx.token, tx.id, addToast, t])

  // ─── Share ───
  const handleShare = useCallback(async () => {
    if (!tx.token) return
    if (navigator.share) {
      await navigator.share({ text: tx.token }).catch(() => {})
    } else {
      handleCopy(tx.token, 'token')
    }
  }, [tx.token, handleCopy])

  // ─── Delete ───
  const handleDelete = useCallback(async () => {
    const repo = new TransactionRepository()
    await repo.delete(tx.id)
    useAppStore.getState().triggerTxRefresh()
    onBack()
  }, [tx.id, onBack])

  // ─── Icon ───
  const icon = useMemo(() => {
    if (isSwap) return <ArrowRightLeft className="w-6 h-6" />
    if (isLightning) return <Zap className="w-6 h-6" />
    if (isReceive) return <ArrowDownLeft className="w-6 h-6" />
    return <ArrowUpRight className="w-6 h-6" />
  }, [isSwap, isLightning, isReceive])

  // ─── Type label ───
  const typeLabel = useMemo(() => {
    if (isSwap) return t('history.swap')
    if (isLightning && isReceive) return t('history.lightningReceive')
    if (isLightning && !isReceive) return t('history.lightningSend')
    if (isNutzap) return 'NutZap'
    if (isEcash && isReceive) return t('history.ecashReceive')
    return t('history.ecashSend')
  }, [isSwap, isLightning, isEcash, isNutzap, isReceive, t])

  // ─── Status ───
  const statusConfig = useMemo(() => {
    switch (tx.status) {
      case 'completed':
        return { label: t('history.completed'), color: 'text-card-green-dark', bg: 'bg-card-green-dark/10', border: 'border-card-green-dark/20' }
      case 'pending':
        return { label: t('history.pendingStatus'), color: 'text-badge-lightning-text', bg: 'bg-badge-lightning-bg', border: 'border-badge-lightning-text/20' }
      case 'failed':
        return { label: t('history.failedStatus'), color: 'text-accent-danger', bg: 'bg-accent-danger/10', border: 'border-accent-danger/20' }
    }
  }, [tx.status, t])

  // ─── Token state indicator ───
  const tokenStateConfig = useMemo(() => {
    if (!tx.tokenState) return null
    switch (tx.tokenState) {
      case 'unspent':
        return { label: t('txDetail.tokenState.unspent'), dot: 'bg-card-green-dark' }
      case 'pending':
        return { label: t('txDetail.tokenState.pending'), dot: 'bg-badge-lightning-text' }
      case 'spent':
        return { label: t('txDetail.tokenState.spent'), dot: 'bg-foreground-muted' }
      default:
        return { label: t('txDetail.tokenState.unknown'), dot: 'bg-foreground-muted/50' }
    }
  }, [tx.tokenState, t])

  // ─── Source label ───
  const sourceLabel = useMemo(() => {
    if (!tx.source || tx.source === 'unknown') return null
    return t(`txDetail.source.${tx.source}`)
  }, [tx.source, t])

  // ─── Helpers ───
  function formatDate(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function CopyableRow({ label, value, field }: { label: string; value: string; field: string }) {
    const truncated = value.length > 40 ? `${value.slice(0, 18)}...${value.slice(-18)}` : value
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-foreground-muted shrink-0">{label}</span>
        <button
          onClick={() => handleCopy(value, field)}
          className="flex items-center gap-1.5 text-xs font-mono text-foreground bg-primary/5 px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors min-w-0"
        >
          <span className="truncate">{truncated}</span>
          {copiedField === field ? (
            <Check className="w-3 h-3 text-card-green-dark shrink-0" />
          ) : (
            <Copy className="w-3 h-3 shrink-0" />
          )}
        </button>
      </div>
    )
  }

  function InfoRow({ label, value }: { label: string; value: string }) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-muted">{label}</span>
        <span className="text-xs font-medium text-foreground">{value}</span>
      </div>
    )
  }

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  return (
    <div className="w-full h-full flex flex-col bg-background pt-safe pb-safe">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-primary/5 rounded-full hover:bg-primary/10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <h1 className="text-sm font-bold text-foreground">{t('txDetail.title')}</h1>
        <div className="w-[44px]" /> {/* spacer */}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">

        {/* ── Hero: Amount + Status ── */}
        <div className="flex flex-col items-center gap-2 py-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
            isSwap ? 'bg-badge-lightning-bg text-accent-primary'
              : isReceive ? 'bg-card-green-dark/10 text-card-green-dark'
              : 'bg-accent-danger/10 text-accent-danger'
          }`}>
            {icon}
          </div>

          <span className={`text-3xl font-bold tracking-tight ${
            isReceive ? 'text-card-green-dark' : 'text-foreground'
          }`}>
            {isReceive ? '+' : isSwap ? '' : '-'}{formatSats(tx.amount)}
          </span>

          {tx.fiatAmount != null && tx.fiatCurrency && (
            <span className="text-sm text-foreground-muted">
              ≈ {tx.fiatAmount.toLocaleString(undefined, { style: 'currency', currency: tx.fiatCurrency })}
            </span>
          )}

          <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${statusConfig.bg} ${statusConfig.color} ${statusConfig.border}`}>
            {statusConfig.label}
          </span>
        </div>

        {/* ── Basic Info ── */}
        <div className="bg-white/50 rounded-2xl border border-white/60 p-4 space-y-3">
          <InfoRow label={t('txDetail.type')} value={typeLabel} />
          <InfoRow label={t('txDetail.time')} value={formatDate(tx.createdAt)} />
          {tx.completedAt && tx.completedAt !== tx.createdAt && (
            <InfoRow label={t('txDetail.completedAt')} value={formatDate(tx.completedAt)} />
          )}
          {tx.failedAt && (
            <InfoRow label={t('txDetail.failedAt')} value={formatDate(tx.failedAt)} />
          )}

          {/* Mint */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground-muted">{t('txDetail.mint')}</span>
            <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
              {getDisplayName(tx.mintUrl)}
            </span>
          </div>

          {/* Source */}
          {sourceLabel && (
            <InfoRow label={t('txDetail.source')} value={sourceLabel} />
          )}

          {/* Memo */}
          {tx.memo && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-foreground-muted shrink-0">{t('txDetail.memo')}</span>
              <span className="text-xs font-medium text-foreground text-right">{tx.memo}</span>
            </div>
          )}

          {/* Failure reason */}
          {tx.failureReason && tx.failureReason !== 'reclaimed' && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-foreground-muted shrink-0">{t('txDetail.failureReason')}</span>
              <span className="text-xs font-medium text-accent-danger text-right">{tx.failureReason}</span>
            </div>
          )}
        </div>

        {/* ── Type-specific section ── */}

        {/* Lightning Send */}
        {isLightning && !isReceive && (
          <div className="bg-white/50 rounded-2xl border border-white/60 p-4 space-y-3">
            {typeof metadata?.destination === 'string' && (
              <CopyableRow label={t('txDetail.destination')} value={metadata.destination} field="destination" />
            )}
            {metadata?.fee != null && (
              <InfoRow label={t('txDetail.fee')} value={`${formatSats(Number(metadata.fee))}`} />
            )}
            {tx.preimage && (
              <CopyableRow label={t('txDetail.preimage')} value={tx.preimage} field="preimage" />
            )}
            {tx.bolt11 && (
              <CopyableRow label={t('txDetail.bolt11')} value={tx.bolt11} field="bolt11" />
            )}
          </div>
        )}

        {/* Lightning Receive */}
        {isLightning && isReceive && (
          <div className="bg-white/50 rounded-2xl border border-white/60 p-4 space-y-3">
            {tx.bolt11 && (
              <CopyableRow label={t('txDetail.bolt11')} value={tx.bolt11} field="bolt11" />
            )}
            {typeof metadata?.quoteId === 'string' && (
              <CopyableRow label={t('txDetail.quoteId')} value={metadata.quoteId} field="quoteId" />
            )}
          </div>
        )}

        {/* eCash Token Section (Send & Receive) */}
        {isEcash && tx.token && (
          <div className="bg-white/50 rounded-2xl border border-white/60 p-4 space-y-4">
            <span className="text-xs font-semibold text-foreground-muted">
              {isReceive ? t('txDetail.receivedToken') : t('txDetail.sentToken')}
            </span>

            {/* QR Code */}
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-xl shadow-sm">
                <QRCodeSVG value={tx.token} size={160} level="M" bgColor="#ffffff" fgColor="#1a1a1a" />
              </div>
            </div>

            {/* Token string (truncated) */}
            <button
              onClick={() => handleCopy(tx.token!, 'token')}
              className="w-full flex items-center gap-2 px-3 py-2 bg-primary/5 rounded-xl hover:bg-primary/10 transition-colors"
            >
              <span className="flex-1 text-[11px] font-mono text-foreground-muted truncate text-left">
                {tx.token}
              </span>
              {copiedField === 'token' ? (
                <Check className="w-3.5 h-3.5 text-card-green-dark shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
              )}
            </button>

            {/* Send-only: Token state + lifecycle actions */}
            {!isReceive && (
              <>
                {/* Token state */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground-muted">{t('txDetail.tokenState')}</span>
                  <div className="flex items-center gap-2">
                    {tokenStateConfig && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <span className={`w-2 h-2 rounded-full ${tokenStateConfig.dot}`} />
                        {tokenStateConfig.label}
                      </span>
                    )}
                    <button
                      onClick={handleCheckTokenState}
                      disabled={isCheckingState}
                      className="flex items-center gap-1 text-[11px] font-medium text-accent-primary bg-accent-primary/10 px-2 py-1 rounded-lg hover:bg-accent-primary/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isCheckingState ? 'animate-spin' : ''}`} />
                      {isCheckingState ? t('txDetail.checking') : t('txDetail.checkState')}
                    </button>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  {typeof navigator.share === 'function' && (
                    <button
                      onClick={handleShare}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-primary/5 hover:bg-primary/10 transition-colors text-foreground"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      {t('txDetail.share')}
                    </button>
                  )}

                  {/* Reclaim: show when unspent OR when state hasn't been checked yet (not spent) */}
                  {tx.tokenState !== 'spent' && tx.status !== 'failed' && (
                    <button
                      onClick={handleCheckAndReclaim}
                      disabled={isReclaiming || isCheckingState}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-card-green-dark/10 hover:bg-card-green-dark/20 transition-colors text-card-green-dark disabled:opacity-50"
                    >
                      {isReclaiming || isCheckingState ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Undo2 className="w-3.5 h-3.5" />
                      )}
                      {isReclaiming ? t('txDetail.reclaiming') : t('txDetail.cancelSend')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Swap */}
        {isSwap && metadata && (
          <div className="bg-white/50 rounded-2xl border border-white/60 p-4 space-y-3">
            {typeof metadata.fromMintUrl === 'string' && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground-muted">{t('txDetail.fromMint')}</span>
                <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
                  {getDisplayName(metadata.fromMintUrl)}
                </span>
              </div>
            )}
            <div className="flex justify-center">
              <ArrowRightLeft className="w-4 h-4 text-foreground-muted" />
            </div>
            {typeof metadata.toMintUrl === 'string' && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground-muted">{t('txDetail.toMint')}</span>
                <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
                  {getDisplayName(metadata.toMintUrl)}
                </span>
              </div>
            )}
            {metadata.fee != null && (
              <InfoRow label={t('txDetail.fee')} value={`${formatSats(Number(metadata.fee))}`} />
            )}
          </div>
        )}

        {/* ── Kiosk Order Items ── */}
        {kioskOrder && (
          <div className="bg-white/50 rounded-2xl border border-white/60 p-4 space-y-3">
            <span className="text-xs font-bold text-foreground">{t('txDetail.orderItems')}</span>
            <div className="space-y-2">
              {kioskOrder.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-xs text-foreground">
                    {item.productName} <span className="text-foreground-muted">x{item.quantity}</span>
                  </span>
                  <span className="text-xs font-mono font-medium text-foreground">
                    {formatSats(item.subtotal)}
                  </span>
                </div>
              ))}
              <div className="h-px bg-[#F3F0EC]" />
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">{t('txDetail.orderTotal')}</span>
                <span className="text-xs font-mono font-bold text-foreground">
                  {formatSats(kioskOrder.total)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Expandable Details ── */}
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="w-full flex items-center justify-between py-2 px-1 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors"
        >
          <span>{t('txDetail.details')}</span>
          {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showDetails && (
          <div className="bg-white/50 rounded-2xl border border-white/60 p-4 space-y-3">
            <CopyableRow label={t('txDetail.txId')} value={tx.id} field="txId" />
            <CopyableRow label={t('txDetail.mint')} value={tx.mintUrl} field="mintUrl" />
          </div>
        )}

        {/* ── Delete ── */}
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center justify-center gap-2 py-3 text-xs font-medium text-accent-danger hover:bg-accent-danger/5 rounded-xl transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('txDetail.delete')}
          </button>
        ) : (
          <div className="bg-accent-danger/5 rounded-2xl border border-accent-danger/20 p-4 space-y-3">
            <p className="text-xs font-medium text-accent-danger">{t('txDetail.deleteConfirm')}</p>
            <p className="text-[11px] text-foreground-muted">{t('txDetail.deleteWarning')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-primary/5 text-foreground"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-accent-danger text-white"
              >
                {t('txDetail.delete')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
