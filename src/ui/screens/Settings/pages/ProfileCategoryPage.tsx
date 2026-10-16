import { useTranslation } from 'react-i18next'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { SettingsRow } from '../components/SettingsRow'

interface ProfileCategoryPageProps {
  onBack: () => void
  onOpenMyAddress?: () => void
  onAnalytics?: () => void
}

export function ProfileCategoryPage({
  onBack,
  onOpenMyAddress,
  onAnalytics,
}: ProfileCategoryPageProps) {
  const { t } = useTranslation()

  return (
    <SettingsDetailPage title={t('settings.profile')} onBack={onBack}>
      <div className="pt-2">
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.myAddress')}
            value={t('settings.myAddressDesc')}
            onPress={() => onOpenMyAddress?.()}
          />
          <SettingsRow
            label={t('actions.analytics')}
            onPress={() => onAnalytics?.()}
          />
        </div>
      </div>
    </SettingsDetailPage>
  )
}