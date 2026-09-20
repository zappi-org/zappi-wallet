import { describe, expect, it, vi } from 'vitest'
import { createChatStorageSession } from '@/composition/chat-storage-session'
import { ChatStorageInitializationError } from '@/core/errors/chat'

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
    const cause = new Error('corrupt record')
    const cipher = { unlock: vi.fn().mockResolvedValue(undefined), lock: vi.fn() }
    const repository = { initialize: vi.fn().mockRejectedValue(cause), clearCache: vi.fn() }
    const chat = { disconnect: vi.fn() }
    const session = createChatStorageSession(chat, cipher, repository)
    await expect(session.unlock(new Uint8Array(64))).rejects.toMatchObject({
      name: 'ChatStorageInitializationError',
      code: 'chat-storage:migration:unknown',
      stage: 'migration',
      cause,
    })
    expect(cipher.lock).toHaveBeenCalledOnce()
    expect(chat.disconnect).toHaveBeenCalledOnce()
    expect(repository.clearCache).toHaveBeenCalledTimes(2)
    session.dispose()
    await expect(session.unlock(new Uint8Array(64))).rejects.toThrow('disposed')
    expect(cipher.unlock).toHaveBeenCalledOnce()
  })

  it('identifies key failure without entering migration or exposing the cause', async () => {
    const secret = 'private draft and payment token'
    const cause = new DOMException(secret, 'OperationError')
    const cipher = { unlock: vi.fn().mockRejectedValue(cause), lock: vi.fn() }
    const repository = { initialize: vi.fn(), clearCache: vi.fn() }
    const chat = { disconnect: vi.fn() }
    const session = createChatStorageSession(chat, cipher, repository)
    const error = await session.unlock(new Uint8Array(64)).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ChatStorageInitializationError)
    expect(error).toMatchObject({ code: 'chat-storage:key:authentication', cause })
    expect(String(error)).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(secret)
    expect(repository.initialize).not.toHaveBeenCalled()
    expect(chat.disconnect).toHaveBeenCalledOnce()
  })

  it.each([
    ['Error', 'Chat storage key missing', 'key-missing'],
    ['Error', 'Unsupported chat storage version', 'unsupported-version'],
    ['Error', 'Chat account or scope mismatch', 'invalid-data'],
    ['Error', 'Chat storage session changed', 'locked'],
    ['QuotaExceededError', 'private data', 'quota'],
    ['VersionError', 'private data', 'database-schema'],
    ['DatabaseClosedError', 'private data', 'database-unavailable'],
    ['TransactionInactiveError', 'private data', 'transaction'],
    ['PrematureCommitError', 'private data', 'transaction'],
    ['NotSupportedError', 'private data', 'crypto-unavailable'],
    ['private error name', 'private data', 'unknown'],
    ['constructor', 'toString', 'unknown'],
  ])('classifies %s safely as %s', (name, message, reason) => {
    const cause = new Error(message)
    cause.name = name
    const error = new ChatStorageInitializationError('migration', cause)
    expect(error.code).toBe(`chat-storage:migration:${reason}`)
    expect(error.cause).toBe(cause)
    expect(JSON.stringify(error)).not.toContain('private')
  })

  it('does not revoke a newer unlock when an older initialization fails', async () => {
    const first = deferred()
    const cipher = { unlock: vi.fn().mockResolvedValue(undefined), lock: vi.fn() }
    const repository = {
      initialize: vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined),
      clearCache: vi.fn(),
    }
    const chat = { disconnect: vi.fn() }
    const session = createChatStorageSession(chat, cipher, repository)
    const opening = session.unlock(new Uint8Array(64))
    await vi.waitFor(() => expect(repository.initialize).toHaveBeenCalledOnce())
    await session.unlock(new Uint8Array(64))
    first.resolve()
    await expect(opening).rejects.toMatchObject({ reason: 'locked' })
    expect(cipher.lock).not.toHaveBeenCalled()
    expect(chat.disconnect).not.toHaveBeenCalled()
  })
})
