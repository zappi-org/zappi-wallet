/**
 * ContactService — ContactUseCase 구현
 *
 * ContactRepository port를 통해 연락처 CRUD.
 */

import type {
  ContactUseCase,
  CreateContactParams,
  UpdateContactParams,
} from '@/core/ports/driving/contact.usecase'
import type { Contact } from '@/core/domain/contact'
import type { ContactRepository } from '@/core/ports/driven/contact.repository.port'

export class ContactService implements ContactUseCase {
  constructor(private repo: ContactRepository) {}

  async list(): Promise<Contact[]> {
    return this.repo.list()
  }

  async getById(id: string): Promise<Contact | null> {
    return this.repo.getById(id)
  }

  async findByAddress(address: string): Promise<Contact | null> {
    return this.repo.findByAddress(address)
  }

  async create(params: CreateContactParams): Promise<Contact> {
    const now = Date.now()
    const contact: Contact = {
      id: crypto.randomUUID(),
      name: params.name,
      addresses: params.addresses,
      createdAt: now,
      updatedAt: now,
    }
    await this.repo.save(contact)
    return contact
  }

  async update(id: string, params: UpdateContactParams): Promise<void> {
    await this.repo.update(id, {
      ...params,
      updatedAt: Date.now(),
    })
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
