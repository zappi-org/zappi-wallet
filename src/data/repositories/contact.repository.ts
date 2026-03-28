import { getDatabase } from '@/data/database'
import type { Contact } from '@/core/types'

/**
 * Repository for managing address book contacts
 */
export class ContactRepository {
  private get table() {
    return getDatabase().contacts
  }

  async findAll(): Promise<Contact[]> {
    return this.table.orderBy('name').toArray()
  }

  async findById(id: string): Promise<Contact | undefined> {
    return this.table.get(id)
  }

  async save(contact: Contact): Promise<void> {
    await this.table.put(contact)
  }

  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  async findByAddress(address: string): Promise<Contact | undefined> {
    return this.table.where('address').equals(address).first()
  }

  async deleteAll(): Promise<void> {
    await this.table.clear()
  }
}

let instance: ContactRepository | null = null

export function getContactRepo(): ContactRepository {
  if (!instance) instance = new ContactRepository()
  return instance
}
