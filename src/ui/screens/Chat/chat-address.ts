import { npubDecode, nprofileDecode } from '@/core/domain/nostr-address'

export function contactPubkey(address: string): string | null {
  try {
    const value = address.trim().replace(/^nostr:/i, '')
    if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase()
    return value.startsWith('nprofile1')
      ? nprofileDecode(value).pubkey
      : npubDecode(value)
  } catch {
    return null
  }
}
