import { useCallback, useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KILL_SWITCH_NAMES, readKillSwitches } from '@/core/utils/kill-switch'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

/**
 * Diagnostics page — views production aggregate counters.
 *
 * These counters back the verification protocol for the TLS polling-downgrade gate:
 * tls_stuck_detected = 0 AND coco_push_received > 0 across all devices for 7 days.
 * No PII, no remote transmission — the user copies and shares manually for support.
 */

interface DiagnosticsPageProps {
  onBack: () => void
}

export function DiagnosticsPage({ onBack }: DiagnosticsPageProps) {
  const { t } = useTranslation()
  // Counter reads go through the registry port — no direct adapters/telemetry import
  const { diagnostics } = useServiceRegistry()
  const [counters, setCounters] = useState<Record<string, number> | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // Mount-time snapshot — the runtime also runs off the bootstrap snapshot, so this
  // display matches actual behavior (changes apply from the next unlock; see note below)
  const [killSwitches] = useState(() => readKillSwitches())

  const refresh = useCallback(() => {
    diagnostics.readNetCounters()
      .then(setCounters)
      .catch((e) => console.warn('[Diagnostics] counter read failed:', e))
  }, [diagnostics])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleCopy = useCallback(async () => {
    if (!counters) return
    const lines = [
      ...Object.entries(counters).map(([name, value]) => `${name}: ${value}`),
      ...KILL_SWITCH_NAMES.map((name) => `ks.${name}: ${killSwitches[name] ? 'on' : 'off'}`),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopyState('copied')
    } catch (e) {
      // Insecure context or permission denied — surface the failure so the button doesn't look dead
      console.warn('[Diagnostics] clipboard write failed:', e)
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 2000)
  }, [counters, killSwitches])

  const copyLabel =
    copyState === 'copied'
      ? t('settings.diagnosticsCopied')
      : copyState === 'failed'
        ? t('settings.diagnosticsCopyFailed')
        : t('settings.diagnosticsCopy')

  return (
    <SettingsDetailPage title={t('settings.diagnostics')} onBack={onBack}>
      <div className="py-2">
        <p className="px-5 pb-3 text-caption text-foreground-secondary">
          {t('settings.diagnosticsDescription')}
        </p>

        <div className="bg-background-card">
          {counters
            ? Object.entries(counters).map(([name, value]) => (
                <div
                  key={name}
                  className="px-5 py-3 flex items-center justify-between border-b border-foreground/[0.04] last:border-b-0"
                >
                  <span className="text-caption font-mono text-foreground-secondary">{name}</span>
                  <span className="text-body font-semibold tabular-nums">{value.toLocaleString()}</span>
                </div>
              ))
            : (
                <div className="px-5 py-6 text-center text-caption text-foreground-secondary">…</div>
              )}
        </div>

        <div className="mt-4 bg-background-card">
          {KILL_SWITCH_NAMES.map((name) => (
            <div
              key={name}
              className="px-5 py-3 flex items-center justify-between border-b border-foreground/[0.04] last:border-b-0"
            >
              <span className="text-caption font-mono text-foreground-secondary">ks.{name}</span>
              <span className="text-body font-semibold">
                {killSwitches[name] ? 'ON' : 'off'}
              </span>
            </div>
          ))}
        </div>
        <p className="px-5 pt-2 text-caption text-foreground-secondary">
          {t('settings.diagnosticsKsNote')}
        </p>

        <div className="px-5 pt-4 flex gap-2">
          <button
            onClick={refresh}
            className="flex-1 py-3 rounded-xl bg-background-card active:bg-background-hover flex items-center justify-center gap-2 text-body font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            {t('settings.diagnosticsRefresh')}
          </button>
          <button
            onClick={handleCopy}
            className="flex-1 py-3 rounded-xl bg-background-card active:bg-background-hover flex items-center justify-center gap-2 text-body font-medium"
          >
            <Copy className="w-4 h-4" />
            {copyLabel}
          </button>
        </div>
      </div>
    </SettingsDetailPage>
  )
}
