import type { Result } from '@/core/domain/result'
import type { RemoteSigningError } from '@/core/errors/remote-signing'
import type {
  NostrConnectRequest,
  SignerPermission,
  SignerSession,
  SignerSignedEvent,
  SignerUriResult,
} from '@/core/domain/remote-signing'

/**
 * RemoteSigningUseCase — Zappi as a NIP-46 remote-signer (bunker).
 */
export interface RemoteSigningUseCase {
  /** Classify a scanned URI (`nostrconnect://`; `bunker://` is unsupported). */
  parseIncoming(raw: string): SignerUriResult

  /**
   * User approved the connection: open a session and send the connect response
   * (client-initiated flow — the signer answers with the echoed secret).
   */
  approveConnection(
    request: NostrConnectRequest,
    permissions?: SignerPermission[],
  ): Promise<Result<SignerSession, RemoteSigningError>>

  listSessions(): Promise<SignerSession[]>
  /** Most recently signed events, newest first (default 5). */
  listRecentSigned(limit?: number): Promise<SignerSignedEvent[]>
  revokeSession(clientPubkey: string): Promise<void>

  /** Resolve a pending out-of-permission sign_event approval. */
  resolveApproval(approvalId: string, allow: boolean): void

  /** Resume relay subscriptions for stored sessions (call after unlock). */
  start(): Promise<void>
  stop(): void
}
