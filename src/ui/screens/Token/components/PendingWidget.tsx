import { useTranslation } from 'react-i18next'
import { useFormatSats } from '@/utils/format'

export interface PendingWidgetProps {
  count: number
  totalAmount: number
  onViewAll?: () => void
}

export function PendingWidget({ count, totalAmount, onViewAll }: PendingWidgetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  return (
    <div className="flex items-center justify-between rounded-card bg-brand px-5 py-4 shadow-lg shadow-brand/25">
      <div className="flex flex-col gap-1">
        <span className="text-caption text-white/70">
          {t('token.pendingWidget.title')}
        </span>
        <span className="text-title-sm font-semibold text-white">
          {t('token.pendingWidget.summary', { count, total: formatSats(totalAmount) })}
        </span>
      </div>
      <button
        type="button"
        onClick={onViewAll}
        className="text-body text-white/80 hover:text-white transition-colors"
      >
        {t('token.pendingWidget.viewAll')}
      </button>
    </div>
  )
}
