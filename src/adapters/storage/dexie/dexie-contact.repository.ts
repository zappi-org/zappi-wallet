import type {
  ContactRepository,
} from '@/core/ports/driven/contact.repository.port'
import type { Contact } from '@/core/domain/contact'
import type { Contact as LegacyContact } from '@/core/types'
import { getDatabase } from './schema'

function toDomain(legacy: LegacyContact): Contact {
  return {
    id: legacy.id,
    name: legacy.name,
    addresses: [{
      value: legacy.address,
      type: legacy.addressType === 'npub' ? 'npub' : 'email',
    }],
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  }
}

function toLegacy(domain: Contact): LegacyContact {
  const first = domain.addresses[0]
  return {
    id: domain.id,
    name: domain.name,
    address: first?.value ?? '',
    addressType: first?.type === 'npub' ? 'npub'
      : first?.type === 'nprofile' ? 'npub'
      : first?.type === 'email' ? 'lightning'
      : 'custom',
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt,
  }
}

export class DexieContactRepository implements ContactRepository {
  private get table() {
    return getDatabase().contacts
  }

  async save(contact: Contact): Promise<void> {
    await this.table.put(toLegacy(contact))
  }

  async getById(id: string): Promise<Contact | null> {
    const legacy = await this.table.get(id)
    return legacy ? toDomain(legacy) : null
  }

  async list(): Promise<Contact[]> {
    const results = await this.table.orderBy('name').toArray()
    return results.map(toDomain)
  }

  async update(id: string, patch: Partial<Contact>): Promise<void> {
    const existing = await this.table.get(id)
    if (!existing) return
    await this.table.put(toLegacy({ ...toDomain(existing), ...patch }))
  }

  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  async deleteAll(): Promise<void> {
    await this.table.clear()
  }

  async findByAddress(address: string): Promise<Contact | null> {
    const legacy = await this.table.where('address').equals(address).first()
    return legacy ? toDomain(legacy) : null
  }
}
