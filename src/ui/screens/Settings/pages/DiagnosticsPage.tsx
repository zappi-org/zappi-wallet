import { useCallback, useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  readNetCounters,
  type NetCounterName,
} from '@/adapters/telemetry/net-counters'
import { KILL_SWITCH_NAMES, readKillSwitches } from '@/core/utils/kill-switch'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

/**
 * 진단 페이지 (설계 §12) — 프로덕션 집계 카운터 열람.
 *
 * 5단계(TLS 폴링 강등) 게이트의 검증 프로토콜이 이 수치를 근거로 한다:
 * 7일간 전 기기 tls_stuck_detected = 0 AND coco_push_received > 0.
 * PII 없음 · 원격 전송 없음 — 지원 시 사용자가 수동으로 복사해 공유한다.
 */

interface DiagnosticsPageProps {
  onBack: () => void
}

export function DiagnosticsPage({ onBack }: DiagnosticsPageProps) {
  const { t } = useTranslation()
  const [counters, setCounters] = useState<Record<NetCounterName, number> | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // 마운트 시점 스냅샷 — 런타임도 bootstrap 스냅샷으로 동작하므로 여기 표시가
  // 실동작과 일치한다(변경은 다음 잠금 해제부터 적용, 하단 안내 문구)
  const [killSwitches] = useState(() => readKillSwitches())

  const refresh = useCallback(() => {
    readNetCounters()
      .then(setCounters)
      .catch((e) => console.warn('[Diagnostics] counter read failed:', e))
  }, [])

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
      // 비보안 컨텍스트·권한 거부 — 버튼이 죽은 듯 보이지 않게 실패를 표시
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
