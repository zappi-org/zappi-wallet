import type { Contact } from '@/core/domain/contact'

export type { Contact }

export interface ContactRepository {
  save(contact: Contact): Promise<void>
  getById(id: string): Promise<Contact | null>
  list(): Promise<Contact[]>
  update(id: string, patch: Partial<Contact>): Promise<void>
  delete(id: string): Promise<void>
  findByAddress(address: string): Promise<Contact | null>
}
