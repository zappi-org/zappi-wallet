import { useCallback } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, changeLanguage, getCurrentLanguage } from '@/i18n'
import { cn } from '@/ui/primitives/utils'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

interface LanguageSettingPageProps {
  onBack: () => void
}

export function LanguageSettingPage({ onBack }: LanguageSettingPageProps) {
  const { t } = useTranslation()
  const currentLang = getCurrentLanguage()

  const handleSelect = useCallback((code: string) => {
    changeLanguage(code as 'ko' | 'en' | 'es' | 'ja' | 'id')
    onBack()
  }, [onBack])

  return (
    <SettingsDetailPage title={t('settings.language')} onBack={onBack}>
      <div className="py-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleSelect(lang.code)}
            className={cn(
              'w-full px-5 py-3.5 flex items-center justify-between text-left',
              currentLang === lang.code
                ? 'bg-foreground/[0.04]'
                : 'active:bg-background-hover',
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-body font-medium">{lang.nativeName}</span>
              <span className="text-caption text-foreground-muted">{lang.name}</span>
            </div>
            {currentLang === lang.code && (
              <Check className="w-4 h-4 text-accent-primary shrink-0" />
            )}
          </button>
        ))}
      </div>
    </SettingsDetailPage>
  )
}
