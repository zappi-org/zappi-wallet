import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { SettingsRow } from '../components/SettingsRow'

interface WalletCategoryPageProps {
  onBack: () => void
  onMintManagement?: () => void
  onRelayManagement?: () => void
  onOpenCurrentWalletRecovery: () => void
  onOpenExternalMnemonicRecovery: () => void
  /** Full relay re-sync (reinstall-grade full replay). */
  onFullResync?: () => void
  onOpenBackup: () => void
}

export function WalletCategoryPage({
  onBack,
  onMintManagement,
  onRelayManagement,
  onOpenCurrentWalletRecovery,
  onOpenExternalMnemonicRecovery,
  onFullResync,
  onOpenBackup,
}: WalletCategoryPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)

  return (
    <SettingsDetailPage title={t('settings.walletManagement')} onBack={onBack}>
      <div className="pt-2">
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.manageMints')}
            value={String(settings.mints.length)}
            onPress={() => onMintManagement?.()}
          />
          <SettingsRow
            label={t('settings.manageRelays')}
            value={String(settings.relays.length)}
            onPress={() => onRelayManagement?.()}
          />
          <SettingsRow
            label={t('settings.currentWalletRecovery')}
            onPress={onOpenCurrentWalletRecovery}
          />
          <SettingsRow
            label={t('settings.externalMnemonicRecovery')}
            onPress={onOpenExternalMnemonicRecovery}
          />
          {onFullResync && (
            <SettingsRow
              label={t('settings.fullResync')}
              onPress={onFullResync}
            />
          )}
          <SettingsRow
            label={t('settings.mnemonicBackup')}
            onPress={onOpenBackup}
          />
        </div>
      </div>
    </SettingsDetailPage>
  )
}
