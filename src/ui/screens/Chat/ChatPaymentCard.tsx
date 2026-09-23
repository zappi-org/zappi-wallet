import { useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/ui/components/common/Modal'

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
  paymentSubmitted?: boolean
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
  paymentSubmitted = false,
}: ChatPaymentCardProps) {
  const { t, i18n } = useTranslation()
  const [paying, setPaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const payButton = useRef<HTMLButtonElement>(null)
  const [showSubmitted, setShowSubmitted] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const language = i18n.resolvedLanguage ?? i18n.language
  const textWrapping = language.toLowerCase().startsWith('ja')
    ? 'break-normal [overflow-wrap:anywhere]'
    : 'break-keep [overflow-wrap:anywhere]'
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
  const submitted =
    paymentSubmitted || status === 'settled' || status === 'unclaimed' ||
    (status === 'pending' && !!onDetails)
  const openRequest = request && !submitted
  const state =
    openRequest && validExpiry && expiresAt <= Date.now() ? 'expired' : status
  const stateKey = request
    ? state === 'expired' || state === 'cancelled' ? state : outgoing ? 'requested' : 'receivedRequest'
    : state === 'settled' ? outgoing ? 'sent' : 'received'
    : state === 'unclaimed' ? outgoing ? 'awaitingReceipt' : 'notice'
    : state === 'pending' ? outgoing ? 'processing' : 'receiving'
    : state === 'notice' || state === 'unknown' ? outgoing ? 'checkingPayment' : 'notice'
    : state === 'failed' && !outgoing ? 'receiveFailed' : state
  const actionable = request && !outgoing && (
    submitted || (!!onPay && ['pending', 'unknown', 'notice'].includes(state))
  )
  const Icon = request ? ArrowDownLeft : state === 'settled' ? Check : ArrowUpRight
  const formattedAmount = validAmount
    ? `${amount.toLocaleString(i18n.language, { maximumFractionDigits: 8 })} ${unit}`
    : t('chat.paymentCard.openAmount')
  const closeSubmitted = () => {
    setShowSubmitted(false)
    payButton.current?.focus()
  }
  const buttonClass =
    'min-h-11 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50'

  async function pay() {
    if (submitted) {
      setShowSubmitted(true)
      return
    }
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
    <>
      <section
        aria-label={title}
        lang={language}
        className={`w-64 max-w-full overflow-hidden rounded-2xl border border-border/60 bg-background-card text-foreground ${textWrapping}`}
      >
        <div className={`flex min-h-20 items-center gap-3 px-4 py-5 ${request || outgoing ? 'bg-brand text-white' : 'bg-foreground/[0.04] text-foreground'}`}>
          <Icon aria-hidden="true" className="shrink-0" size={18} strokeWidth={1.8} />
          <h3 className="min-w-0 text-base font-semibold">
            {title}
          </h3>
        </div>
        <div className="px-4 py-4">
          <p className="text-[1.625rem] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere]">
            {validAmount
              ? amount.toLocaleString(i18n.language, { maximumFractionDigits: 8 })
              : t('chat.paymentCard.openAmount')}
            {validAmount && (
              <span className="ml-1.5 inline-block text-sm font-medium text-foreground-muted">
                {unit}
              </span>
            )}
          </p>
          <p
            className={`mt-3 flex items-center gap-1.5 text-sm ${
              state === 'failed' ? 'text-accent-danger' : 'text-foreground-muted'
            }`}
          >
            {!request && state === 'pending' && <Clock aria-hidden="true" className="shrink-0" size={14} />}
            <span className="min-w-0">{t(`chat.paymentCard.${stateKey}`)}</span>
          </p>
          {description && (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground-muted">
              {description}
            </p>
          )}
          {validExpiry && request && (
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
        {(actionable || (!request && onDetails) || failed) && (
          <div className="space-y-2 border-t border-border/50 px-3 py-3">
            {actionable && (
              <button
                ref={payButton}
                type="button"
                disabled={paying}
                aria-busy={paying}
                onClick={() => {
                  void pay()
                }}
                className={`${buttonClass} bg-brand text-white hover:bg-brand/90 active:bg-brand/80`}
              >
                {t(paying ? 'chat.paymentCard.opening' : 'chat.paymentCard.pay')}
              </button>
            )}
            {!request && onDetails && (
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
      {showSubmitted && (
        <Modal isOpen onClose={closeSubmitted} title={formattedAmount} showCloseButton={false} size="sm">
          <p lang={language} className={`py-3 text-center text-base text-foreground-muted ${textWrapping}`}>
            {t('chat.paymentCard.alreadySent')}
          </p>
          <button type="button" onClick={closeSubmitted} className={`${buttonClass} mt-4 bg-brand text-white`}>
            {t('common.confirm')}
          </button>
        </Modal>
      )}
    </>
  )
}
