import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Copy,
  QrCode,
  Share2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '@/i18n'
import { useAppStore } from '@/store'
import { formatFiatAmount, useFormatSats } from '@/utils/format'
import { translateError } from '@/ui/utils/error-i18n'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { TokenRawSheet } from './components/TokenRawSheet'
import { TokenQrSheet } from './components/TokenQrSheet'
import { ReclaimSheet } from './components/ReclaimSheet'
import { formatDetailDateLine } from './token-view-model'
import type { MockPendingToken, TokenDetailData, TokenDetailStatus } from './types'

const STATUS_ICON: Record<TokenDetailStatus, LucideIcon | null> = {
  pending: null, // rendered as orange dot instead
  registered: CheckCircle2,
  consumed: ArrowUpRight,
  reclaimed: Undo2,
}

export interface TokenDetailScreenProps {
  data: TokenDetailData
  onClose: () => void
  /** Open QR preview for this token. */
  onShowQr?: (token: TokenDetailData) => void
  /** Share via native share sheet / clipboard fallback. */
  onShare?: (token: TokenDetailData) => Promise<void> | void
  /** Pending: reclaim action. */
  onReclaim?: (token: TokenDetailData) => Promise<void> | void
  /** Called when user taps the raw-token box 10 times — navigate to easter egg page. */
  onTriggerEasterEgg?: () => void
  /**
   * When provided, renders "내역 삭제" inside the raw sheet. Caller should
   * handle confirmation and perform `transactionMgmt.delete(txId)`.
   */
  onDeleteHistory?: (token: TokenDetailData) => Promise<void> | void
}

const DATE_SUFFIX_KEY: Record<TokenDetailStatus, TranslationKey> = {
  pending: 'token.detail.dateLine.pending',
  registered: 'token.detail.dateLine.registered',
  consumed: 'token.detail.dateLine.consumed',
  reclaimed: 'token.detail.dateLine.reclaimed',
}

export function TokenDetailScreen({
  data,
  onClose,
  onShowQr,
  onShare,
  onReclaim,
  onTriggerEasterEgg,
  onDeleteHistory,
}: TokenDetailScreenProps) {
  console.log('[TokenDetailScreen] RENDERING', data.id, data.status)
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((s) => s.addToast)
  const showFiat = useAppStore((s) => s.settings.showFiatConversion ?? true)

  const [rawOpen, setRawOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [reclaimOpen, setReclaimOpen] = useState(false)

  const isPending = data.status === 'pending'
  const timestamp = data.statusAt ?? data.createdAt
  const dateLine = formatDetailDateLine(t, timestamp, DATE_SUFFIX_KEY[data.status])
  const fiatLabel = showFiat && data.fiat
    ? formatFiatAmount(data.fiat.amount, data.fiat.currency)
    : null

  const actionLabel = useMemo(
    () => (isPending ? t('token.detail.action.forward') : t('token.detail.action.confirm')),
    [isPending, t],
  )

  const handleCopy = useCallback(async () => {
    const text = data.tokenString
    if (!text) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        addToast({ type: 'success', message: t('token.reclaimable.copiedToClipboard') })
      }
    } catch {
      /* clipboard blocked — silent */
    }
  }, [addToast, data.tokenString, t])

  const handleShare = useCallback(() => {
    if (onShare) void onShare(data)
  }, [onShare, data])

  const handleQr = useCallback(() => {
    if (onShowQr) {
      onShowQr(data)
      return
    }
    setQrOpen(true)
  }, [onShowQr, data])

  const openReclaim = useCallback(() => setReclaimOpen(true), [])
  const confirmReclaim = useCallback(async () => {
    if (!onReclaim) return
    try {
      await onReclaim(data)
      setReclaimOpen(false)
    } catch (error) {
      addToast({ type: 'error', message: translateError(error, t) })
    }
  }, [onReclaim, data, addToast, t])

  const reclaimTokens: MockPendingToken[] = useMemo(
    () => [
      {
        id: data.id,
        createdAt: data.createdAt,
        amount: data.amount,
        memo: data.memo ?? '',
        mintUrl: data.mintUrl,
        tokenString: data.tokenString,
        reclaimFee: data.reclaimFee,
      },
    ],
    [data],
  )

  const mintLabelKey = `token.detail.mintLabel.${data.status}` as const
  const typeValueKey = `token.detail.typeValue.${data.status}` as const
  const titleKey = `token.detail.title.${data.status}` as const
  const StatusIcon = STATUS_ICON[data.status]

  return (
    <div className="relative h-full bg-background text-foreground font-primary flex flex-col pt-safe">
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="absolute top-[54px] right-[35px] z-10 w-11 h-11 -m-2 p-2 flex items-center justify-center rounded-lg text-foreground hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
      >
        <X className="w-8 h-8" strokeWidth={1.6} />
      </button>

      <div className="flex-1 overflow-y-auto pt-[110px] pb-4">
        <div className="px-[18px]">
          <div className="flex items-center gap-2">
            {isPending && data.unread && (
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: '#F9C416' }}
                aria-label={t('token.detail.unread')}
              />
            )}
            {StatusIcon && (
              <StatusIcon className="w-5 h-5 shrink-0 text-foreground" strokeWidth={2} />
            )}
            <h1 className="text-amount-lg font-bold leading-tight text-brand-900">
              {t(titleKey)}
            </h1>
          </div>

          <p className="mt-4 text-title-sm leading-[1.4] text-brand-900 whitespace-pre-line">
            {dateLine}
          </p>

          <section className="mt-10">
            <h2 className="text-title-sm font-bold text-brand-900">
              {t('token.detail.amountLabel')}
            </h2>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-title-sm leading-none text-foreground">
                {formatSats(data.amount)}
              </span>
              {fiatLabel && (
                <span className="text-subtitle font-medium text-[#606060]">
                  ({fiatLabel})
                </span>
              )}
            </div>
            {data.fee !== undefined && (
              <p className="mt-1 text-caption font-medium text-[#606060]">
                {t('token.detail.feeLine', { fee: formatSats(data.fee) })}
              </p>
            )}
          </section>

          <section className="mt-10">
            <h2 className="text-title-sm font-bold text-brand-900">
              {t('token.detail.memoLabel')}
            </h2>
            <p className="mt-1 text-amount leading-normal text-foreground break-words">
              {data.memo || t('token.detail.memoEmpty')}
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-title-sm font-bold text-brand-900">
              {t('token.detail.typeLabel')}
            </h2>
            <p className="mt-1 text-title-sm text-brand-900">
              {t(typeValueKey)}
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-title-sm font-bold text-brand-900">
              {t(mintLabelKey)}
            </h2>
            <div className="mt-1 flex items-center gap-3">
              <MintIcon
                iconUrl={data.mintIconUrl}
                imgSize="w-[26px] h-[26px]"
                className="w-[26px] h-[26px]"
              />
              <span className="text-subtitle font-medium text-brand-900">
                {data.mintAlias}
              </span>
              {data.mintName && (
                <span className="text-caption font-medium text-[#6C6C6C]">
                  {data.mintName}
                </span>
              )}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-title-sm font-bold text-brand-900">
              {actionLabel}
            </h2>
            <div className="mt-1 flex items-center justify-center gap-[37px]">
              <DetailActionButton
                icon={<QrCode className="w-3.5 h-3.5" strokeWidth={2} />}
                onClick={handleQr}
              >
                {t('token.detail.actions.qr')}
              </DetailActionButton>
              <DetailActionButton
                icon={<Copy className="w-3.5 h-3.5" strokeWidth={2} />}
                onClick={handleCopy}
              >
                {t('token.detail.actions.copy')}
              </DetailActionButton>
              <DetailActionButton
                icon={<Share2 className="w-3.5 h-3.5" strokeWidth={2} />}
                onClick={handleShare}
              >
                {t('token.detail.actions.share')}
              </DetailActionButton>
            </div>
            <div className="mt-8 flex justify-end">
              <button
                type="button"
                onClick={() => setRawOpen(true)}
                className="flex items-center gap-1 text-label text-brand-900 hover:underline"
              >
                <ChevronRight className="w-3 h-3" strokeWidth={2} />
                <span>{t('token.detail.actions.viewRaw')}</span>
              </button>
            </div>
          </section>

        </div>
      </div>

      {isPending && (
        <div
          className="shrink-0 px-[18px] pt-3 flex justify-center"
          style={{ paddingBottom: 'var(--app-bottom-padding)' }}
        >
          <button
            type="button"
            onClick={openReclaim}
            className="h-[35px] px-6 rounded-[25px] bg-background-card flex items-center gap-1.5 text-caption text-foreground active:scale-[0.98] transition-all"
            style={{ boxShadow: PLASTIC_SHADOW }}
          >
            <Undo2 className="w-4 h-4" strokeWidth={2} />
            <span>
              {t('token.detail.reclaimCta', {
                fee: formatSats(data.reclaimFee ?? 0),
              })}
            </span>
          </button>
        </div>
      )}

      <TokenRawSheet
        isOpen={rawOpen}
        onClose={() => setRawOpen(false)}
        tokenString={data.tokenString}
        amount={data.amount}
        mintName={data.mintName ?? data.mintUrl ?? data.mintAlias}
        unit={data.unit ?? 'sat'}
        receiveFee={data.fee ?? data.reclaimFee}
        onDelete={
          onDeleteHistory && !isPending
            ? async () => {
                await onDeleteHistory(data)
                setRawOpen(false)
                onClose()
              }
            : undefined
        }
        onTriggerEasterEgg={() => {
          setRawOpen(false)
          onTriggerEasterEgg?.()
        }}
      />

      <TokenQrSheet
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        tokenString={data.tokenString}
        amount={data.amount}
        memo={data.memo}
      />

      {isPending && (
        <ReclaimSheet
          isOpen={reclaimOpen}
          onClose={() => setReclaimOpen(false)}
          tokens={reclaimTokens}
          reclaimFeePerToken={data.reclaimFee ?? 2}
          onConfirm={confirmReclaim}
        />
      )}
    </div>
  )
}

const PLASTIC_SHADOW =
  '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)'

function DetailActionButton({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[38px] w-[87px] flex items-center justify-center gap-1 rounded-[25px] bg-background-card text-label text-brand-900 active:scale-[0.97] transition-transform"
      style={{ boxShadow: PLASTIC_SHADOW }}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

export default TokenDetailScreen
