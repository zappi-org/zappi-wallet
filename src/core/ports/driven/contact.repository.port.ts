export interface Contact {
  id: string
  name: string
  address: string
  addressType: string
  createdAt: number
  updatedAt: number
}

export interface ContactRepository {
  save(contact: Contact): Promise<void>
  getById(id: string): Promise<Contact | null>
  list(): Promise<Contact[]>
  update(id: string, patch: Partial<Contact>): Promise<void>
  delete(id: string): Promise<void>
  findByAddress(address: string): Promise<Contact | null>
}
