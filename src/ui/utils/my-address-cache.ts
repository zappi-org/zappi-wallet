/**
 * Per-account my-address display cache (MyAddressScreen + ChangeUsernameSheet).
 *
 * The npubcash alias is account-scoped, so a single shared key leaked the
 * previous account's address onto a fresh account when the server lookup
 * failed. Keys are suffixed with the nostr pubkey; logout erases every
 * account's entry by prefix (composition/logout step ⑤).
 */
import { STORAGE_KEYS } from '@/core/constants'

export interface MyAddressCache {
  /** Full lightning address (alias@domain) — never the bare alias, so the
      fallback stays a valid payment target when the server lookup fails. */
  address?: string
  mintUrl?: string
  updatedAt: number
}

export function myAddressCacheKey(npub: string): string {
  return `${STORAGE_KEYS.MYADDRESS_CACHE}:${npub}`
}

export function readMyAddressCache(npub: string): MyAddressCache | null {
  try {
    const raw = localStorage.getItem(myAddressCacheKey(npub))
    if (!raw) return null
    const parsed = JSON.parse(raw) as MyAddressCache
    return parsed && (parsed.address || parsed.mintUrl) ? parsed : null
  } catch {
    return null
  }
}

export function writeMyAddressCache(npub: string, cache: MyAddressCache): void {
  try {
    localStorage.setItem(myAddressCacheKey(npub), JSON.stringify(cache))
  } catch {
    // storage full/denied — the cache is a nicety, never fail the screen
  }
}

/** Erase every account's my-address cache (logout wipe). */
export function clearAllMyAddressCaches(): void {
  const prefix = `${STORAGE_KEYS.MYADDRESS_CACHE}:`
  try {
    // length/key(index) — the spec interface, also compatible with test stubs
    // that don't enumerate via Object.keys.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) localStorage.removeItem(key)
    }
  } catch {
    // storage denied — nothing to remove; safe to ignore
  }
}