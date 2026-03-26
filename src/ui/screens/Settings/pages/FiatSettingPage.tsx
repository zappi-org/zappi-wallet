import { useState, useMemo, useCallback } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { FIAT_CURRENCIES } from '@/core/constants/fiat'
import { cn } from '@/components/ui/utils'
import { Switch } from '@/ui/components/common/Switch'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

interface FiatSettingPageProps {
  onBack: () => void
  saveSettings: (updates: Record<string, unknown>) => Promise<void>
}

export function FiatSettingPage({ onBack, saveSettings }: FiatSettingPageProps) {
  const { t } = useTranslation()
  const showFiat = useAppStore((s) => s.settings.showFiatConversion ?? true)
  const currentCurrency = useAppStore((s) => s.settings.fiatCurrency ?? 'USD')
  const [search, setSearch] = useState('')

  const handleToggle = useCallback((enabled: boolean) => {
    saveSettings({ showFiatConversion: enabled })
  }, [saveSettings])

  const handleSelect = useCallback((code: string) => {
    saveSettings({ fiatCurrency: code })
  }, [saveSettings])

  const sorted = useMemo(() => {
    let list = FIAT_CURRENCIES
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.symbol.toLowerCase().includes(q),
      )
    }
    return [...list].sort((a, b) => {
      if (a.code === currentCurrency) return -1
      if (b.code === currentCurrency) return 1
      return a.name.localeCompare(b.name)
    })
  }, [search, currentCurrency])

  return (
    <SettingsDetailPage title={t('settings.showFiatConversion')} onBack={onBack} noScroll={showFiat}>
      {/* Toggle */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-border shrink-0">
        <p className="text-body font-medium">{t('settings.showFiatConversion')}</p>
        <Switch checked={showFiat} onChange={handleToggle} />
      </div>

      {/* Currency list (only when enabled) */}
      {showFiat && (
        <>
          <div className="px-5 py-3 shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="w-full px-3 py-2.5 rounded-xl bg-background border border-border text-caption focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex-1 overflow-y-auto pb-safe">
            {sorted.map((currency) => (
              <button
                key={currency.code}
                onClick={() => handleSelect(currency.code)}
                className={cn(
                  'w-full px-5 py-3.5 flex items-center justify-between text-left',
                  currentCurrency === currency.code
                    ? 'bg-foreground/[0.04]'
                    : 'active:bg-background-hover',
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-body w-6 text-center">{currency.flag}</span>
                  <div>
                    <span className="text-caption font-medium">{currency.code}</span>
                    <span className="text-caption text-foreground-muted ml-2">{currency.name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-label font-medium text-foreground-muted">{currency.symbol}</span>
                  {currentCurrency === currency.code && (
                    <Check className="w-4 h-4 text-accent-primary" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </SettingsDetailPage>
  )
}
