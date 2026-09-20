/**
 * Address book contact
 */
export type ContactAddressType = 'lightning' | 'npub' | 'custom'

export interface Contact {
  id: string
  name: string
  address: string
  addressType: ContactAddressType
  memo?: string
  createdAt: number
  updatedAt: number
}

/**
 * Auto-detect address type from the address string
 */
export function detectAddressType(address: string): ContactAddressType {
  const trimmed = address.trim()
  if (trimmed.includes('@')) return 'lightning'
  if (trimmed.startsWith('npub1')) return 'npub'
  return 'custom'
}
