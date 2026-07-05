/**
 * activate() 배선 pin (설계 §10 B3 — 6단계 리뷰 #1 blocker 재발 방지)
 *
 * 레거시 경로는 fetchGiftWraps/sendDM 내부의 connect(params.relays) 부수효과가
 * 연결을 암묵 확립했지만, 컨트롤러 경로는 그 라인에 도달하지 않는다 — unlock
 * (activate)이 persistent 집합(DEFAULT_RELAYS + settings.relays)을 **명시**
 * 확립해야 라이브 구독 attach·발행·수신자 resolve가 성립한다. 이 배선이
 * 사라지면 944개 단위 테스트가 전부 통과한 채 지갑의 실시간 수신이 죽는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_RELAYS } from '@/core/constants'

const gatewayInstances: Array<Record<string, ReturnType<typeof vi.fn>>> = []

vi.mock('@/adapters/nostr/nostr-gateway', () => ({
  CURSOR_EOSE_TIMEOUT_MS: 24 * 60 * 60 * 1000,
  NostrGatewayAdapter: class MockNostrGateway {
    connect = vi.fn().mockResolvedValue(undefined)
    disconnect = vi.fn()
    publish = vi.fn()
    queryEvents = vi.fn().mockResolvedValue([])
    subscribe = vi.fn().mockReturnValue(() => {})
    subscribeGiftWraps = vi.fn().mockReturnValue(() => {})
    fetchGiftWraps = vi.fn().mockResolvedValue([])
    sendPrivateDirectMessage = vi.fn()
    sendGiftWrap = vi.fn()
    getRelayStatus = vi.fn().mockReturnValue([])
    constructor() {
      gatewayInstances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>)
    }
  },
}))

vi.mock('@/modules/cashu/cashu-runtime', () => ({
  getCashuRuntimeManager: vi.fn().mockResolvedValue({
    on: vi.fn().mockReturnValue(() => {}),
  }),
  enableCashuWatchers: vi.fn().mockResolvedValue(undefined),
  pauseCashuSubscriptions: vi.fn().mockResolvedValue(undefined),
  resumeCashuSubscriptions: vi.fn().mockResolvedValue(undefined),
  recheckCashuPendingMintQuotes: vi.fn().mockResolvedValue(undefined),
  getCashuKeyring: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/modules/cashu/internal/cashu-recovery', () => ({
  cleanAndRecoverStaleMintOps: vi.fn().mockResolvedValue({ recovered: 0, abandoned: 0, failed: 0 }),
}))

vi.mock('@/modules/cashu/create-cashu-backend', () => ({
  createCashuBackend: vi.fn().mockReturnValue({
    receiveToken: vi.fn(),
    redeemPendingReceivedTokens: vi.fn().mockResolvedValue({ redeemed: 0, failed: 0 }),
  }),
}))

vi.mock('@/modules/cashu/cashu.module', () => ({
  CashuModule: class {
    id = 'cashu'
    initialize = vi.fn()
    dispose = vi.fn()
    isEnabled = vi.fn().mockReturnValue(false)
    getPaymentAdapters = vi.fn().mockReturnValue([])
    getCapabilities = vi.fn().mockReturnValue([])
    getBalance = vi.fn().mockResolvedValue({ moduleId: 'cashu', accounts: [], total: { value: 0n, unit: 'sat' } })
    on = vi.fn().mockReturnValue(() => {})
    recoverAccount = vi.fn()
  },
}))

import { createBootstrap } from '@/composition/bootstrap'
import { useAppStore } from '@/store'

describe('bootstrap activate — persistent relay 확립 배선 pin', () => {
  beforeEach(() => {
    gatewayInstances.length = 0
  })

  it('activate connects the gateway to DEFAULT_RELAYS + settings.relays', async () => {
    const userRelay = 'wss://user-configured.relay'
    useAppStore.setState((state) => ({
      settings: { ...state.settings, relays: [userRelay] },
    }))

    const result = createBootstrap({
      nostrPrivateKeyHex: 'a'.repeat(64),
      bip39Seed: new Uint8Array(64).fill(1),
    })

    await result.activate()

    const gateway = gatewayInstances[0]
    expect(gateway).toBeDefined()
    expect(gateway.connect).toHaveBeenCalledTimes(1)

    const connectedTo = gateway.connect.mock.calls[0][0] as string[]
    for (const relay of DEFAULT_RELAYS) {
      expect(connectedTo).toContain(relay)
    }
    expect(connectedTo).toContain(userRelay)

    result.dispose()
  })
})
