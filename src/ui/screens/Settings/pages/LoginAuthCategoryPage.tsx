import { useTranslation } from 'react-i18next'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { SettingsRow } from '../components/SettingsRow'
import { TEST_IDS } from '@/ui/lib/test-ids'

interface LoginAuthCategoryPageProps {
  onBack: () => void
  onSigner?: () => void
}

/**
 * 로그인 & 인증 — external key/identity use: NIP-46 sessions now,
 * LNURL-auth / NIP-98 login history later.
 */
export function LoginAuthCategoryPage({ onBack, onSigner }: LoginAuthCategoryPageProps) {
  const { t } = useTranslation()

  return (
    <SettingsDetailPage title={t('settings.loginAuth')} onBack={onBack}>
      <div className="pt-2">
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.connectedApps')}
            testId={TEST_IDS.settings.signerEntry}
            onPress={() => onSigner?.()}
          />
        </div>
      </div>
    </SettingsDetailPage>
  )
}
