import { useTranslation } from 'react-i18next'
import { TEST_IDS } from '@/ui/lib/test-ids'
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
            testId={TEST_IDS.settings.pageRow}
            testItemId="my-address"
            onPress={() => onOpenMyAddress?.()}
          />
          <SettingsRow
            label={t('actions.analytics')}
            testId={TEST_IDS.settings.pageRow}
            testItemId="analytics"
            onPress={() => onAnalytics?.()}
          />
        </div>
      </div>
    </SettingsDetailPage>
  )
}