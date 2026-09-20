export class ChatAddressError extends Error {
  constructor(readonly reason: 'invalid' | 'self') {
    super(reason === 'self' ? 'Cannot open a chat with yourself' : 'Invalid recipient')
    this.name = 'ChatAddressError'
  }
}

type ChatStorageStage = 'key' | 'migration'
type ChatStorageFailure =
  | 'authentication'
  | 'key-missing'
  | 'invalid-data'
  | 'unsupported-version'
  | 'locked'
  | 'quota'
  | 'database-schema'
  | 'database-unavailable'
  | 'transaction'
  | 'crypto-unavailable'
  | 'unknown'

function storageFailure(cause: unknown): ChatStorageFailure {
  if (!cause || typeof cause !== 'object') return 'unknown'
  const name = 'name' in cause && typeof cause.name === 'string' ? cause.name : ''
  const message = 'message' in cause && typeof cause.message === 'string' ? cause.message : ''
  const names: Record<string, ChatStorageFailure> = {
    OperationError: 'authentication',
    QuotaExceededError: 'quota',
    VersionError: 'database-schema',
    SchemaError: 'database-schema',
    NotFoundError: 'database-schema',
    DatabaseClosedError: 'database-unavailable',
    OpenFailedError: 'database-unavailable',
    MissingAPIError: 'database-unavailable',
    InvalidStateError: 'database-unavailable',
    SecurityError: 'database-unavailable',
    AbortError: 'transaction',
    TransactionInactiveError: 'transaction',
    PrematureCommitError: 'transaction',
    TimeoutError: 'transaction',
    NotSupportedError: 'crypto-unavailable',
  }
  if (Object.hasOwn(names, name)) return names[name]
  const messages: Record<string, ChatStorageFailure> = {
    'Chat storage key missing': 'key-missing',
    'Invalid chat storage key': 'invalid-data',
    'Invalid chat ciphertext': 'invalid-data',
    'Invalid chat message content': 'invalid-data',
    'Invalid chat conversation content': 'invalid-data',
    'Invalid legacy chat payment link': 'invalid-data',
    'Chat account or scope mismatch': 'invalid-data',
    'Unsupported chat storage version': 'unsupported-version',
    'Unsupported chat ciphertext': 'unsupported-version',
    'Chat storage locked': 'locked',
    'Chat storage session locked': 'locked',
    'Chat storage session changed': 'locked',
  }
  return Object.hasOwn(messages, message) ? messages[message] : 'unknown'
}

export class ChatStorageInitializationError extends Error {
  readonly reason: ChatStorageFailure
  readonly code: string

  constructor(readonly stage: ChatStorageStage, cause: unknown) {
    const reason = storageFailure(cause)
    const code = `chat-storage:${stage}:${reason}`
    super(code, { cause })
    this.name = 'ChatStorageInitializationError'
    this.reason = reason
    this.code = code
  }
}

export class ChatCapacityError extends Error {
  constructor(readonly kind: 'storage' | 'receive') {
    super(
      kind === 'storage'
        ? 'Chat storage limit reached'
        : 'Chat receive queue is full'
    )
    this.name = 'ChatCapacityError'
  }
}
