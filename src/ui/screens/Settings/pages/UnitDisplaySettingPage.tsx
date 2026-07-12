import { useCallback } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { cn } from '@/ui/lib/utils'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

interface UnitDisplaySettingPageProps {
  onBack: () => void
  saveSettings: (updates: Record<string, unknown>) => Promise<void>
}

const UNIT_OPTIONS = [
  { value: 'sats', label: 'sats' },
  { value: 'bip177', label: '₿ (BIP-177)' },
] as const

export function UnitDisplaySettingPage({ onBack, saveSettings }: UnitDisplaySettingPageProps) {
  const { t } = useTranslation()
  const currentUnit = useAppStore((s) => s.settings.unitDisplay ?? 'bip177')

  const handleSelect = useCallback((value: string) => {
    saveSettings({ unitDisplay: value })
    onBack()
  }, [saveSettings, onBack])

  return (
    <SettingsDetailPage title={t('settings.unitDisplay')} onBack={onBack}>
      <div className="py-2">
        {UNIT_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => handleSelect(option.value)}
            className={cn(
              'w-full px-5 py-3.5 flex items-center justify-between text-left',
              currentUnit === option.value
                ? 'bg-foreground/[0.04]'
                : 'active:bg-background-hover',
            )}
          >
            <span className="text-body font-medium">{option.label}</span>
            {currentUnit === option.value && (
              <Check className="w-4 h-4 text-accent-primary shrink-0" />
            )}
          </button>
        ))}
      </div>
    </SettingsDetailPage>
  )
}
