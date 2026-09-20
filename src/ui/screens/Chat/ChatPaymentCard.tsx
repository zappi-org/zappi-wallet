import { useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface ChatPaymentCardProps {
  kind: 'send' | 'request'
  amount?: number
  unit?: string
  outgoing: boolean
  peerName?: string
  status:
    | 'notice'
    | 'pending'
    | 'unclaimed'
    | 'settled'
    | 'failed'
    | 'expired'
    | 'cancelled'
    | 'unknown'
  expiresAt?: number
  onPay?: () => Promise<void>
  onDetails?: () => void
  description?: string
}

export function ChatPaymentCard({
  kind,
  amount,
  unit = 'sat',
  outgoing,
  peerName,
  status,
  expiresAt,
  onPay,
  onDetails,
  description,
}: ChatPaymentCardProps) {
  const { t, i18n } = useTranslation()
  const [paying, setPaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const [clock, setClock] = useState(() => Date.now())
  const request = kind === 'request'
  const title = peerName
    ? t(
        `chat.paymentCard.${
          request
            ? outgoing
              ? 'requestTo'
              : 'requestFrom'
            : outgoing
            ? 'paymentTo'
            : 'paymentFrom'
        }`,
        { name: peerName }
      )
    : t(
        `chat.paymentCard.${
          request
            ? 'requestTitle'
            : !outgoing && status === 'notice'
            ? 'noticeTitle'
            : 'sendTitle'
        }`
      )
  const validAmount =
    amount !== undefined && Number.isFinite(amount) && amount >= 0
  const validExpiry =
    expiresAt !== undefined &&
    Number.isFinite(expiresAt) &&
    Math.abs(expiresAt) <= 8.64e15
  useEffect(() => {
    if (!validExpiry) return
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(remaining, 2_147_483_647)
    )
    return () => clearTimeout(timer)
  }, [expiresAt, validExpiry, clock])
  const openRequest =
    request &&
    (status === 'unknown' ||
      status === 'notice' ||
      (status === 'pending' && !onDetails))
  const state =
    openRequest && validExpiry && expiresAt <= Date.now() ? 'expired' : status
  const stateKey =
    state === 'settled'
      ? request
        ? outgoing
          ? 'received'
          : 'paid'
        : outgoing
        ? 'sent'
        : 'received'
      : state === 'unclaimed'
      ? 'awaitingReceipt'
      : state === 'pending'
      ? request && !onDetails && (outgoing || onPay)
        ? outgoing
          ? 'awaitingIncoming'
          : 'awaitingPayment'
        : 'processing'
      : state === 'unknown' && request && !outgoing && onPay
      ? 'awaitingPayment'
      : state === 'unknown' && !request && !outgoing
      ? 'notice'
      : state
  const actionable =
    request &&
    !outgoing &&
    !!onPay &&
    !onDetails &&
    (state === 'pending' || state === 'unknown' || state === 'notice')
  const Icon =
    state === 'settled' ? Check : request ? ArrowDownLeft : ArrowUpRight
  const buttonClass =
    'min-h-11 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50'

  async function pay() {
    if (!onPay || pending.current) return
    if (validExpiry && expiresAt <= Date.now()) {
      setClock(Date.now())
      return
    }
    pending.current = true
    setPaying(true)
    setFailed(false)
    try {
      await onPay()
    } catch {
      setFailed(true)
    } finally {
      pending.current = false
      setPaying(false)
    }
  }

  return (
    <section
      aria-label={title}
      className="w-60 max-w-full overflow-hidden rounded-2xl border border-border/60 bg-background-card text-foreground"
    >
      <div className="px-4 pb-4 pt-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand">
          <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
          <h3 className="min-w-0 break-words [overflow-wrap:anywhere]">
            {title}
          </h3>
        </div>
        <p className="mt-3 break-words text-[1.625rem] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere]">
          {validAmount
            ? amount.toLocaleString(i18n.language, { maximumFractionDigits: 8 })
            : t('chat.paymentCard.openAmount')}
          {validAmount && (
            <span className="ml-1.5 text-sm font-medium text-foreground-muted">
              {unit}
            </span>
          )}
        </p>
        <p
          className={`mt-3 flex items-center gap-1.5 text-sm ${
            state === 'failed' ? 'text-accent-danger' : 'text-foreground-muted'
          }`}
        >
          {state === 'pending' && <Clock aria-hidden="true" size={14} />}
          {t(`chat.paymentCard.${stateKey}`)}
        </p>
        {description && (
          <p className="mt-2 break-words text-xs leading-relaxed text-foreground-muted [overflow-wrap:anywhere]">
            {description}
          </p>
        )}
        {validExpiry && (openRequest || state === 'expired') && (
          <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
            {t('chat.paymentCard.expires')}{' '}
            <time dateTime={new Date(expiresAt).toISOString()}>
              {new Date(expiresAt).toLocaleString(i18n.language, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </time>
          </p>
        )}
      </div>
      {(actionable || onDetails || failed) && (
        <div className="space-y-2 border-t border-border/50 px-3 py-3">
          {actionable && (
            <button
              type="button"
              disabled={paying}
              aria-busy={paying}
              onClick={() => {
                void pay()
              }}
              className={`${buttonClass} bg-brand text-white hover:bg-brand/90 active:bg-brand/80`}
            >
              {t(paying ? 'chat.paymentCard.opening' : 'chat.sendMoney')}
            </button>
          )}
          {onDetails && (
            <button
              type="button"
              onClick={onDetails}
              className={`${buttonClass} bg-background text-foreground hover:bg-border/40 active:bg-border/60`}
            >
              {t('chat.paymentCard.details')}
            </button>
          )}
          {failed && (
            <p
              role="alert"
              className="px-1 text-xs leading-relaxed text-accent-danger"
            >
              {t('chat.paymentCard.openFailed')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
