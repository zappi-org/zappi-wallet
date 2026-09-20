import { describe, expect, it, vi } from 'vitest'
import { createChatStorageSession } from '@/composition/chat-storage-session'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('chat storage lifecycle', () => {
  it('revokes storage before disconnecting and invalidates pending migration', async () => {
    const migration = deferred()
    const order: string[] = []
    const cipher = {
      unlock: vi.fn().mockResolvedValue(undefined),
      lock: vi.fn(() => { order.push('key revoked') }),
    }
    const chat = { disconnect: vi.fn(() => { order.push('chat disconnected') }) }
    const repository = { initialize: vi.fn(() => migration.promise), clearCache: vi.fn() }
    const session = createChatStorageSession(chat, cipher, repository)
    const opening = session.unlock(new Uint8Array(64))
    await vi.waitFor(() => expect(repository.initialize).toHaveBeenCalledOnce())
    session.lock()
    expect(order).toEqual(['key revoked', 'chat disconnected'])
    expect(repository.clearCache).toHaveBeenCalledTimes(2)
    migration.resolve()
    await expect(opening).rejects.toThrow('locked')
  })

  it('reopens storage on the next unlock without changing the registry', async () => {
    const cipher = { unlock: vi.fn().mockResolvedValue(undefined), lock: vi.fn() }
    const repository = { initialize: vi.fn().mockResolvedValue(undefined), clearCache: vi.fn() }
    const session = createChatStorageSession({ disconnect: vi.fn() }, cipher, repository)
    const seed = new Uint8Array(64)
    await session.unlock(seed)
    session.lock()
    await session.unlock(seed)
    expect(cipher.unlock).toHaveBeenCalledTimes(2)
    expect(repository.initialize).toHaveBeenCalledTimes(2)
  })

  it('fails closed after migration failure and prevents use after disposal', async () => {
    const cipher = { unlock: vi.fn().mockResolvedValue(undefined), lock: vi.fn() }
    const repository = { initialize: vi.fn().mockRejectedValue(new Error('corrupt record')), clearCache: vi.fn() }
    const session = createChatStorageSession({ disconnect: vi.fn() }, cipher, repository)
    await expect(session.unlock(new Uint8Array(64))).rejects.toThrow('corrupt record')
    expect(cipher.lock).toHaveBeenCalledOnce()
    session.dispose()
    await expect(session.unlock(new Uint8Array(64))).rejects.toThrow('disposed')
    expect(cipher.unlock).toHaveBeenCalledOnce()
  })
})
