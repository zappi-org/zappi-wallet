import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore, type Toast } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { Switch } from '@/ui/components/common/Switch'
import { Button } from '@/ui/components/common/Button'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import type { PushDevToolsAdapter } from '@/adapters/runtime/push-dev-tools.adapter'
import { PUSH_LABEL_TITLE, PUSH_LABEL_ZAPPI_NIP_17, type PushDevOptions } from '@/adapters/runtime/web-push.adapter'

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
  tools: PushDevToolsAdapter
  relays: string[]
  addToast: (toast: Omit<Toast, 'id'>) => void
}) {
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState(PUSH_LABEL_ZAPPI_NIP_17)
  const [title, setTitle] = useState(PUSH_LABEL_TITLE)
  const [modeIndex, setModeIndex] = useState(0)
  const [subscription, setSubscription] = useState('')

  const modes: { name: string; opts: PushDevOptions }[] = [
    { name: '난독화 + 해제 (토큰 → 타이틀)', opts: {} },
    { name: '난독화 + 해제 안 함 (페이로드 그대로)', opts: { obfuscate: true, store: false } },
    { name: '난독화 안 함 (평문 메시지)', opts: { obfuscate: false } },
  ]
  const devOpts: PushDevOptions = { ...modes[modeIndex].opts, label: label.trim(), title: title.trim() }

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
      <div className="flex flex-col gap-2 mb-3">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="payload message (label)"
          className="w-full px-3 py-2 rounded-xl bg-background border border-border text-caption focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="알림 타이틀 (난독화+해제 모드에서만 사용, 서버엔 안 감)"
          className="w-full px-3 py-2 rounded-xl bg-background border border-border text-caption focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={modeIndex}
          onChange={(e) => setModeIndex(Number(e.target.value))}
          className="w-full px-3 py-2 rounded-xl bg-background border border-border text-caption focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {modes.map((m, i) => (
            <option key={m.name} value={i}>
              {m.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] leading-snug text-foreground-muted break-all">
          테스트: 같은 기기에서 발행해도 foreground면 앱이 표시한다 (앱 사용 중 숨기기 꺼야 보임).
          기대 결과 — 해제: 설정한 타이틀, 미해제: 토큰 그대로, 평문: 라벨, 레거시/무메시지: "알림".
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            run('register', () => {
              if (!label.trim()) throw new Error('label is empty')
              return tools.register(relays, devOpts)
            })
          }
        >
          등록
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            run('subscription', async () => {
              setSubscription(JSON.stringify(await tools.serverSubscription(), null, 2))
              return true
            })
          }
        >
          구독 조회
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            run('local map', async () => {
              setSubscription(JSON.stringify(await tools.localLabelMap(), null, 2))
              return true
            })
          }
        >
          로컬 해석 조회
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
      <textarea
        readOnly
        value={subscription}
        placeholder="'구독 조회' = 서버 등록 (filter/push/relays/message), '로컬 해석 조회' = 해석 맵 — mode 1이면 현재 토큰의 title이 null이어야 함·정상) — title null 또는 부재면 raw 표시"
        rows={5}
        className="w-full mt-3 px-3 py-2 rounded-xl bg-background border border-border text-caption font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  )
}
