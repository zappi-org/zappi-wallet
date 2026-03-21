import { useTranslation } from 'react-i18next'

export type NetworkStatus = 'online' | 'offline' | 'syncing'

export interface StatusBadgeProps {
  status: NetworkStatus
  showLabel?: boolean
}

const statusColors: Record<NetworkStatus, string> = {
  online: 'bg-status-online',
  offline: 'bg-status-offline',
  syncing: 'bg-status-pending',
}

const statusLabelKeys: Record<NetworkStatus, string> = {
  online: 'common.online',
  offline: 'common.offline',
  syncing: 'common.syncing',
}

export function StatusBadge({ status, showLabel = false }: StatusBadgeProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`w-2 h-2 rounded-full ${statusColors[status]} ${
          status === 'syncing' ? 'animate-pulse' : ''
        }`}
      />
      {showLabel && (
        <span className="text-label text-foreground-muted">{t(statusLabelKeys[status])}</span>
      )}
    </div>
  )
}
