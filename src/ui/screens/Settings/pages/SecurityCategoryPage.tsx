import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { isPasskeySupported, isPasskeyRegistered } from '@/services/passkey'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { SettingsRow } from '../components/SettingsRow'
import { Switch } from '@/ui/components/common/Switch'
import type { SettingsPage } from '../SettingsScreen'

interface SecurityCategoryPageProps {
  onBack: () => void
  onNavigate: (page: SettingsPage) => void
  onFaceIdToggle: (enabled: boolean) => void
  onOpenPinChange: () => void
}

export function SecurityCategoryPage({
  onBack,
  onNavigate,
  onFaceIdToggle,
  onOpenPinChange,
}: SecurityCategoryPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)

  const passkeySupported = isPasskeySupported()
  const passkeyEnabled = isPasskeyRegistered()
  const autoLockEnabled = settings.autoLockEnabled
  const autoLockValue = autoLockEnabled ? `${settings.autoLockTimeoutMinutes}${t('common.min')}` : null

  return (
    <SettingsDetailPage title={t('settings.security')} onBack={onBack}>
      <div className="pt-2">
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.changePin')}
            onPress={onOpenPinChange}
          />
          {passkeySupported && (
            <div className="px-4 py-3.5 flex items-center justify-between min-h-[52px]">
              <span className="text-body font-medium">{t('settings.faceIdTouchId')}</span>
              <Switch checked={passkeyEnabled} onChange={onFaceIdToggle} />
            </div>
          )}
          <SettingsRow
            label={t('settings.autoLock')}
            value={autoLockValue}
            onPress={() => onNavigate('autoLock')}
          />
        </div>
      </div>
    </SettingsDetailPage>
  )
}
