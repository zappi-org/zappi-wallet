/**
 * nostr-tools 합성 EOSE 기본값 pin (2단계 리뷰 #1 / [F19]와 동일 정신)
 *
 * AbstractRelay는 relay가 EOSE를 안 보내면 baseEoseTimeout(4400ms) 뒤
 * **합성 EOSE**를 진짜와 같은 콜백으로 발화한다. cursor 경로는
 * CURSOR_EOSE_TIMEOUT_MS로 이를 덮는다 — 라이브러리 업그레이드가 이 동작을
 * 바꾸면(기본값 변경·옵션 제거) 여기서 표면화되어야 한다.
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
})
