import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { DexieContactRepository } from '@/adapters/storage/dexie/dexie-contact.repository'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import type { Contact } from '@/core/domain/contact'

beforeEach(resetDatabase)
afterEach(resetDatabase)
const contact = (addresses: Contact['addresses']): Contact => ({
  id: 'alice',
  name: 'Alice',
  addresses,
  createdAt: 1,
  updatedAt: 1,
})

describe('shared contact address', () => {
  it('stores one npub for contact lookup', async () => {
    const repo = new DexieContactRepository()
    await repo.save(contact([{ value: 'npub1wallet', type: 'npub' }]))
    expect((await repo.findByAddress('npub1wallet'))?.addresses).toEqual([
      { value: 'npub1wallet', type: 'npub' },
    ])
  })
  it('reads development chat-only records and preserves the original field during favorite edits', async () => {
    const legacy = {
      id: 'alice',
      name: 'Alice',
      address: '',
      addressType: 'custom' as const,
      chatAddress: 'nprofile1chat',
      createdAt: 1,
      updatedAt: 1,
    }
    await getDatabase().contacts.put(legacy)
    const repo = new DexieContactRepository()
    expect((await repo.findByAddress('nprofile1chat'))?.addresses).toEqual([
      { value: 'nprofile1chat', type: 'nprofile' },
    ])
    await repo.update('alice', { favorite: true })
    expect(await getDatabase().contacts.get('alice')).toMatchObject({
      address: 'nprofile1chat',
      chatAddress: 'nprofile1chat',
      favorite: true,
    })
  })
  it('prefers the primary address of development split records', async () => {
    const legacy = {
      id: 'alice',
      name: 'Alice',
      address: 'npub1wallet',
      addressType: 'npub' as const,
      chatAddress: 'npub1chat',
      createdAt: 1,
      updatedAt: 1,
    }
    await getDatabase().contacts.put(legacy)
    const repo = new DexieContactRepository()
    expect((await repo.getById('alice'))?.addresses).toEqual([
      { value: 'npub1wallet', type: 'npub' },
    ])
    expect(await repo.findByAddress('npub1chat')).toBeNull()
  })
})
