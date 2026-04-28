import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useCrypto } from '@/ui/hooks/use-crypto'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { SettingsRow } from '../components/SettingsRow'
import type { SettingsPage } from '../SettingsScreen'

interface ProfileCategoryPageProps {
  onBack: () => void
  onNavigate: (page: SettingsPage) => void
  onRegisterLightningAddress: () => void
  isRegistering: boolean
  onAnalytics?: () => void
}

export function ProfileCategoryPage({
  onBack,
  onNavigate,
  onRegisterLightningAddress,
  isRegistering,
  onAnalytics,
}: ProfileCategoryPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const crypto = useCrypto()

  const npubDisplay = nostrPubkey ? crypto.encodeNpub(nostrPubkey) : null

  return (
    <SettingsDetailPage title={t('settings.profile')} onBack={onBack}>
      <div className="pt-2">
        <div className="bg-background-card">
          {npubDisplay && (
            <SettingsRow
              label="Nostr"
              value={npubDisplay}
              onPress={() => onNavigate('npubDetail')}
              truncateValue
            />
          )}
          {settings.lightningAddress ? (
            <SettingsRow
              label={t('settings.lightningAddress')}
              value={settings.lightningAddress}
              onPress={() => onNavigate('lightningDetail')}
              truncateValue
            />
          ) : (
            <SettingsRow
              label={t('settings.lightningAddress')}
              value={isRegistering ? t('settings.registeringLightningAddress') : t('settings.registerLightningAddress')}
              onPress={onRegisterLightningAddress}
            />
          )}
          <SettingsRow
            label={t('actions.analytics')}
            onPress={() => onAnalytics?.()}
          />
          <SettingsRow
            label={t('support.title')}
            onPress={() => onNavigate('support')}
          />
        </div>
      </div>
    </SettingsDetailPage>
  )
}
