/**
 * DexieSignerSessionStore — SignerSessionStore implementation.
 *
 * Three tables (v24): connected sessions, the durable processed-request ledger,
 * and single-use connect secrets. The ledgers are pruned by `pruneProcessed`
 * on start; kind:24133 is ephemeral but non-compliant relays can redeliver.
 */

import type { SignerSession } from '@/core/domain/remote-signing'
import type { SignerSessionStore } from '@/core/ports/driven/signer-session-store.port'
import { getDatabase } from './schema'

export class DexieSignerSessionStore implements SignerSessionStore {
  async listSessions(): Promise<SignerSession[]> {
    return getDatabase().signerSessions.toArray()
  }

  async getSession(clientPubkey: string): Promise<SignerSession | null> {
    return (await getDatabase().signerSessions.get(clientPubkey)) ?? null
  }

  async saveSession(session: SignerSession): Promise<void> {
    await getDatabase().signerSessions.put(session)
  }

  async deleteSession(clientPubkey: string): Promise<void> {
    await getDatabase().signerSessions.delete(clientPubkey)
  }

  async hasProcessed(id: string): Promise<boolean> {
    return (await getDatabase().signerProcessed.get(id)) !== undefined
  }

  async markProcessed(id: string, expiresAt: number): Promise<void> {
    await getDatabase().signerProcessed.put({ id, expiresAt })
  }

  async pruneProcessed(now: number): Promise<void> {
    const db = getDatabase()
    await db.signerProcessed.where('expiresAt').below(now).delete()
    await db.signerSecrets.where('expiresAt').below(now).delete()
  }

  async hasUsedSecret(secret: string): Promise<boolean> {
    return (await getDatabase().signerSecrets.get(secret)) !== undefined
  }

  async markSecretUsed(secret: string, expiresAt: number): Promise<void> {
    await getDatabase().signerSecrets.put({ secret, expiresAt })
  }

  async releaseSecret(secret: string): Promise<void> {
    await getDatabase().signerSecrets.delete(secret)
  }
}
