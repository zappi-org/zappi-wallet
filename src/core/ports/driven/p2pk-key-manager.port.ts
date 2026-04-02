/**
 * P2PK key lifecycle manager.
 *
 * Abstracts P2PK key generation, rotation, and retrieval.
 * Key rotation is a privacy policy (domain concern) —
 * how keys are derived and stored is an implementation detail.
 */
export interface P2PKKeyManager {
  /** Get the current active P2PK public key (for k10019 publish) */
  getCurrentKey(): Promise<{ pubkey: string }>
  /** Generate a new key and make it the active key (previous keys retained for receiving) */
  rotateKey(): Promise<{ pubkey: string }>
  /** Register an external key pair (e.g. BIP-32 derived) */
  registerKey(privkey: Uint8Array): Promise<{ pubkey: string }>
}
