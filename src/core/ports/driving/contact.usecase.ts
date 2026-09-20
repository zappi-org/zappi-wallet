import type { Contact, ContactAddress } from '@/core/domain/contact'

export interface ContactUseCase {
  list(): Promise<Contact[]>
  getById(id: string): Promise<Contact | null>
  findByAddress(address: string): Promise<Contact | null>
  create(params: CreateContactParams): Promise<Contact>
  update(id: string, params: UpdateContactParams): Promise<void>
  delete(id: string): Promise<void>
}

export interface CreateContactParams {
  name: string
  addresses: ContactAddress[]
}

export interface UpdateContactParams {
  name?: string
  addresses?: ContactAddress[]
}
