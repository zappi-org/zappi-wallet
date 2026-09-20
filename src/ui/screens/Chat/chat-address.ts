import { npubDecode, nprofileDecode } from '@/core/domain/nostr-address'
import { ChatAddressError, ChatCapacityError } from '@/core/errors/chat'

export function chatOpenErrorKey(error: unknown) {
  if (error instanceof ChatAddressError) return error.reason === 'self' ? 'chat.selfAddress' : 'chat.invalidAddress'
  if (error instanceof ChatCapacityError) return error.kind === 'storage' ? 'chat.storageFull' : 'chat.receiveFull'
  return 'chat.openFailed'
}

export function contactPubkey(address: string): string | null {
  try {
    const value = address.trim().replace(/^nostr:/i, '')
    if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase()
    return value.toLowerCase().startsWith('nprofile1')
      ? nprofileDecode(value).pubkey
      : npubDecode(value)
  } catch {
    return null
  }
}
