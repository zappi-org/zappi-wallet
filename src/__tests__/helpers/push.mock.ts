/**
 * PushNotificationGateway test doubles — shared by the adapter, observer and
 * registry (hooks) tests so the port shape lives in one place.
 */
import { vi } from 'vitest'
import type { PushNotificationGateway } from '@/core/ports/driven/push-notification.port'

/** Happy-path double: granted permission, registrations accepted. */
export function createPushGatewayMock(
  overrides: Partial<PushNotificationGateway> = {},
): PushNotificationGateway {
  return {
    supported: true,
    permission: () => 'granted',
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    notifyIncoming: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** Environment without push support (non-PWA / jsdom default). */
export function createUnsupportedPushGateway(): PushNotificationGateway {
  return createPushGatewayMock({
    supported: false,
    permission: () => 'unsupported',
    enable: vi.fn().mockResolvedValue(false),
  })
}
