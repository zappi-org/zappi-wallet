/**
 * SignerApprovalModal — UC3 (실시간 서명 승인/거부).
 *
 * Mounted once in MainApp so it can fire from any screen. Subscribes to the
 * signer's approval event directly (no store bridge) and resolves it back.
 *
 * ponytail: hardcoded copy; auto-dismiss mirrors the service's 60s auto-deny.
 */
import { useCallback, useEffect, useState } from 'react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { Button } from '@/ui/components/common/Button'
import { Modal } from '@/ui/components/common/Modal'
import type { SignerApprovalRequest } from '@/core/domain/remote-signing'

const AUTO_DENY_MS = 60_000

export function SignerApprovalModal() {
  const registry = useServiceRegistry()
  const [request, setRequest] = useState<SignerApprovalRequest | null>(null)

  useEffect(
    () =>
      registry.eventBus.on('signer:approval-requested', (event) => {
        setRequest(event.payload.request)
      }),
    [registry],
  )

  // The service auto-denies at 60s; drop the modal in step so it can't linger.
  useEffect(() => {
    if (!request) return
    const timer = setTimeout(() => setRequest(null), AUTO_DENY_MS)
    return () => clearTimeout(timer)
  }, [request])

  const resolve = useCallback(
    (allow: boolean) => {
      if (request) registry.remoteSigning.resolveApproval(request.approvalId, allow)
      setRequest(null)
    },
    [request, registry],
  )

  return (
    <Modal isOpen={request !== null} onClose={() => resolve(false)} title="서명 요청">
      {request && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-body font-medium">{request.name || request.url || '알 수 없는 사이트'}</p>
            {request.url && <p className="text-caption text-foreground-muted break-all">{request.url}</p>}
          </div>
          <div className="bg-background rounded-card p-3">
            <p className="text-caption text-foreground-muted mb-1">
              {request.method}
              {request.kind !== undefined ? ` · kind ${request.kind}` : ''}
            </p>
            <p className="text-body break-all">{request.preview || '(내용 없음)'}</p>
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => resolve(false)}>
              거부
            </Button>
            <Button variant="primary" size="lg" className="flex-1" onClick={() => resolve(true)}>
              승인
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
