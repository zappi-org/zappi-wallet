/**
 * Pins nostr-tools' synthetic-EOSE default.
 *
 * If a relay never sends EOSE, AbstractRelay fires a **synthetic EOSE** through the
 * same callback as a real one after baseEoseTimeout (4400ms). The cursor path overrides
 * this via CURSOR_EOSE_TIMEOUT_MS — if a library upgrade changes this behavior
 * (default value or option removal), it must surface here.
 */
import { describe, it, expect } from 'vitest'
import { AbstractRelay } from 'nostr-tools/abstract-relay'
import { CURSOR_EOSE_TIMEOUT_MS } from '@/adapters/nostr/nostr-gateway'

describe('nostr-tools synthetic-EOSE default (pin)', () => {
  it('baseEoseTimeout is still 4400ms — the value our guard must exceed', () => {
    const relay = new AbstractRelay('wss://pin.invalid/', { verifyEvent: (() => true) as never })
    expect(relay.baseEoseTimeout).toBe(4_400)
  })

  it('our cursor guard vastly exceeds the library default', () => {
    expect(CURSOR_EOSE_TIMEOUT_MS).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })

  it('enableReconnect/enablePing stay OFF by default — the controller owns reconnection [F19]', () => {
    // SessionController is the sole owner of reconnection. If a library upgrade flips
    // this default on, we get double re-subscription (controller attach + the library's
    // own reconnect) — the signal that we then need to wire the option explicitly OFF.
    const relay = new AbstractRelay('wss://pin.invalid/', { verifyEvent: (() => true) as never })
    const raw = relay as unknown as Record<string, unknown>
    for (const key of ['enableReconnect', 'enablePing']) {
      if (key in raw) {
        expect(raw[key]).toBeFalsy()
      }
    }
  })
})
