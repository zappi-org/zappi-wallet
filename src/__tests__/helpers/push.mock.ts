/**
 * WebPushAdapter test doubles, keyed to the concrete adapter shape the
 * registry, observer and dev-tools tests need.
 */
import { vi } from 'vitest'
import type { WebPushAdapter } from '@/adapters/runtime/web-push.adapter'

/** Happy-path double: granted permission, registrations accepted. */
export function createPushGatewayMock(
  overrides: Partial<WebPushAdapter> = {},
): WebPushAdapter {
  return {
    supported: true,
    permission: () => 'granted',
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    notifyIncoming: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as WebPushAdapter
}

/** Environment without push support (non-PWA / jsdom default). */
export function createUnsupportedPushGateway(): WebPushAdapter {
  return createPushGatewayMock({
    supported: false,
    permission: () => 'unsupported',
    enable: vi.fn().mockResolvedValue(false),
  })
}