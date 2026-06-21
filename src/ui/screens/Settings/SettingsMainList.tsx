import { useCallback, useState, type ElementType } from 'react'
import { User, Lock, LifeBuoy, ChevronRight, Download, RefreshCw } from 'lucide-react'
import { Cog6ToothIcon, WalletIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'
import { checkForAppUpdate, updateSW } from '@/registerSW'
import { appBuildInfo } from '@/ui/utils/app-build-info'
import { ENABLE_LIGHTNING_ADDRESS_SETTINGS } from '@/ui/config/feature-flags'
import type { SettingsPage } from './SettingsScreen'

interface SettingsMainListProps {
  onNavigate: (page: SettingsPage) => void
  onOpenLogout: () => void
}

const categories: { Icon: ElementType; titleKey: string; descKey: string; page: SettingsPage }[] = [
  {
    Icon: User,
    titleKey: 'settings.profile',
    descKey: ENABLE_LIGHTNING_ADDRESS_SETTINGS ? 'settings.profileDesc' : 'settings.profileDescHiddenLightning',
    page: 'category-profile',
  },
  { Icon: Cog6ToothIcon, titleKey: 'settings.preferences', descKey: 'settings.preferencesDesc', page: 'category-preferences' },
  { Icon: Lock, titleKey: 'settings.security', descKey: 'settings.securityDesc', page: 'category-security' },
  { Icon: WalletIcon, titleKey: 'settings.walletManagement', descKey: 'settings.walletManagementDesc', page: 'category-wallet' },
  { Icon: LifeBuoy, titleKey: 'settings.customerSupport', descKey: 'settings.customerSupportDesc', page: 'support' },
]

type UpdateCheckPhase = 'idle' | 'checking' | 'installing'

export function SettingsMainList({
  onNavigate,
  onOpenLogout,
}: SettingsMainListProps) {
  const { t } = useTranslation()
  const updateAvailable = useAppStore((s) => s.updateAvailable)
  const supportUnreadCount = useAppStore((s) => s.supportUnreadCount)
  const addToast = useAppStore((s) => s.addToast)
  const [updateCheckPhase, setUpdateCheckPhase] = useState<UpdateCheckPhase>('idle')
  const isCheckingUpdate = updateCheckPhase !== 'idle'

  const handleCheckUpdate = useCallback(async () => {
    if (isCheckingUpdate) return

    setUpdateCheckPhase('checking')
    try {
      const result = await checkForAppUpdate({
        onInstalling: () => setUpdateCheckPhase('installing'),
      })
      if (result === 'current') {
        addToast({ type: 'success', message: t('settings.updateCurrent') })
      } else if (result === 'unavailable') {
        addToast({ type: 'warning', message: t('settings.updateCheckUnavailable') })
      }
    } catch (error) {
      console.error('Failed to check for app update:', error)
      addToast({ type: 'error', message: t('settings.updateCheckFailed') })
    } finally {
      setUpdateCheckPhase('idle')
    }
  }, [addToast, isCheckingUpdate, t])

  const updateCheckLabel = updateCheckPhase === 'installing'
    ? t('settings.updateInstalling')
    : updateCheckPhase === 'checking'
      ? t('settings.updateChecking')
      : t('settings.checkForUpdates')

  return (
    <div className="flex-1 overflow-y-auto pb-app-nav">
      {/* Category cards */}
      <div className="px-4 pt-4 flex flex-col gap-2.5">
        {categories.map(({ Icon, titleKey, descKey, page }) => {
          const badge = page === 'support' ? supportUnreadCount : 0
          return (
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
              {badge > 0 && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent-danger text-white text-label font-semibold flex items-center justify-center leading-none">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
              <ChevronRight className="w-[18px] h-[18px] text-foreground-subtle shrink-0" strokeWidth={1.8} />
            </button>
          )
        })}
      </div>

      {/* App maintenance */}
      <div className="px-4 pt-8">
        {updateAvailable ? (
          <Button
            variant="brand"
            size="lg"
            onClick={() => updateSW()}
            icon={<Download className="size-4" />}
            className="w-full"
          >
            {t('settings.updateAvailable')}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="lg"
            onClick={handleCheckUpdate}
            loading={isCheckingUpdate}
            icon={<RefreshCw className="size-4" />}
            className="w-full"
          >
            {updateCheckLabel}
          </Button>
        )}
        <p className="text-center mt-4 text-overline font-medium text-foreground-muted/50 uppercase tracking-widest">
          {t('settings.version', { version: appBuildInfo.displayVersion })}
        </p>
        <Button variant="destructive" size="lg" onClick={onOpenLogout} className="w-full mt-8">
          {t('settings.logout')}
        </Button>
      </div>
    </div>
  )
}
