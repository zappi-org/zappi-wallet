import type { SignerSession } from '@/core/domain/remote-signing'

/**
 * SignerSessionStore — persistence for NIP-46 signer state.
 *
 * Holds connected clients plus the durable anti-replay ledgers (processed
 * request ids and single-use connect secrets). Durable because kind:24133 is
 * ephemeral but non-compliant relays may redeliver on reconnect.
 */
export interface SignerSessionStore {
  listSessions(): Promise<SignerSession[]>
  getSession(clientPubkey: string): Promise<SignerSession | null>
  saveSession(session: SignerSession): Promise<void>
  deleteSession(clientPubkey: string): Promise<void>

  hasProcessed(id: string): Promise<boolean>
  markProcessed(id: string, expiresAt: number): Promise<void>
  pruneProcessed(now: number): Promise<void>

  hasUsedSecret(secret: string): Promise<boolean>
  markSecretUsed(secret: string, expiresAt: number): Promise<void>
  /** Roll back a markSecretUsed when the connect response failed to send. */
  releaseSecret(secret: string): Promise<void>
}
