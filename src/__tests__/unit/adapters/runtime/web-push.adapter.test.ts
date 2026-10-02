import { describe, expect, it, vi } from 'vitest'
import { getPublicKey } from 'nostr-tools'
import {
  INCOMING_TAG,
  PUSH_KIND_NIP_1059,
  PUSH_LABEL_TITLE,
  PUSH_LABEL_ZAPPI_NIP_17,
  WebPushAdapter,
  readKkachiConfig,
  urlBase64ToUint8Array,
  type KkachiConfig,
  type PushBrowser,
  type PushDevOptions,
  type PushPermission,
  type PushSdk,
} from '@/adapters/runtime/web-push.adapter'
import type { PushMaterial } from 'kkachi/protocol'

const CONFIG: KkachiConfig = {
  serverUrl: 'http://localhost:8787',
  vapidPublicKey: 'BHs0jGCNGgpxizWLWwEOeR4KqPCySV_evIfY_S_VRLumHvw0xqA6aDI2A6I-MBP1GfmCo3R5XJGR9jrvuyAuWng',
  devTools: false,
}
const IDENTITY = new Uint8Array(32).fill(9)
const MATERIAL: PushMaterial = { endpoint: 'https://push.example/xyz', keys: { p256dh: 'p', auth: 'a' } }

type BrowserOptions = { permission?: PushPermission; request?: PushPermission; existing?: boolean; vapidMismatch?: boolean; noRegistration?: boolean }
type Spec = {
  name: string
  act?: 'sync'
  config?: KkachiConfig | null
  browser?: BrowserOptions
  sdk?: { status?: number; reject?: boolean; bad?: boolean }
  relays?: string[]
  opts?: PushDevOptions
  /** Sync-time persisted intent (or null = production defaults). */
  intent?: PushDevOptions | null
  ok?: boolean
  sub: number
  pm?: number
  unsub?: number
}

function harness(c: Spec) {
  const unsubscribe = vi.fn().mockResolvedValue(true)
  const key = c.browser?.vapidMismatch ? new Uint8Array([1, 2, 3]) : urlBase64ToUint8Array(CONFIG.vapidPublicKey)
  const subscription = { toJSON: () => MATERIAL, unsubscribe, options: { applicationServerKey: key } }
  const pushManager = c.browser?.noRegistration
    ? undefined
    : { getSubscription: vi.fn().mockResolvedValue(c.browser?.existing ? subscription : null), subscribe: vi.fn().mockResolvedValue(subscription) }
  const browser: PushBrowser = {
    isSupported: () => true,
    permission: () => c.browser?.permission ?? 'granted',
    requestPermission: vi.fn().mockResolvedValue(c.browser?.request ?? 'granted'),
    getRegistration: vi.fn().mockResolvedValue(pushManager ? ({ pushManager } as unknown as ServiceWorkerRegistration) : null),
    showNotification: vi.fn().mockResolvedValue(undefined),
  }
  const sdk: PushSdk = {
    subscribe: c.sdk?.reject ? vi.fn().mockRejectedValue(new TypeError('Load failed')) : vi.fn().mockResolvedValue(new Response('{}', { status: c.sdk?.status ?? 200 })),
    unsubscribe: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    parsePushMaterial: vi.fn(async (value: unknown) => (c.sdk?.bad ? null : (value as PushMaterial))),
    getSubscription: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
  }
  const labelToken = vi.fn().mockResolvedValue('label-token-abc')
  const storeLabel = vi.fn().mockResolvedValue(undefined)
  const persistIntent = vi.fn().mockResolvedValue(undefined)
  const readIntent = vi.fn().mockResolvedValue(c.intent === undefined ? null : c.intent)
  const adapter = new WebPushAdapter({ config: c.config === undefined ? CONFIG : c.config, identitySecretKey: IDENTITY, browser, sdk, labelToken, storeLabel, persistIntent, readIntent })
  return { adapter, sdk, browser, pushManager, unsubscribe, storeLabel, persistIntent, readIntent }
}

const CASES: Spec[] = [
  { name: 'enable registers when permission granted', ok: true, sub: 1 },
  { name: 'enable returns false without config', config: null, ok: false, sub: 0 },
  { name: 'enable returns false when permission denied', browser: { request: 'denied' }, ok: false, sub: 0 },
  { name: 'enable returns false without an active service worker', browser: { noRegistration: true }, ok: false, sub: 0 },
  { name: 'enable returns false on invalid push material', sdk: { bad: true }, ok: false, sub: 0 },
  { name: 'enable returns false when the server rejects (401)', sdk: { status: 401 }, ok: false, sub: 1 },
  { name: 'enable returns false when the request throws', sdk: { reject: true }, ok: false, sub: 1 },
  { name: 'enable forwards the relay list', relays: ['wss://relay.example'], ok: true, sub: 1 },
  { name: 'enable reuses a subscription bound to the current VAPID key', browser: { existing: true }, ok: true, sub: 1, pm: 0 },
  { name: 'enable resubscribes when the VAPID key changed', browser: { existing: true, vapidMismatch: true }, ok: true, sub: 1, pm: 1, unsub: 1 },
  { name: 'sync skips when permission is not granted', act: 'sync', browser: { permission: 'denied' }, sub: 0 },
  { name: 'sync registers when permission is granted', act: 'sync', sub: 1 },
  { name: 'dev: token without label resolution (store off) shows payload as-is', opts: { obfuscate: true, store: false }, ok: true, sub: 1 },
  { name: 'dev: plaintext label registered verbatim', opts: { obfuscate: false, label: 'EDITABLE-LABEL' }, ok: true, sub: 1 },
  { name: 'dev: sync honors the persisted raw mode (store off)', act: 'sync', intent: { obfuscate: true, store: false }, sub: 1 },
  { name: 'dev: custom resolution title stored in mode 2', opts: { label: 'dsdasda', title: '테스트 타이틀' }, ok: true, sub: 1 },
]

describe('web-push helpers', () => {
  it('reads config from env and feature-gates on missing values', () => {
    expect(readKkachiConfig({})).toBeNull()
    expect(readKkachiConfig({ VITE_KKACHI_SERVER_URL: 'https://x' })).toBeNull()
    expect(readKkachiConfig({ VITE_KKACHI_SERVER_URL: 'https://x', VITE_KKACHI_VAPID_PUBLIC_KEY: 'k', VITE_KKACHI_DEV_TOOLS: '1' })).toEqual({ serverUrl: 'https://x', vapidPublicKey: 'k', devTools: true })
    expect(readKkachiConfig({ VITE_KKACHI_SERVER_URL: 'https://x', VITE_KKACHI_VAPID_PUBLIC_KEY: 'k' })?.devTools).toBe(false)
  })

  it('decodes base64url VAPID keys', () => {
    expect([...urlBase64ToUint8Array('SGVsbG8')]).toEqual([72, 101, 108, 108, 111])
  })
})

describe('WebPushAdapter enable()/sync()', () => {
  it.each(CASES)('$name', async (c) => {
    const h = harness(c)
    if (c.act === 'sync') await h.adapter.sync(c.relays)
    else await expect(h.adapter.enable(c.relays, c.opts)).resolves.toBe(c.ok)

    if (c.act === 'sync' && (c.browser?.permission ?? 'granted') === 'granted') expect(h.readIntent).toHaveBeenCalled()
    else if (c.opts !== undefined) expect(h.persistIntent).toHaveBeenCalledWith(c.opts)

    expect(h.sdk.subscribe).toHaveBeenCalledTimes(c.sub)
    if (c.pm !== undefined) expect(h.pushManager?.subscribe).toHaveBeenCalledTimes(c.pm)
    if (c.unsub !== undefined) expect(h.unsubscribe).toHaveBeenCalledTimes(c.unsub)
    if (c.sub > 0) {
      const called = (h.sdk.subscribe as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
      const opts = c.opts ?? (c.act === 'sync' ? (c.intent ?? {}) : {})
      const expectedMessage = opts.obfuscate === false ? (opts.label ?? PUSH_LABEL_ZAPPI_NIP_17) : 'label-token-abc'
      expect(called[0]).toBe(CONFIG.serverUrl)
      expect(called[1]).toEqual(expect.objectContaining({ inboxPub: getPublicKey(IDENTITY) }))
      expect(called[2]).toBe(MATERIAL)
      expect(called[3]).toMatchObject({ kinds: [PUSH_KIND_NIP_1059], message: expectedMessage })
      if (c.relays) expect(called[3]).toMatchObject({ relays: c.relays })
      // 단일 레코드: mode 2 → 등록 타이틀(기본 '새 알림'), mode 1/평문 → null
      const expectedTitle =
        (opts.obfuscate ?? true) && (opts.store ?? true)
          ? (opts.title?.trim() || PUSH_LABEL_TITLE)
          : null
      expect(h.storeLabel).toHaveBeenCalledWith(expectedMessage, expectedTitle)
    }
  })
})

describe('WebPushAdapter disable()/notifyIncoming()', () => {
  it('disable drops the browser subscription and the server record', async () => {
    const h = harness({ name: 'x', browser: { existing: true }, sub: 0 })
    await h.adapter.disable()
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    expect(h.sdk.unsubscribe).toHaveBeenCalledWith(CONFIG.serverUrl, expect.anything())
  })

  it.each([['granted', true], ['denied', false]])('notifyIncoming when permission=%s', async (permission, show) => {
    const h = harness({ name: 'x', browser: { permission: permission as PushPermission }, sub: 0 })
    await h.adapter.notifyIncoming('1000 sats received')
    if (show) expect(h.browser.showNotification).toHaveBeenCalledWith('1000 sats received', expect.objectContaining({ tag: INCOMING_TAG }))
    else expect(h.browser.showNotification).not.toHaveBeenCalled()
  })
})
