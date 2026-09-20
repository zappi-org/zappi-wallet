import type { ChatStorageCipher } from '@/core/ports/driven/chat-storage-cipher.port'

// Explicit test double; production repositories always require a real cipher.
export const testChatCipher: ChatStorageCipher = {
  assertUnlocked() {},
  captureGuard: () => () => {},
  encrypt: async (value, context) => JSON.stringify({ context, value }),
  decrypt: async (value, context) => {
    const record = JSON.parse(value)
    if (JSON.stringify(record.context) !== JSON.stringify(context))
      throw new Error('Invalid context')
    return record.value
  },
}
