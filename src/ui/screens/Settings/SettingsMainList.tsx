import { useCallback, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { User, Settings, Lock, Wallet, ChevronRight, Download, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'
import { ViewportDebugPanel } from '@/ui/components/debug/ViewportDebugPanel'
import { checkForAppUpdate, updateSW } from '@/registerSW'
import { appBuildInfo } from '@/ui/utils/app-build-info'
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

type UpdateCheckPhase = 'idle' | 'checking' | 'installing'

export function SettingsMainList({
  onNavigate,
  onOpenLogout,
}: SettingsMainListProps) {
  const { t } = useTranslation()
  const updateAvailable = useAppStore((s) => s.updateAvailable)
  const addToast = useAppStore((s) => s.addToast)
  const [updateCheckPhase, setUpdateCheckPhase] = useState<UpdateCheckPhase>('idle')
  const viewportDebugTapCountRef = useRef(0)
  const [showViewportDebug, setShowViewportDebug] = useState(false)
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

  const handleVersionTap = useCallback(() => {
    viewportDebugTapCountRef.current += 1
    if (viewportDebugTapCountRef.current >= 5) {
      viewportDebugTapCountRef.current = 0
      setShowViewportDebug(true)
    }
  }, [])

  return (
    <div className="flex-1 overflow-y-auto pb-6">
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
        <button
          type="button"
          onClick={handleVersionTap}
          className="mx-auto mt-4 block text-center text-overline font-medium text-foreground-muted/50 uppercase tracking-widest"
        >
          {t('settings.version', { version: appBuildInfo.displayVersion })}
        </button>
        <Button variant="destructive" size="lg" onClick={onOpenLogout} className="w-full mt-8">
          {t('settings.logout')}
        </Button>
      </div>
      {showViewportDebug && (
        <ViewportDebugPanel onClose={() => setShowViewportDebug(false)} />
      )}
    </div>
  )
}
