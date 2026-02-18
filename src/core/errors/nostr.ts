import { BaseError } from './base'

/**
 * Cannot connect to relay
 */
export class RelayConnectionError extends BaseError {
  readonly code = 'RELAY_CONNECTION'
  readonly isRetryable = true

  constructor(
    public readonly relayUrl: string,
    cause?: unknown
  ) {
    super(`Cannot connect to relay: ${relayUrl}`, cause)
  }

  toUserMessage(): string {
    return '릴레이에 연결할 수 없습니다'
  }
}

/**
 * Event publish failed
 */
export class EventPublishError extends BaseError {
  readonly code = 'EVENT_PUBLISH_FAILED'
  readonly isRetryable = true

  constructor(
    public readonly eventKind: number,
    public readonly failedRelays: string[],
    cause?: unknown
  ) {
    super(`Failed to publish event kind ${eventKind} to relays: ${failedRelays.join(', ')}`, cause)
  }

  toUserMessage(): string {
    return '이벤트 발행에 실패했습니다'
  }
}

/**
 * Event not found
 */
export class EventNotFoundError extends BaseError {
  readonly code = 'EVENT_NOT_FOUND'
  readonly isRetryable = false

  constructor(
    public readonly eventId?: string,
    public readonly filter?: object,
    cause?: unknown
  ) {
    super(eventId ? `Event not found: ${eventId}` : 'Event not found with given filter', cause)
  }

  toUserMessage(): string {
    return '이벤트를 찾을 수 없습니다'
  }
}

/**
 * NIP-17 decryption failed
 */
export class DecryptionError extends BaseError {
  readonly code = 'DECRYPTION_FAILED'
  readonly isRetryable = false

  constructor(message = 'Failed to decrypt message', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return '메시지 복호화에 실패했습니다'
  }
}

/**
 * NIP-05 lookup failed
 */
export class Nip05LookupError extends BaseError {
  readonly code = 'NIP05_LOOKUP_FAILED'
  readonly isRetryable = true

  constructor(
    public readonly identifier: string,
    cause?: unknown
  ) {
    super(`NIP-05 lookup failed for: ${identifier}`, cause)
  }

  toUserMessage(): string {
    return 'NIP-05 조회에 실패했습니다'
  }
}

/**
 * Invalid event signature
 */
export class InvalidSignatureError extends BaseError {
  readonly code = 'INVALID_SIGNATURE'
  readonly isRetryable = false

  constructor(
    public readonly eventId: string,
    cause?: unknown
  ) {
    super(`Invalid signature for event: ${eventId}`, cause)
  }

  toUserMessage(): string {
    return '유효하지 않은 서명입니다'
  }
}

/**
 * Classify Nostr error from raw error
 */
export function classifyNostrError(error: unknown): BaseError {
  const msg = String(error).toLowerCase()

  if (msg.includes('connect') || msg.includes('websocket') || msg.includes('network')) {
    return new RelayConnectionError('unknown', error)
  }

  if (msg.includes('decrypt')) {
    return new DecryptionError(String(error), error)
  }

  if (msg.includes('signature') || msg.includes('verify')) {
    return new InvalidSignatureError('unknown', error)
  }

  if (msg.includes('nip-05') || msg.includes('nip05')) {
    return new Nip05LookupError('unknown', error)
  }

  return new RelayConnectionError('unknown', error)
}
