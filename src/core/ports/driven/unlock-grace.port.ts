/**
 * UnlockGrace — time-boxed session resume without a PIN.
 *
 * A PWA eviction reloads the app; the seed is memory-only, so a reload always
 * forces PIN re-entry. This port persists the mnemonic encrypted under a
 * non-extractable device key with an expiry, letting a reload within the
 * auto-lock window resume the session. The mnemonic never leaves the adapter in
 * plaintext, and every consumer treats a missing/expired/corrupt blob as "no
 * grace" — a failure here weakens nothing, it only falls back to PIN.
 */
export interface GraceSession {
  mnemonic: string
  /** ms epoch after which the blob is dead. */
  expiresAt: number
}

export interface UnlockGrace {
  /** Encrypt and persist the mnemonic with an expiry. Creates the blob. */
  save(mnemonic: string, expiresAt: number): Promise<void>
  /**
   * Return the live session, or null. Expiry is checked BEFORE decrypting; an
   * expired/corrupt blob is self-deleted and null is returned.
   */
  load(): Promise<GraceSession | null>
  /**
   * Atomic, non-creating expiry refresh: in a single transaction, update the
   * expiry only when a live (existing && unexpired) blob is present, else no-op.
   * Never resurrects a cleared or expired blob.
   */
  extend(expiresAt: number): Promise<void>
  /** Remove the blob (session invalidation on lock/lockout). */
  clear(): Promise<void>
}
