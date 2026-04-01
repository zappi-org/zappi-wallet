import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContactService } from '@/core/services/contact.service'
import type { ContactRepository } from '@/core/ports/driven/contact.repository.port'
import type { Contact } from '@/core/domain/contact'

function createMockRepo(): ContactRepository {
  return {
    save: vi.fn(),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    delete: vi.fn(),
    findByAddress: vi.fn().mockResolvedValue(null),
  }
}

describe('ContactService', () => {
  let service: ContactService
  let repo: ContactRepository

  beforeEach(() => {
    repo = createMockRepo()
    service = new ContactService(repo)
  })

  describe('create', () => {
    it('creates contact with multiple addresses', async () => {
      const contact = await service.create({
        name: 'Alice',
        addresses: [
          { value: 'alice@domain.test', type: 'email' },
          { value: 'npub1abc...', type: 'npub', label: '회사' },
        ],
      })

      expect(contact.name).toBe('Alice')
      expect(contact.addresses).toHaveLength(2)
      expect(contact.addresses[0].value).toBe('alice@domain.test')
      expect(contact.addresses[0].type).toBe('email')
      expect(contact.addresses[1].type).toBe('npub')
      expect(contact.addresses[1].label).toBe('회사')
      expect(contact.id).toBeTruthy()
      expect(contact.createdAt).toBeGreaterThan(0)
      expect(repo.save).toHaveBeenCalledWith(contact)
    })

    it('creates contact with single address', async () => {
      const contact = await service.create({
        name: 'Bob',
        addresses: [
          { value: 'lno1...', type: 'bolt12' },
        ],
      })

      expect(contact.addresses).toHaveLength(1)
      expect(contact.addresses[0].type).toBe('bolt12')
    })
  })

  describe('list', () => {
    it('delegates to repository', async () => {
      const contacts: Contact[] = [
        { id: '1', name: 'Alice', addresses: [{ value: 'alice@test', type: 'email' }], createdAt: 1000, updatedAt: 1000 },
        { id: '2', name: 'Bob', addresses: [{ value: 'npub1...', type: 'npub' }], createdAt: 2000, updatedAt: 2000 },
      ]
      vi.mocked(repo.list).mockResolvedValue(contacts)

      const result = await service.list()

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Alice')
    })
  })

  describe('getById', () => {
    it('returns contact when found', async () => {
      const contact: Contact = {
        id: '1', name: 'Alice',
        addresses: [{ value: 'alice@test', type: 'email' }],
        createdAt: 1000, updatedAt: 1000,
      }
      vi.mocked(repo.getById).mockResolvedValue(contact)

      const result = await service.getById('1')
      expect(result?.name).toBe('Alice')
    })

    it('returns null when not found', async () => {
      const result = await service.getById('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('findByAddress', () => {
    it('delegates to repository', async () => {
      const contact: Contact = {
        id: '1', name: 'Alice',
        addresses: [{ value: 'alice@test', type: 'email' }],
        createdAt: 1000, updatedAt: 1000,
      }
      vi.mocked(repo.findByAddress).mockResolvedValue(contact)

      const result = await service.findByAddress('alice@test')
      expect(result?.name).toBe('Alice')
    })
  })

  describe('update', () => {
    it('updates with new timestamp', async () => {
      await service.update('1', { name: 'Alice Updated' })

      expect(repo.update).toHaveBeenCalledWith('1', expect.objectContaining({
        name: 'Alice Updated',
        updatedAt: expect.any(Number),
      }))
    })

    it('updates addresses', async () => {
      await service.update('1', {
        addresses: [
          { value: 'newalice@test', type: 'email' },
        ],
      })

      expect(repo.update).toHaveBeenCalledWith('1', expect.objectContaining({
        addresses: [{ value: 'newalice@test', type: 'email' }],
      }))
    })
  })

  describe('delete', () => {
    it('delegates to repository', async () => {
      await service.delete('1')
      expect(repo.delete).toHaveBeenCalledWith('1')
    })
  })
})
