import { useCallback } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { cn } from '@/ui/primitives/utils'
import { Switch } from '@/ui/components/common/Switch'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

interface AutoLockSettingPageProps {
  onBack: () => void
  saveSettings: (updates: Record<string, unknown>) => Promise<void>
}

const TIMEOUT_OPTIONS = [1, 3, 5, 10, 15, 30]

export function AutoLockSettingPage({ onBack, saveSettings }: AutoLockSettingPageProps) {
  const { t } = useTranslation()
  const autoLockEnabled = useAppStore((s) => s.settings.autoLockEnabled)
  const autoLockTimeout = useAppStore((s) => s.settings.autoLockTimeoutMinutes)

  const handleToggle = useCallback((enabled: boolean) => {
    saveSettings({ autoLockEnabled: enabled })
  }, [saveSettings])

  const handleSelectTimeout = useCallback((minutes: number) => {
    saveSettings({ autoLockTimeoutMinutes: minutes })
  }, [saveSettings])

  return (
    <SettingsDetailPage title={t('settings.autoLock')} onBack={onBack}>
      {/* Toggle */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-border">
        <div>
          <p className="text-body font-medium">{t('settings.autoLock')}</p>
          <p className="text-caption text-foreground-muted mt-0.5">{t('settings.autoLockDescription')}</p>
        </div>
        <Switch checked={autoLockEnabled} onChange={handleToggle} />
      </div>

      {/* Timeout options (only when enabled) */}
      {autoLockEnabled && (
        <div className="py-2">
          <p className="px-5 pt-4 pb-2 text-caption font-medium uppercase tracking-wide text-foreground-muted">
            {t('settings.autoLockTimeout')}
          </p>
          {TIMEOUT_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              onClick={() => handleSelectTimeout(minutes)}
              className={cn(
                'w-full px-5 py-3.5 flex items-center justify-between text-left',
                autoLockTimeout === minutes
                  ? 'bg-foreground/[0.04]'
                  : 'active:bg-background-hover',
              )}
            >
              <span className="text-body font-medium">{minutes}{t('common.min')}</span>
              {autoLockTimeout === minutes && (
                <Check className="w-4 h-4 text-accent-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </SettingsDetailPage>
  )
}
