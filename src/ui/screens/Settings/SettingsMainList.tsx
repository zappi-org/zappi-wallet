import type { LucideIcon } from 'lucide-react'
import { User, Settings, Lock, Wallet, ChevronRight, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'
import { updateSW } from '@/registerSW'
import type { SettingsPage } from './SettingsScreen'

interface SettingsMainListProps {
  onNavigate: (page: SettingsPage) => void
  onOpenLogout: () => void
}

const categories: { Icon: LucideIcon; titleKey: string; descKey: string; page: SettingsPage }[] = [
  { Icon: User, titleKey: 'settings.profile', descKey: 'settings.profileDesc', page: 'category-profile' },
  { Icon: Settings, titleKey: 'settings.preferences', descKey: 'settings.preferencesDesc', page: 'category-preferences' },
  { Icon: Lock, titleKey: 'settings.security', descKey: 'settings.securityDesc', page: 'category-security' },
  { Icon: Wallet, titleKey: 'settings.walletManagement', descKey: 'settings.walletManagementDesc', page: 'category-wallet' },
]

export function SettingsMainList({
  onNavigate,
  onOpenLogout,
}: SettingsMainListProps) {
  const { t } = useTranslation()
  const updateAvailable = useAppStore((s) => s.updateAvailable)

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      {/* Update banner */}
      {updateAvailable && (
        <button
          onClick={() => updateSW()}
          className="w-full bg-brand text-white px-4 py-3 font-semibold text-caption flex items-center justify-center gap-2 active:opacity-80"
        >
          <Download className="w-4 h-4" />
          {t('settings.updateAvailable')}
        </button>
      )}

      {/* Category cards */}
      <div className="px-4 pt-4 flex flex-col gap-2.5">
        {categories.map(({ Icon, titleKey, descKey, page }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className="w-full bg-background-card rounded-card px-4 py-4 flex items-center gap-3.5 active:scale-[0.98] active:opacity-80 transition-all text-left"
          >
            <Icon className="w-[22px] h-[22px] text-foreground-muted shrink-0" strokeWidth={1.8} />
            <div className="flex-1 min-w-0">
              <p className="text-body font-semibold text-foreground">{t(titleKey)}</p>
              <p className="text-caption text-foreground-muted mt-0.5 truncate">{t(descKey)}</p>
            </div>
            <ChevronRight className="w-[18px] h-[18px] text-foreground-subtle shrink-0" strokeWidth={1.8} />
          </button>
        ))}
      </div>

      {/* Logout */}
      <div className="px-4 pt-8">
        <Button variant="destructive" size="lg" onClick={onOpenLogout} className="w-full">
          {t('settings.logout')}
        </Button>
        <p className="text-center mt-4 text-overline font-medium text-foreground-muted/50 uppercase tracking-widest">
          {t('settings.version')}
        </p>
      </div>
    </div>
  )
}
