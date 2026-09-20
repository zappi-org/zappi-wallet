import type { ChatUseCase } from '@/core/ports/driving/chat.usecase'
import { ChatStorageInitializationError } from '@/core/errors/chat'

interface StorageCipherSession {
  unlock(seed: Uint8Array): Promise<void>
  lock(): void
}

/** Coordinates storage keys with chat work, independently of relay reconnects. */
export function createChatStorageSession(
  chat: Pick<ChatUseCase, 'disconnect'>,
  cipher: StorageCipherSession,
  repository: { initialize(): Promise<void>; clearCache(): void }
) {
  let generation = 0
  let disposed = false
  const lock = () => {
    generation++
    cipher.lock()
    repository.clearCache()
    chat.disconnect()
  }
  return {
    async unlock(seed: Uint8Array) {
      if (disposed) throw new Error('Chat storage session disposed')
      const current = ++generation
      repository.clearCache()
      const check = () => {
        if (disposed || current !== generation)
          throw new Error('Chat storage session locked')
      }
      let stage: 'key' | 'migration' = 'key'
      try {
        await cipher.unlock(seed)
        check()
        stage = 'migration'
        await repository.initialize()
        check()
      } catch (error) {
        if (current === generation) {
          cipher.lock()
          repository.clearCache()
          chat.disconnect()
        }
        throw new ChatStorageInitializationError(stage, error)
      }
    },
    lock,
    dispose() {
      disposed = true
      lock()
    },
  }
}
