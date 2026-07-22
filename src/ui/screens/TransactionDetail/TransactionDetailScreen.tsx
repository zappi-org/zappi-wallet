/**
 * Unified transaction detail — one surface for every settled or pending
 * transaction, including the ecash-token lifecycle that used to live in
 * TokenDetailScreen. Receipt paper on top (same visual as the send/receive
 * flows), a horizontal state-machine bar in the middle, actions below.
 */
import { txSourceKey } from '@/ui/utils/tx-source'
import { toNumber } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import { getDisplayFee, getTotalCost, getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'
import { PaymentReceipt, type PaymentReceiptRow } from '@/ui/components/payment/PaymentReceipt'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useReclaim } from '@/ui/hooks/use-reclaim'
import { useReclaimFees } from '@/ui/hooks/useReclaimFees'
import { useTransactionMgmt } from '@/ui/hooks/use-transaction-mgmt'
import { shareOrCopyText } from '@/ui/utils/share'
import { formatTransactionFiat, useFormatFiat, useFormatSats, truncateStr } from '@/utils/format'
import { cn } from '@/ui/lib/utils'
import sendSuccessImg from '@/assets/send-success.png'
import { VARIANT_HEX, resolveMintColor } from '@/ui/components/wallet/MintCard'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  MoreVertical,
  QrCode,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TxStateBar } from './TxStateBar'
import { TokenQrModal } from './TokenQrModal'
import { buildTxStateTrack } from './tx-state-machine'
import { ReclaimSheet } from '@/ui/screens/Token/components/ReclaimSheet'
import type { PendingTokenView } from '@/ui/screens/Token/types'
import { EasterEggScreen } from '@/ui/screens/Token/EasterEggScreen'
import { TokenSpentByRecipientError } from '@/core/errors/reclaim'

export interface TransactionDetailScreenProps {
  transaction: Transaction
  onBack: () => void
  mintUrls?: string[]
}

// ─── Screen ───

export default function TransactionDetailScreen({
  transaction: initialTx,
  onBack,
  mintUrls = [],
}: TransactionDetailScreenProps) {
  const { reclaim } = useReclaim()
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const settingsMints = useAppStore((s) => s.settings.mints)
  const mintColors = useAppStore((s) => s.settings.mintColors)
  const txMgmt = useTransactionMgmt()
  const [tx, setTx] = useState(initialTx)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showReclaimSheet, setShowReclaimSheet] = useState(false)
  const [showEgg, setShowEgg] = useState(false)
  const eggTaps = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const addToast = useAppStore((s) => s.addToast)

  const txType = getTransactionType(tx)
  const meta = getTxMeta(tx)
  const amountSats = toNumber(tx.amount)
  const displayFee = getDisplayFee(tx)
  const feeSats = displayFee ? toNumber(displayFee) : 0
  const isReceive = tx.direction === 'receive'
  const isSwap = txType === 'swap'
  const isLightning = txType === 'lightning'
  const isEcashToken = txType === 'ecash-token'
  const isEcash = txType === 'ecash' || isEcashToken
  const isNutzap = txType === 'nutzap'
  const metadata = tx.metadata as Record<string, unknown> | undefined
  const isReclaimed = isEcashToken && !!meta.reclaimedFrom

  // The exact gate the old screen used — failed/deleted/spent sends must never
  // offer bearer actions or reclaim.
  const showUnclaimedCard =
    isEcash && !isReceive && !!meta.token && tx.outcome === 'unclaimed'
    && meta.tokenState !== 'spent' && tx.status !== 'failed'

  const feeQuoteIds = useMemo(() => (showUnclaimedCard ? [tx.id] : []), [showUnclaimedCard, tx.id])
  const { fees: reclaimFees, isLoading: reclaimFeeLoading, retry: retryReclaimFee } = useReclaimFees(feeQuoteIds)
  const reclaimFee = reclaimFees.get(tx.id)

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

  const kioskOrder = useMemo(() => {
    if (metadata?.type !== 'kiosk_order') return null
    return metadata as {
      type: 'kiosk_order'
      items: Array<{ productName: string; price: number; quantity: number; subtotal: number }>
      itemCount: number
      total: number
    }
  }, [metadata])

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

  // Chips are bearer-token territory; the invoice gets a QR affordance on its
  // own row inside the folded details instead.
  const [qrMode, setQrMode] = useState<null | 'token' | 'invoice'>(null)

  const handleShareToken = useCallback(async () => {
    if (!meta.token) return
    await shareOrCopyText(meta.token, () => {
      addToast({ type: 'success', message: t('txDetail.copied'), duration: 1500 })
    })
  }, [meta.token, addToast, t])

  // ─── Reclaim (via fee-quoted sheet) ───
  const handleConfirmReclaim = useCallback(async () => {
    try {
      const result = await reclaim(tx.id)
      // The service persisted the truth (incl. metadata.reclaimFee) — re-read
      // it so the receipt's fee rows appear now, not on the next open.
      const fresh = await txMgmt.getById(tx.id).catch(() => null)
      if (fresh) {
        setTx(fresh)
      } else if (!result.success) {
        if (result.error instanceof TokenSpentByRecipientError) {
          // Recipient beat us — the service settled it as claimed.
          setTx((prev) => ({ ...prev, status: 'settled', outcome: 'claimed', completedAt: Date.now() }))
        }
        // other errors toast inside the hook
      } else {
        setTx((prev) => ({ ...prev, status: 'settled', outcome: 'reclaimed', completedAt: Date.now() }))
      }
    } catch (err) {
      console.error('[TxDetail] Check & reclaim failed:', err)
      addToast({ type: 'error', message: t('txDetail.reclaimFailed'), duration: 3000 })
    }
  }, [tx.id, reclaim, txMgmt, addToast, t])

  const reclaimSheetTokens = useMemo<PendingTokenView[]>(
    () => [{
      id: tx.id,
      createdAt: tx.createdAt,
      amount: amountSats,
      memo: tx.memo ?? '',
      mintUrl: tx.accountId,
      tokenString: meta.token,
      reclaimFee,
    }],
    [tx.id, tx.createdAt, tx.accountId, tx.memo, amountSats, meta.token, reclaimFee],
  )

  const handleDelete = useCallback(async () => {
    await txMgmt.delete(tx.id)
    useAppStore.getState().triggerTxRefresh()
    onBack()
  }, [tx.id, onBack, txMgmt])

  const handleEggTap = useCallback(() => {
    eggTaps.current += 1
    if (eggTaps.current >= 10) {
      eggTaps.current = 0
      setShowEgg(true)
    }
  }, [])

  // ─── Labels ───
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

  const sourceLabel = useMemo(() => {
    if (!meta.source || meta.source === 'unknown') return null
    if (['zappi-pos', 'zappi-kiosk', 'zappi-api'].includes(meta.source) && typeof metadata?.storeName === 'string') {
      return metadata.storeName
    }
    return t(txSourceKey(meta.source))
  }, [meta.source, metadata, t])

  const formatDate = useCallback((ts: number) => {
    return new Date(ts).toLocaleString(i18n.language, {
      month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }, [i18n.language])

  // ─── Receipt assembly ───
  const track = useMemo(() => buildTxStateTrack(tx), [tx])
  const fiatLine = formatTransactionFiat(tx.displaySnapshot, amountSats, formatFiat)

  // Row order and vocabulary mirror the receipts the flows actually print
  // (SendCompleteStep / DirectReceiptStep / ReceiveReceiptStep) — the detail
  // is the archived copy of the same paper, plus type/time archive rows.
  const isBearerCreate = isEcashToken && !isReceive && tx.intent !== 'request-pay'
  // Mockup content, receipt skin: the mint row shows the mint's face —
  // its icon (or card color dot) + the custom name, nothing else.
  const mintNode = useCallback((url: string) => {
    const alias = getDisplayName(url)
    const iconUrl = getIconUrl(url)
    const { variant, customColor } = resolveMintColor(url, settingsMints.indexOf(url), mintColors)
    const dotColor = customColor || VARIANT_HEX[variant] || '#515AC0'
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 align-middle">
        {iconUrl ? (
          <img src={iconUrl} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
        )}
        <span className="truncate font-semibold">{alias}</span>
      </span>
    )
  }, [getDisplayName, getIconUrl, settingsMints, mintColors])

  const receiptRows = useMemo<PaymentReceiptRow[]>(() => {
    const rows: PaymentReceiptRow[] = []
    if (isReceive) {
      rows.push({
        label: t('receive.receipt.method'),
        value: isLightning ? t('receive.receipt.methodLightning') : t('receive.receipt.methodEcash'),
      })
      rows.push({ label: t('receive.receipt.toMint'), value: getDisplayName(tx.accountId), valueNode: mintNode(tx.accountId), strong: true })
      if (tx.memo) rows.push({ label: t('receive.receipt.memo'), value: tx.memo })
      if (feeSats > 0) rows.push({ label: t('txDetail.fee'), value: formatSats(feeSats) })
    } else if (isSwap) {
      rows.push({ label: t('txDetail.type'), value: typeLabel })
      rows.push({
        label: t('txDetail.fromMint'),
        value: getDisplayName(meta.fromMintUrl ?? tx.accountId),
        valueNode: mintNode(meta.fromMintUrl ?? tx.accountId),
      })
      if (meta.toMintUrl) rows.push({ label: t('txDetail.toMint'), value: getDisplayName(meta.toMintUrl), valueNode: mintNode(meta.toMintUrl), strong: true })
      if (feeSats > 0) rows.push({ label: t('txDetail.fee'), value: formatSats(feeSats) })
      if (tx.memo) rows.push({ label: t('send.confirm.memo'), value: tx.memo })
    } else if (isBearerCreate) {
      // Mockup order: 메모 → 유형 → 출금 민트
      if (tx.memo) rows.push({ label: t('send.confirm.memo'), value: tx.memo })
      rows.push({ label: t('txDetail.type'), value: typeLabel })
      rows.push({ label: t('send.confirm.sourceMint'), value: getDisplayName(tx.accountId), valueNode: mintNode(tx.accountId), strong: true })
      if (tx.outcome === 'reclaimed') {
        // Only the persisted reclaim fee may wear these labels — tx.fee is the
        // creation fee, and legacy rows without one print nothing over lying.
        const reclaimFeeSats = typeof metadata?.reclaimFee === 'number' ? metadata.reclaimFee : undefined
        if (reclaimFeeSats != null) {
          rows.push({ label: t('token.reclaim.summaryFee'), value: formatSats(reclaimFeeSats) })
          rows.push({ label: t('token.reclaim.summaryNet'), value: formatSats(Math.max(0, amountSats - reclaimFeeSats)), strong: true })
        }
      } else if (displayFee) {
        // The swap fee is exact from creation — the flow receipt printed it,
        // the archive matches, zero included.
        rows.push({ label: t('send.confirm.fee'), value: formatSats(feeSats) })
        rows.push({ label: t('send.confirm.total'), value: formatSats(toNumber(getTotalCost(tx))), strong: true })
      }
    } else {
      if (meta.destination) rows.push({ label: t('send.receipt.recipient'), value: truncateStr(meta.destination) })
      rows.push({ label: t('txDetail.type'), value: typeLabel })
      rows.push({ label: t('send.confirm.sourceMint'), value: getDisplayName(tx.accountId), valueNode: mintNode(tx.accountId) })
      // A known zero fee still prints — the flow receipt shows it, the archive must match.
      if (displayFee) {
        rows.push({
          label: t(tx.status === 'settled' ? 'send.confirm.fee' : 'send.confirm.estimatedFee'),
          value: formatSats(feeSats),
        })
        rows.push({ label: t('send.confirm.total'), value: formatSats(toNumber(getTotalCost(tx))), strong: true })
      }
      if (tx.memo) rows.push({ label: t('send.confirm.memo'), value: tx.memo })
    }
    if (sourceLabel) rows.push({ label: t('txDetail.source'), value: sourceLabel })
    if (kioskOrder) {
      kioskOrder.items.forEach((item) => {
        rows.push({ label: `${item.productName} ×${item.quantity}`, value: formatSats(item.subtotal) })
      })
      rows.push({ label: t('txDetail.orderTotal'), value: formatSats(kioskOrder.total), strong: true })
    }
    if (typeof metadata?.failureReason === 'string' && metadata.failureReason !== 'reclaimed') {
      rows.push({ label: t('txDetail.failureReason'), value: metadata.failureReason })
    }
    // No time row — the state bar carries per-state times and the bottom
    // line carries the date, so a row here would be the third clock.
    return rows
  }, [tx, meta, metadata, isSwap, isLightning, isReceive, isBearerCreate, amountSats, typeLabel, sourceLabel, kioskOrder, feeSats, displayFee, mintNode, getDisplayName, formatSats, t])

  const receiptStatus = tx.status === 'settled' ? 'done' : 'pending'
  const receiptTitle = isReceive ? t('receive.receipt.title') : t('send.receipt.title')
  const doneRight = isReceive
    ? t('receive.receipt.completed')
    : tx.outcome === 'reclaimed'
      ? t('txDetail.state.reclaimed')
      : isSwap
        ? t('history.completed')
        : t('send.receipt.completed')
  // Date rides the bottom status line (mirroring doneLine) — never a row.
  const statusLine = `${formatDate(tx.createdAt)} · ${
    tx.status === 'failed'
      ? t('history.failedStatus')
      : isLightning && !isReceive
        ? t('send.receipt.settling')
        : t('history.pendingStatus')
  }`
  // Flow receipts print the amount unsigned — direction reads from the title.
  const amountLine = formatSats(amountSats)

  // Long, copyable values live below the paper, folded by default.
  const detailEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; value: string }> = [
      { key: 'txId', label: t('txDetail.txId'), value: tx.id },
    ]
    // No destination entry here — the paper's 받는이 row owns that value, and
    // the full invoice below already carries the copyable payment target.
    if (meta.preimage) entries.push({ key: 'preimage', label: t('txDetail.preimage'), value: meta.preimage })
    if (meta.bolt11) entries.push({ key: 'bolt11', label: t('txDetail.bolt11'), value: meta.bolt11 })
    if (typeof metadata?.quoteId === 'string') {
      entries.push({ key: 'quoteId', label: t('txDetail.quoteId'), value: metadata.quoteId })
    }
    return entries
  }, [tx.id, meta, metadata, t])

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
        {/* Reclaimable money must be reclaimed, not deleted — the menu hides. */}
        {!showUnclaimedCard && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
              aria-label={t('home.seeAll')}
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
        )}
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-app">
        {/* ── Receipt paper — everything the archive knows lives ON the paper ── */}
        <div className="pt-2 pb-5">
          <PaymentReceipt
            status={receiptStatus}
            title={receiptTitle}
            amount={amountLine}
            fiat={fiatLine}
            rows={receiptRows}
            statusLine={receiptStatus === 'pending' ? statusLine : undefined}
            doneLine={
              receiptStatus === 'done'
                ? { left: formatDate(tx.completedAt ?? tx.createdAt), right: doneRight }
                : undefined
            }
            stampSrc={receiptStatus === 'done' ? sendSuccessImg : undefined}
            extra={
              <>
                <TxStateBar track={track} t={t} locale={i18n.language} framed={false} />
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
                            {/* The invoice earns its QR right beside its copy button. */}
                            {entry.key === 'bolt11' && (
                              <button
                                onClick={() => setQrMode('invoice')}
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
                        <p className="text-overline font-mono text-foreground-muted break-all leading-relaxed">
                          {entry.value}
                        </p>
                      </div>
                    ))}
                    {meta.token && (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-caption text-foreground-muted">{t('txDetail.viewRawToken')}</span>
                          <button
                            onClick={() => handleCopy(meta.token!, 'rawToken')}
                            className="w-9 h-9 flex items-center justify-center rounded-lg active:bg-foreground/[0.06]"
                            aria-label={t('common.copy')}
                          >
                            {copiedField === 'rawToken' ? <Check className="w-4 h-4 text-accent-success" /> : <Copy className="w-4 h-4 text-foreground-muted" />}
                          </button>
                        </div>
                        <p
                          onClick={handleEggTap}
                          className="text-overline font-mono text-foreground-muted break-all leading-relaxed line-clamp-4 select-none"
                        >
                          {meta.token}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            }
          />
        </div>

        <div className="px-5 flex flex-col gap-3">

          {/* ── Bearer-token actions — a spent token's QR is inert, and
              re-copy stays useful ── */}
          {!!meta.token && (
            <div className="flex gap-2">
              <button
                onClick={() => setQrMode('token')}
                className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-full bg-background-card border border-border/60 text-caption font-semibold text-foreground active:scale-[0.98] transition-transform"
              >
                <QrCode className="w-4 h-4" strokeWidth={1.8} /> QR
              </button>
              <button
                onClick={() => handleCopy(meta.token!, 'token')}
                className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-full bg-background-card border border-border/60 text-caption font-semibold text-foreground active:scale-[0.98] transition-transform"
              >
                {copiedField === 'token' ? <Check className="w-4 h-4 text-accent-success" strokeWidth={1.8} /> : <Copy className="w-4 h-4" strokeWidth={1.8} />}
                {t('common.copy')}
              </button>
              <button
                onClick={handleShareToken}
                className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-full bg-background-card border border-border/60 text-caption font-semibold text-foreground active:scale-[0.98] transition-transform"
              >
                <Share2 className="w-4 h-4" strokeWidth={1.8} /> {t('txDetail.share')}
              </button>
            </div>
          )}

          {/* ── Reclaim CTA ── */}
          {showUnclaimedCard && (
            <button
              onClick={() => setShowReclaimSheet(true)}
              className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand text-body font-bold text-white shadow-lg shadow-brand/25 active:scale-[0.98] transition-transform"
            >
              <Undo2 className="w-4 h-4" strokeWidth={2} />
              {typeof reclaimFee === 'number'
                ? t('txDetail.reclaimWithFee', { fee: formatSats(reclaimFee) })
                : reclaimFeeLoading
                  ? `${t('txDetail.reclaimAction')} · ${t('txDetail.reclaimQuoting')}`
                  : t('txDetail.reclaimAction')}
            </button>
          )}
        </div>

        <div className="h-8" />
      </div>

      {/* Token / invoice QR modal — only bearer payloads veil */}
      {(meta.token || meta.bolt11) && (
        <TokenQrModal
          isOpen={qrMode !== null}
          token={(qrMode === 'invoice' ? meta.bolt11 : meta.token) ?? ''}
          title={qrMode === 'invoice' ? t('txDetail.bolt11') : undefined}
          veil={qrMode !== 'invoice'}
          onClose={() => setQrMode(null)}
        />
      )}

      {/* Reclaim confirmation (fee-quoted) */}
      <ReclaimSheet
        isOpen={showReclaimSheet}
        onClose={() => setShowReclaimSheet(false)}
        tokens={reclaimSheetTokens}
        quoting={reclaimFeeLoading}
        onRetryFees={retryReclaimFee}
        onConfirm={handleConfirmReclaim}
      />

      {/* Raw-token easter egg — local overlay, no route */}
      {showEgg && (
        <div className="fixed inset-0 z-[130]">
          <EasterEggScreen onClose={() => setShowEgg(false)} />
        </div>
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
