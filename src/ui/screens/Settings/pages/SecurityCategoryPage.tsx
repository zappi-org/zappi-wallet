import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { isPasskeySupported, isPasskeyRegistered } from '@/ui/services/passkey'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { SettingsRow } from '../components/SettingsRow'
import { Switch } from '@/ui/components/common/Switch'

interface SecurityCategoryPageProps {
  onBack: () => void
  onFaceIdToggle: (enabled: boolean) => void
  onOpenPinChange: () => void
  saveSettings: (updates: Record<string, unknown>) => Promise<void>
}

export function SecurityCategoryPage({
  onBack,
  onFaceIdToggle,
  onOpenPinChange,
  saveSettings,
}: SecurityCategoryPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)

  const passkeySupported = isPasskeySupported()
  const passkeyEnabled = isPasskeyRegistered()

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
          <div className="px-4 py-3.5 flex items-center justify-between min-h-[52px]">
            <span className="text-body font-medium">{t('settings.autoLock')}</span>
            <Switch
              checked={settings.autoLockEnabled ?? true}
              onChange={(enabled) => { void saveSettings({ autoLockEnabled: enabled }) }}
            />
          </div>
        </div>
      </div>
    </SettingsDetailPage>
  )
}
