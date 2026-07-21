import { useCallback } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { cn } from '@/ui/lib/utils'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

interface AutoLockSettingPageProps {
  onBack: () => void
  saveSettings: (updates: Record<string, unknown>) => Promise<void>
}

const TIMEOUT_OPTIONS = [1, 3, 5, 10, 15, 30]

export function AutoLockSettingPage({ onBack, saveSettings }: AutoLockSettingPageProps) {
  const { t } = useTranslation()
  const autoLockTimeout = useAppStore((s) => s.settings.autoLockTimeoutMinutes)

  const handleSelectTimeout = useCallback((minutes: number) => {
    saveSettings({ autoLockTimeoutMinutes: minutes })
  }, [saveSettings])

  return (
    <SettingsDetailPage title={t('settings.autoLock')} onBack={onBack}>
      {/* Auto-lock is always on — the only choice is the idle timeout. */}
      <p className="px-5 pt-4 pb-1 text-caption text-foreground-muted">
        {t('settings.autoLockDescription')}
      </p>

      <div className="py-2">
        <p className="px-5 pt-3 pb-2 text-caption font-medium uppercase tracking-wide text-foreground-muted">
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
    </SettingsDetailPage>
  )
}
