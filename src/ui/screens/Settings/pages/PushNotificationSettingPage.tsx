import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore, type Toast } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { Switch } from '@/ui/components/common/Switch'
import { Button } from '@/ui/components/common/Button'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import type { PushDevTools } from '@/core/ports/driven/push-dev-tools.port'

interface PushNotificationSettingPageProps {
  onBack: () => void
  saveSettings: (updates: Record<string, unknown>) => Promise<void>
  onRelayManagement?: () => void
}

export function PushNotificationSettingPage({
  onBack,
  saveSettings,
  onRelayManagement,
}: PushNotificationSettingPageProps) {
  const { t } = useTranslation()
  const registry = useServiceRegistry()
  const gateway = registry.pushNotifications
  const relays = useAppStore((s) => s.settings.relays)
  const enabled = useAppStore((s) => s.settings.pushNotificationsEnabled ?? false)
  const hideInForeground = useAppStore((s) => s.settings.hideNotificationInForeground ?? true)
  const addToast = useAppStore((s) => s.addToast)

  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState(() => gateway.permission())

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (busy) return
      setBusy(true)
      try {
        if (next) {
          const granted = await gateway.enable(relays)
          setPermission(gateway.permission())
          if (!granted) {
            addToast({
              type: 'error',
              message: t('settings.pushNotificationsDenied'),
              duration: 4000,
            })
            return
          }
          await saveSettings({ pushNotificationsEnabled: true })
          addToast({
            type: 'success',
            message: t('settings.pushNotificationsOn'),
            duration: 3000,
          })
        } else {
          await gateway.disable()
          setPermission(gateway.permission())
          await saveSettings({ pushNotificationsEnabled: false })
        }
      } catch (error) {
        console.warn('[push] toggle failed:', error)
        addToast({ type: 'error', message: t('lock.errorOccurred'), duration: 4000 })
      } finally {
        setBusy(false)
      }
    },
    [busy, gateway, relays, saveSettings, addToast, t],
  )

  const handleTest = useCallback(() => {
    void gateway.notifyIncoming(t('settings.pushNotificationsTestBody'))
  }, [gateway, t])

  const supported = gateway.supported
  const denied = supported && permission === 'denied'
  const active = enabled && permission === 'granted'

  return (
    <SettingsDetailPage title={t('settings.pushNotifications')} onBack={onBack}>
      <div className="px-5 py-4 flex items-center justify-between border-b border-border">
        <div className="flex-1 mr-3">
          <p className="text-body font-medium">{t('settings.pushNotifications')}</p>
          <p className="text-caption text-foreground-muted mt-0.5">
            {t('settings.pushNotificationsDescription')}
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!supported || busy}
          label={t('settings.pushNotifications')}
          onChange={handleToggle}
        />
      </div>

      <div className="px-5 py-4 flex items-center justify-between border-b border-border">
        <div className="flex-1 mr-3">
          <p className="text-body font-medium">
            {t('settings.hideNotificationInForeground')}
          </p>
          <p className="text-caption text-foreground-muted mt-0.5">
            {t('settings.hideNotificationInForegroundDescription')}
          </p>
        </div>
        <Switch
          checked={hideInForeground}
          disabled={!supported}
          label={t('settings.hideNotificationInForeground')}
          onChange={(next) => void saveSettings({ hideNotificationInForeground: next })}
        />
      </div>

      <p className="px-5 py-3 text-caption text-foreground-muted border-b border-border">
        {t('settings.pushNotificationsRelayNote')}{' '}
        {onRelayManagement && (
          <button type="button" onClick={onRelayManagement} className="text-brand underline">
            {t('settings.manageRelays')}
          </button>
        )}
      </p>

      {!supported && (
        <p className="px-5 py-3 text-caption text-foreground-muted">
          {t('settings.pushNotificationsUnsupported')}
        </p>
      )}

      {denied && (
        <p className="px-5 py-3 text-caption text-accent-danger">
          {t('settings.pushNotificationsDenied')}
        </p>
      )}

      {active && (
        <div className="px-5 py-4">
          <Button variant="secondary" size="md" onClick={handleTest}>
            {t('settings.pushNotificationsTest')}
          </Button>
        </div>
      )}

      {registry.pushDevTools && (
        <PushDevToolsSection tools={registry.pushDevTools} relays={relays} addToast={addToast} />
      )}
    </SettingsDetailPage>
  )
}

function PushDevToolsSection({
  tools,
  relays,
  addToast,
}: {
  tools: PushDevTools
  relays: string[]
  addToast: (toast: Omit<Toast, 'id'>) => void
}) {
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      if (busy) return
      setBusy(true)
      try {
        const result = await action()
        addToast({
          type: result === false ? 'error' : 'success',
          message: `dev: ${label} ${result === false ? 'failed' : 'ok'}`,
          duration: 3000,
        })
      } catch (error) {
        console.warn(`[push-dev] ${label} failed:`, error)
        addToast({
          type: 'error',
          message: `dev: ${label} failed — ${error instanceof Error ? error.message : String(error)}`,
          duration: 4000,
        })
      } finally {
        setBusy(false)
      }
    },
    [busy, addToast],
  )

  return (
    <div className="mt-2 px-5 py-4 border-t border-border">
      <p className="text-caption font-semibold text-foreground-muted mb-2">
        DEV — push wake-up chain
      </p>
      <p className="text-caption text-foreground-muted break-all mb-1">
        relays: {relays.length > 0 ? relays.join(', ') : '(none — server default)'}
      </p>
      <p className="text-caption text-foreground-muted break-all mb-3">
        audit: <code>{tools.inboxPub()}</code>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => run('register', () => tools.register(relays))}
        >
          등록
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => run('unregister', () => tools.unregister())}
        >
          해제
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => run('publish 1059', () => tools.publishSelfGiftWrap(relays))}
        >
          self 1059 발행
        </Button>
      </div>
    </div>
  )
}
