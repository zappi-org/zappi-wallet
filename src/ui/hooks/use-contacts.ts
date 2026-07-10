/**
 * useContacts — ContactUseCase driving adapter (hook)
 *
 * ServiceContext에서 ContactUseCase를 가져와 CRUD 제공.
 * UI 호환을 위해 domain Contact → legacy Contact 형식으로 변환하여 반환.
 * Phase 6에서 스크린별로 domain Contact으로 전환 예정.
 */

import { useCallback, useState, useEffect, useContext } from 'react'
import { ServiceContext } from './service-context-value'
import type { Contact as DomainContact } from '@/core/domain/contact'
import type { Contact as LegacyContact, ContactAddressType as LegacyAddressType } from '@/core/types/contact'

/** domain Contact → legacy Contact 변환 (UI 호환) */
function toLegacy(contact: DomainContact): LegacyContact {
  const primary = contact.addresses[0]
  const typeMap: Record<string, LegacyAddressType> = {
    email: 'lightning',
    npub: 'npub',
    nprofile: 'npub',
    bolt12: 'custom',
  }
  return {
    id: contact.id,
    name: contact.name,
    address: primary?.value ?? '',
    addressType: primary ? (typeMap[primary.type] ?? 'custom') : 'custom',
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  }
}

/** legacy addressType → domain addressType 변환 */
function toDomainAddressType(address: string, legacyType: LegacyAddressType): 'email' | 'npub' | 'nprofile' | 'bolt12' {
  if (legacyType === 'npub') return address.startsWith('nprofile1') ? 'nprofile' : 'npub'
  if (legacyType === 'lightning') return 'email'
  return 'email' // custom → email as fallback
}

export function useContacts() {
  const registry = useContext(ServiceContext)
  const [contacts, setContacts] = useState<LegacyContact[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // True once the first load settles — consumers defer default-tab decisions
  // on it so the []→loaded flip doesn't animate as a phantom user action
  const [isReady, setIsReady] = useState(false)

  const loadContacts = useCallback(async () => {
    if (!registry?.contact) {
      setIsReady(true)
      return
    }
    setIsLoading(true)
    try {
      const domainContacts = await registry.contact.list()
      setContacts(domainContacts.map(toLegacy))
    } finally {
      setIsLoading(false)
      setIsReady(true)
    }
  }, [registry?.contact])

  // Auto-load on mount
  useEffect(() => {
    loadContacts()
  }, [loadContacts])

  const createContact = useCallback(async (data: { name: string; address: string; addressType: LegacyAddressType }) => {
    if (!registry?.contact) return null
    const contact = await registry.contact.create({
      name: data.name,
      addresses: [{
        value: data.address,
        type: toDomainAddressType(data.address, data.addressType),
      }],
    })
    await loadContacts()
    return toLegacy(contact)
  }, [registry?.contact, loadContacts])

  const updateContact = useCallback(async (id: string, data: { name: string; address: string; addressType: LegacyAddressType }) => {
    if (!registry?.contact) return
    await registry.contact.update(id, {
      name: data.name,
      addresses: [{
        value: data.address,
        type: toDomainAddressType(data.address, data.addressType),
      }],
    })
    await loadContacts()
  }, [registry?.contact, loadContacts])

  const deleteContact = useCallback(async (id: string) => {
    if (!registry?.contact) return
    await registry.contact.delete(id)
    await loadContacts()
  }, [registry?.contact, loadContacts])

  const findByAddress = useCallback(async (address: string): Promise<LegacyContact | null> => {
    if (!registry?.contact) return null
    const contact = await registry.contact.findByAddress(address)
    return contact ? toLegacy(contact) : null
  }, [registry?.contact])

  return {
    contacts,
    isLoading,
    isReady,
    loadContacts,
    createContact,
    updateContact,
    deleteContact,
    findByAddress,
  }
}
