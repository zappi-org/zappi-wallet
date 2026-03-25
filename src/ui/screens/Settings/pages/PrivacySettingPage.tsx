import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { Switch } from '@/ui/components/common/Switch'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

interface PrivacySettingPageProps {
  onBack: () => void
  saveSettings: (updates: Record<string, unknown>) => Promise<void>
}

export function PrivacySettingPage({ onBack, saveSettings }: PrivacySettingPageProps) {
  const { t } = useTranslation()
  const senderPrivacyMode = useAppStore((s) => s.settings.senderPrivacyMode ?? false)

  const handleSenderToggle = useCallback((enabled: boolean) => {
    saveSettings({ senderPrivacyMode: enabled })
  }, [saveSettings])

  return (
    <SettingsDetailPage title={t('settings.privacy')} onBack={onBack}>
      {/* Sender privacy mode */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-border">
        <div className="flex-1 mr-3">
          <p className="text-body font-medium">{t('settings.senderPrivacyMode')}</p>
          <p className="text-caption text-foreground-muted mt-0.5">{t('settings.senderPrivacyModeDescription')}</p>
        </div>
        <Switch checked={senderPrivacyMode} onChange={handleSenderToggle} />
      </div>
    </SettingsDetailPage>
  )
}
