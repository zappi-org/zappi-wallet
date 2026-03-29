import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { getCurrentLanguage, SUPPORTED_LANGUAGES } from '@/i18n'
import { FIAT_CURRENCY_MAP } from '@/utils/format'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { SettingsRow } from '../components/SettingsRow'
import type { SettingsPage } from '../SettingsScreen'

interface PreferencesCategoryPageProps {
  onBack: () => void
  onNavigate: (page: SettingsPage) => void
}

export function PreferencesCategoryPage({
  onBack,
  onNavigate,
}: PreferencesCategoryPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)

  const currentLang = getCurrentLanguage()
  const langName = SUPPORTED_LANGUAGES.find(l => l.code === currentLang)?.nativeName || 'English'
  const unitLabel = (settings.unitDisplay ?? 'bip177') === 'sats' ? 'sats' : '₿ (BIP-177)'
  const showFiat = settings.showFiatConversion ?? true
  const fiatValue = showFiat
    ? (() => {
        const code = settings.fiatCurrency ?? 'USD'
        const info = FIAT_CURRENCY_MAP.get(code)
        return info ? `${info.flag} ${info.symbol} ${code}` : code
      })()
    : null

  return (
    <SettingsDetailPage title={t('settings.preferences')} onBack={onBack}>
      <div className="pt-2">
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.language')}
            value={langName}
            onPress={() => onNavigate('language')}
          />
          <SettingsRow
            label={t('settings.unitDisplay')}
            value={unitLabel}
            onPress={() => onNavigate('unitDisplay')}
          />
          <SettingsRow
            label={t('settings.showFiatConversion')}
            value={fiatValue}
            onPress={() => onNavigate('fiat')}
          />
          <SettingsRow
            label={t('settings.privacy')}
            onPress={() => onNavigate('privacy')}
          />
        </div>
      </div>
    </SettingsDetailPage>
  )
}
