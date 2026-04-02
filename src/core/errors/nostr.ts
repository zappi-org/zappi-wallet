import { BaseError } from './base'

/**
 * Cannot connect to relay
 */
export class RelayConnectionError extends BaseError {
  readonly code = 'RELAY_CONNECTION' as const
  readonly isRetryable = true

  constructor(
    public readonly relayUrl: string,
    cause?: unknown
  ) {
    super(`Cannot connect to relay: ${relayUrl}`, cause)
  }
}

/**
 * Event publish failed
 */
export class EventPublishError extends BaseError {
  readonly code = 'EVENT_PUBLISH_FAILED' as const
  readonly isRetryable = true

  constructor(
    public readonly eventKind: number,
    public readonly failedRelays: string[],
    cause?: unknown
  ) {
    super(`Failed to publish event kind ${eventKind} to relays: ${failedRelays.join(', ')}`, cause)
  }
}

/**
 * Event not found
 */
export class EventNotFoundError extends BaseError {
  readonly code = 'EVENT_NOT_FOUND' as const
  readonly isRetryable = false

  constructor(
    public readonly eventId?: string,
    public readonly filter?: object,
    cause?: unknown
  ) {
    super(eventId ? `Event not found: ${eventId}` : 'Event not found with given filter', cause)
  }
}

/**
 * NIP-17 decryption failed
 */
export class DecryptionError extends BaseError {
  readonly code = 'MESSAGE_DECRYPTION_FAILED' as const
  readonly isRetryable = false

  constructor(message = 'Failed to decrypt message', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * NIP-05 lookup failed
 */
export class Nip05LookupError extends BaseError {
  readonly code = 'NIP05_LOOKUP_FAILED' as const
  readonly isRetryable = true

  constructor(
    public readonly identifier: string,
    cause?: unknown
  ) {
    super(`NIP-05 lookup failed for: ${identifier}`, cause)
  }
}

/**
 * Invalid event signature
 */
export class InvalidSignatureError extends BaseError {
  readonly code = 'INVALID_SIGNATURE' as const
  readonly isRetryable = false

  constructor(
    public readonly eventId: string,
    cause?: unknown
  ) {
    super(`Invalid signature for event: ${eventId}`, cause)
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
