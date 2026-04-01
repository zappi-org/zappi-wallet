/**
 * Contact — 연락처 도메인 엔티티
 */

export type ContactAddressType = 'email' | 'npub' | 'nprofile' | 'bolt12'

export interface ContactAddress {
  value: string
  type: ContactAddressType
  label?: string
  capabilities?: Record<string, unknown>
}

export interface Contact {
  id: string
  name: string
  addresses: ContactAddress[]
  createdAt: number
  updatedAt: number
}
