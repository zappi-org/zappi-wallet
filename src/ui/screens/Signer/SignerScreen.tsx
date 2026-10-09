/**
 * SignerScreen — dev-only "웹로그인 & 원격 서명" page.
 *
 * Covers the MVP client use cases:
 *   UC1 연결하기   — 스캔 / 붙혀넣기 → URI 파싱 → 승인 → approveConnection
 *   UC2 연결 목록  — listSessions + revokeSession
 *   UC3 서명 승인  — handled globally by SignerApprovalModal (mounted in MainApp)
 *
 * ponytail: hardcoded copy + plain layout. i18n/design polish when promoted out of dev.
 */
import { useCallback, useEffect, useState } from 'react'
import { ClipboardPaste, QrCode, Trash2 } from 'lucide-react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useAppStore } from '@/store'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { Button } from '@/ui/components/common/Button'
import { Modal } from '@/ui/components/common/Modal'
import { SettingsDetailPage } from '@/ui/screens/Settings/components/SettingsDetailPage'
import type {
  NostrConnectRequest,
  SignerPermission,
  SignerSession,
  SignerUriError,
} from '@/core/domain/remote-signing'

const URI_ERROR_TEXT: Record<SignerUriError, string> = {
  'unsupported-scheme': '지원하지 않는 QR/링크',
  'invalid-uri': '잘못된 연결 링크',
  'bad-pubkey': '잘못된 공개키',
  'no-relay': '릴레이 정보가 없습니다',
  'missing-secret': 'secret이 없습니다',
}

const METHOD_LABEL: Record<string, string> = {
  get_public_key: '공개 키 조회',
  sign_event: '이벤트 서명',
  nip44_encrypt: '암호화 (NIP-44)',
  nip44_decrypt: '복호화 (NIP-44)',
  switch_relays: '릴레이 전환',
  ping: '연결 확인',
  logout: '연결 해제',
}

function permissionLabel(p: SignerPermission): string {
  if (p.method === 'sign_event') {
    return p.kind ? `이벤트 서명 (kind ${p.kind})` : '모든 이벤트 서명'
  }
  return METHOD_LABEL[p.method] ?? p.method
}

function clientName(session: SignerSession): string {
  return session.name || session.url || `${session.clientPubkey.slice(0, 10)}…`
}

/** Client icon from the URI's `image` (display hint only), initial fallback. */
function ClientAvatar({ name, image }: { name: string; image?: string }) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        referrerPolicy="no-referrer"
        className="w-11 h-11 rounded-card object-cover shrink-0 bg-foreground/[0.06]"
      />
    )
  }
  return (
    <div className="w-11 h-11 rounded-card shrink-0 bg-foreground/[0.06] flex items-center justify-center text-body font-semibold text-foreground-muted">
      {(name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

export function SignerScreen({ onBack }: { onBack: () => void }) {
  const registry = useServiceRegistry()
  const addToast = useAppStore((s) => s.addToast)

  const [sessions, setSessions] = useState<SignerSession[]>([])
  const [pending, setPending] = useState<NostrConnectRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<SignerSession | null>(null)

  const reload = useCallback(() => {
    registry.remoteSigning
      .listSessions()
      .then(setSessions)
      .catch((e) => console.error('[Signer] listSessions failed:', e))
  }, [registry])

  useEffect(() => {
    reload()
  }, [reload])

  // No store bridge (dev): refresh on the signer's own events.
  useEffect(() => {
    const offOpen = registry.eventBus.on('signer:session-opened', reload)
    const offRevoked = registry.eventBus.on('signer:session-revoked', reload)
    return () => {
      offOpen()
      offRevoked()
    }
  }, [registry, reload])

  const handleRaw = useCallback(
    (raw: string) => {
      const result = registry.remoteSigning.parseIncoming(raw)
      if (!result.ok) {
        addToast({ type: 'error', message: URI_ERROR_TEXT[result.reason] })
        return
      }
      setPending(result.request)
    },
    [registry, addToast],
  )

  const handlePaste = useCallback(async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) {
        addToast({ type: 'error', message: '클립보드가 비었습니다' })
        return
      }
      handleRaw(text)
    } catch {
      addToast({ type: 'error', message: '클립보드 읽기 실패' })
    }
  }, [handleRaw, addToast])

  const handleApprove = useCallback(async () => {
    if (!pending || busy) return
    setBusy(true)
    const result = await registry.remoteSigning.approveConnection(pending)
    setBusy(false)
    if (result.ok) {
      addToast({ type: 'success', message: `${pending.name || '웹사이트'} 연결됨` })
      setPending(null)
      reload()
      return
    }
    addToast({
      type: 'error',
      message:
        result.error.code === 'SIGNER_SECRET_REUSED'
          ? '이미 사용된 링크입니다'
          : '연결 실패 — 릴레이에 닿지 못했습니다',
    })
  }, [pending, busy, registry, addToast, reload])

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget) return
    const target = revokeTarget
    setRevokeTarget(null)
    try {
      await registry.remoteSigning.revokeSession(target.clientPubkey)
    } catch (e) {
      console.error('[Signer] revokeSession failed:', e)
    }
    reload()
  }, [revokeTarget, registry, reload])

  // ─── Connect approval (UC1) ───
  if (pending) {
    return (
      <SettingsDetailPage title="연결 승인" onBack={() => setPending(null)}>
        <div className="px-4 pt-4 flex flex-col gap-4">
          <div className="bg-background-card rounded-card p-4 flex items-start gap-3">
            <ClientAvatar name={pending.name || '웹사이트'} image={pending.image} />
            <div className="flex-1 min-w-0">
              <p className="text-subtitle font-semibold">{pending.name || '웹사이트'}</p>
              {pending.url && <p className="text-caption text-foreground-muted break-all">{pending.url}</p>}
              <p className="text-label text-foreground-muted mt-2 font-mono break-all">
                {pending.clientPubkey}
              </p>
            </div>
          </div>

          <div className="bg-background-card rounded-card p-4">
            <p className="text-caption text-foreground-muted mb-2">요청 권한</p>
            <ul className="flex flex-col gap-1.5">
              {pending.permissions.length === 0 && (
                <li className="text-body text-foreground-muted">(요청 없음)</li>
              )}
              {pending.permissions.map((p, i) => (
                <li key={`${p.method}:${p.kind ?? ''}:${i}`} className="text-body">
                  • {permissionLabel(p)}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-background-card rounded-card p-4">
            <p className="text-caption text-foreground-muted mb-2">릴레이</p>
            <ul className="flex flex-col gap-1">
              {pending.relays.map((r) => (
                <li key={r} className="text-caption break-all">
                  {r}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setPending(null)}>
              취소
            </Button>
            <Button variant="primary" size="lg" className="flex-1" loading={busy} onClick={handleApprove}>
              연결
            </Button>
          </div>
        </div>
      </SettingsDetailPage>
    )
  }

  // ─── Hub: scan/paste + sessions (UC1 entry + UC2) ───
  return (
    <SettingsDetailPage title="연결된 앱" onBack={onBack}>
      <div className="px-4 pt-4 flex flex-col gap-2.5">
        <div className="flex gap-2.5">
          <Button variant="surface" size="lg" className="flex-1" icon={<QrCode className="w-5 h-5" />} onClick={() => setShowScanner(true)}>
            스캔하기
          </Button>
          <Button variant="surface" size="lg" className="flex-1" icon={<ClipboardPaste className="w-5 h-5" />} onClick={handlePaste}>
            붙혀넣기
          </Button>
        </div>

        <p className="text-caption text-foreground-muted px-1 pt-3">연결된 앱</p>
        {sessions.length === 0 ? (
          <p className="text-body text-foreground-muted px-1 py-6 text-center">연결된 앱이 없습니다</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {sessions.map((session) => (
              <div key={session.clientPubkey} className="bg-background-card rounded-card p-4 flex items-start gap-3">
                <ClientAvatar name={clientName(session)} image={session.image} />
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium truncate">{clientName(session)}</p>
                  <p className="text-label text-foreground-muted font-mono">
                    {session.clientPubkey.slice(0, 16)}…
                  </p>
                  <p className="text-caption text-foreground-muted mt-1">
                    {session.permissions.map(permissionLabel).join(', ') || '권한 없음'}
                  </p>
                </div>
                <button
                  onClick={() => setRevokeTarget(session)}
                  aria-label="연결 끊기"
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-accent-danger hover:bg-accent-danger/10"
                >
                  <Trash2 className="w-[18px] h-[18px]" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <QrScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(raw) => {
          setShowScanner(false)
          handleRaw(raw)
        }}
      />

      <Modal isOpen={revokeTarget !== null} onClose={() => setRevokeTarget(null)} title="연결 끊기">
        <p className="text-body">
          {revokeTarget ? `'${clientName(revokeTarget)}' 연결을 끊을까요?` : ''}
        </p>
        <p className="text-caption text-foreground-muted mt-2">
          이 사이트는 더 이상 서명을 요청할 수 없습니다.
        </p>
        <div className="flex gap-2 mt-5">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setRevokeTarget(null)}>
            취소
          </Button>
          <Button variant="destructive" size="lg" className="flex-1" onClick={handleRevoke}>
            연결 끊기
          </Button>
        </div>
      </Modal>
    </SettingsDetailPage>
  )
}
