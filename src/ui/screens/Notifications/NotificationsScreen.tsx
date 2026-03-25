
import { ArrowLeft, Bell, Zap, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Transaction } from '@/core/types'
import { useFormatSats } from '@/utils/format'

export interface Notification {
  id: string
  type: 'receive' | 'security' | 'system'
  title: string
  message: string
  time: number // timestamp
  read: boolean
}

export interface NotificationsScreenProps {
  onBack: () => void
  notifications?: Notification[]
  transactions?: Transaction[] // Can generate notifications from transactions
  onMarkRead?: (id: string) => void
  onClearAll?: () => void
}

function formatTimeAgo(
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string
): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return t('notifications.justNow')
  if (minutes < 60) return t('notifications.minAgo', { count: minutes })
  if (hours < 24) return hours === 1
    ? t('notifications.hourAgo', { count: hours })
    : t('notifications.hoursAgo', { count: hours })
  if (days < 7) return days === 1
    ? t('notifications.dayAgo', { count: days })
    : t('notifications.daysAgo', { count: days })

  const dateLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : locale === 'es' ? 'es-ES' : locale === 'id' ? 'id-ID' : 'en-US'
  return new Date(timestamp).toLocaleDateString(dateLocale, {
    month: 'short',
    day: 'numeric',
  })
}

function generateNotificationsFromTransactions(
  transactions: Transaction[],
  t: (key: string, options?: Record<string, unknown>) => string,
  formatSats: (amount: number) => string
): Notification[] {
  // Get recent completed transactions (last 7 days)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recentTxs = transactions
    .filter((tx) => tx.createdAt >= weekAgo && tx.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)

  return recentTxs.map((tx) => ({
    id: `tx-${tx.id}`,
    type: 'receive' as const,
    title: tx.direction === 'receive'
      ? t('notifications.paymentReceived')
      : t('notifications.paymentSent'),
    message:
      tx.direction === 'receive'
        ? t('notifications.youReceived', { amount: formatSats(tx.amount) })
        : t('notifications.youSent', { amount: formatSats(tx.amount) }),
    time: tx.createdAt,
    read: true, // Mark transaction notifications as read
  }))
}

export function NotificationsScreen({
  onBack,
  notifications: propNotifications,
  transactions = [],
  onMarkRead,
  onClearAll,
}: NotificationsScreenProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()

  // Generate notifications from transactions if not provided
  const notifications =
    propNotifications || generateNotificationsFromTransactions(transactions, t, formatSats)

  const unreadCount = notifications.filter((n) => !n.read).length

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'receive':
        return Zap
      case 'security':
        return ShieldAlert
      case 'system':
        return CheckCircle2
      default:
        return Bell
    }
  }

  const getIconStyle = (type: Notification['type']) => {
    switch (type) {
      case 'receive':
        return 'bg-accent-primary/20 text-accent-primary'
      case 'security':
        return 'bg-accent-danger/20 text-accent-danger'
      case 'system':
        return 'bg-primary/10 text-foreground'
      default:
        return 'bg-primary/10 text-foreground'
    }
  }

  return (
    <div className="h-dvh bg-background text-foreground flex flex-col font-sans relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="flex items-center gap-2 px-5 h-14 shrink-0 relative z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="text-subtitle flex-1">{t('notifications.title')}</h2>
        <div className="ml-auto bg-primary/10 p-2 rounded-full relative">
          <Bell className="w-4 h-4 text-foreground" />
          {unreadCount > 0 && (
            <div className="absolute top-2 right-2.5 w-2 h-2 bg-accent-danger rounded-full border border-background" />
          )}
        </div>
      </header>

      {/* Clear All Button */}
      {notifications.length > 0 && onClearAll && (
        <div className="px-4 pt-3">
          <button
            onClick={onClearAll}
            className="text-overline font-bold text-foreground-muted hover:text-foreground transition-colors"
          >
            {t('notifications.clearAll')}
          </button>
        </div>
      )}

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-32">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-background-card rounded-full flex items-center justify-center mb-4">
              <Bell className="w-6 h-6 text-foreground-muted" />
            </div>
            <h3 className="text-body font-bold text-foreground mb-2">
              {t('notifications.noNotifications')}
            </h3>
            <p className="text-foreground-muted text-label">
              {t('notifications.allCaughtUp')}
            </p>
          </div>
        ) : (
          <>
            {notifications.map((notif) => {
              const Icon = getIcon(notif.type)
              return (
                <div
                  key={notif.id}
                  onClick={() => onMarkRead?.(notif.id)}
                  className={cn(
                    'animate-fadeIn',
                    'p-4 rounded-2xl border transition-colors cursor-pointer flex gap-3 min-h-[44px]',
                    notif.read
                      ? 'bg-background-card border-primary/5'
                      : 'bg-background-card border-primary/10'
                  )}
                >
                  <div
                    className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                      getIconStyle(notif.type)
                    )}
                  >
                    <Icon
                      className={cn(
                        'w-5 h-5',
                        notif.type === 'receive' && 'fill-current'
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h3
                        className={cn(
                          'text-body font-medium',
                          notif.read ? 'text-foreground-muted' : 'text-foreground'
                        )}
                      >
                        {notif.title}
                      </h3>
                      <span className="text-label text-foreground-muted/60 shrink-0 ml-2">
                        {formatTimeAgo(notif.time, t, i18n.language)}
                      </span>
                    </div>
                    <p className="text-caption text-foreground-muted leading-relaxed">
                      {notif.message}
                    </p>
                  </div>
                  {!notif.read && (
                    <div className="w-2 h-2 rounded-full bg-accent-danger mt-2 shrink-0" />
                  )}
                </div>
              )
            })}

            <div className="text-center py-6">
              <span className="text-overline font-bold text-foreground-muted/40 uppercase tracking-widest">
                {t('notifications.endOfNotifications')}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default NotificationsScreen
