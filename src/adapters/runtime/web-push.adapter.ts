/**
 * WebPushAdapter — browser Push API + `kkachi` SDK (NIP-98) integration.
 * and the browser Push API. Registers under the wallet's real npub (senders
 * still target it until the ReceiveRequest inbox path ships; the server then
 * stores the identity pubkey — docs L12/L13). The secret never leaves the
 * device and the SDK is loaded lazily.
 */

import { getPublicKey } from 'nostr-tools'
import type { InboxSigner } from 'kkachi/register'
import type { PushMaterial } from 'kkachi/protocol'

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export const INCOMING_TAG = 'zappi-incoming'

/** IndexedDB where the adapter stores label tokens for the service worker (shared origin). */
export const PUSH_DB_NAME = 'zappi-push-labels'
export const PUSH_STORE_NAME = 'labels'
/** Persisted dev/production registration intent — sync() re-registers from this. */
export const PUSH_CONFIG_STORE = 'config'
export const PUSH_INTENT_KEY = 'push-intent'

/** Gift-wrap wake-up subscription kind — the kkachi server ALLOWED_KINDS whitelist needs it. */
export const PUSH_KIND_NIP_1059 = 1059
/**
 * Label obfuscated with a per-wallet HKDF salt (kkachi labelToken): the server
 * and OS notification only ever see the token, never this plaintext. The SW
 * matches the token to PUSH_LABEL_TITLE for the background notification.
 */
export const PUSH_LABEL_ZAPPI_NIP_17 = 'ZAPPI_NIP_17'
export const PUSH_LABEL_TITLE = '새 알림'

export interface KkachiEnv {
  VITE_KKACHI_SERVER_URL?: string
  VITE_KKACHI_VAPID_PUBLIC_KEY?: string
  VITE_KKACHI_DEV_TOOLS?: string
}

export interface KkachiConfig {
  serverUrl: string
  vapidPublicKey: string
  /** Show the push diagnostics section (relay/register/self-1059) in Settings. */
  devTools: boolean
}

export function readKkachiConfig(
  env: KkachiEnv = import.meta.env as unknown as KkachiEnv,
): KkachiConfig | null {
  const serverUrl = env.VITE_KKACHI_SERVER_URL?.trim()
  const vapidPublicKey = env.VITE_KKACHI_VAPID_PUBLIC_KEY?.trim()
  if (!serverUrl || !vapidPublicKey) return null
  const devTools = env.VITE_KKACHI_DEV_TOOLS
  return { serverUrl, vapidPublicKey, devTools: devTools === '1' || devTools === 'true' }
}

/** The subset of the browser Push/Notification APIs the adapter needs. */
export interface PushBrowser {
  isSupported(): boolean
  permission(): PushPermission
  requestPermission(): Promise<PushPermission>
  getRegistration(): Promise<ServiceWorkerRegistration | null>
  showNotification(title: string, options: NotificationOptions): Promise<void>
}

/** kkachi 0.1.0 subscription options — kind whitelist + obfuscated label message. */
export interface PushSubscribeOptions {
  relays?: string[]
  message?: string
  kinds?: number[]
}

/**
 * Dev/test knobs for the subscription label message. Defaults are the
 * production path: obfuscate with a per-seed HKDF token and store it so the
 * SW deobfuscates to the label title.
 */
export interface PushDevOptions {
  /** Label text — verbatim payload in plaintext mode, else the obfuscated label. */
  label?: string
  /** False registers the label verbatim; true sends only its HKDF-salted token. */
  obfuscate?: boolean
  /**
   * True persists token→title so the SW resolves the label. False registers
   * token→null (overwrite via upsert — same deterministic token), so the SW
   * shows the payload verbatim. No delete needed: the null title overwrites
   * any resolution left by an earlier mode-2 registration.
   */
  store?: boolean
  /**
   * Display title when resolved (mode 2): stored in the local record only —
   * never sent to the server. The SW shows it on matching pushes.
   */
  title?: string
}

/** The subset of the kkachi SDK the adapter needs. */
export interface PushSdk {
  subscribe(
    baseUrl: string,
    signer: InboxSigner,
    push: PushMaterial,
    opts?: PushSubscribeOptions,
  ): Promise<Response>
  unsubscribe(baseUrl: string, signer: InboxSigner): Promise<Response>
  /** Returns the validated material, or null when the payload is malformed. */
  parsePushMaterial(value: unknown): Promise<PushMaterial | null>
  /** Server-side subscription read-back (dev diagnostics). */
  getSubscription(baseUrl: string, signer: InboxSigner): Promise<Response>
}

export interface WebPushAdapterDeps {
  /** null = push not configured (feature-gated off). */
  config: KkachiConfig | null
  /** Wallet nostr secret key — the NIP-98 signer is its real npub. */
  identitySecretKey: Uint8Array
  browser?: PushBrowser
  sdk?: PushSdk
  /** kkachi labelToken — per-seed HKDF salt → hashLabel(label). */
  labelToken?: (seed: Uint8Array, label: string) => Promise<string>
  /** Persist (title) or remove (null) the label resolution for a token. */
  storeLabel?: (token: string, title: string | null) => Promise<void>
  /** Persist the registration intent (label/mode) so background sync() honors it. */
  persistIntent?: (opts: PushDevOptions | null) => Promise<void>
  /** Read the persisted intent; null = production defaults. */
  readIntent?: () => Promise<PushDevOptions | null>
}

function createBrowserPush(): PushBrowser {
  const hasNotification = typeof Notification !== 'undefined'
  return {
    isSupported: () => hasNotification && typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    permission: () => (hasNotification ? (Notification.permission as PushPermission) : 'unsupported'),
    requestPermission: async () =>
      hasNotification ? ((await Notification.requestPermission()) as PushPermission) : 'unsupported',
    getRegistration: async () => {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
      return (await navigator.serviceWorker.getRegistration()) ?? null
    },
    showNotification: async (title, options) => {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.showNotification(title, options)
        return
      }
      // Dev server has no active worker — page-level fallback so the settings
      // test button still proves permission + payload. Not available on iOS.
      if (hasNotification) new Notification(title, options)
    },
  }
}

function createSdk(): PushSdk {
  return {
    async subscribe(baseUrl, signer, push, opts) {
      const { subscribe } = await import('kkachi/register')
      return subscribe(baseUrl, signer, push, opts)
    },
    async unsubscribe(baseUrl, signer) {
      const { unsubscribe } = await import('kkachi/register')
      return unsubscribe(baseUrl, signer)
    },
    async parsePushMaterial(value) {
      const { isPushMaterial } = await import('kkachi/protocol')
      return isPushMaterial(value) ? value : null
    },
    async getSubscription(baseUrl, signer) {
      const { getSubscription } = await import('kkachi/register')
      return getSubscription(baseUrl, signer)
    },
  }
}

/** The SDK only needs the `{ inboxPub, secretKey }` shape, so no library change is required. */
function createIdentitySigner(secretKey: Uint8Array): InboxSigner {
  return { inboxPub: getPublicKey(secretKey) as InboxSigner['inboxPub'], secretKey }
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** An existing push subscription is bound to the VAPID key it was created with. */
function matchesVapidKey(subscription: PushSubscription, vapidPublicKey: string): boolean {
  const key = subscription.options?.applicationServerKey
  return Boolean(key) && uint8ArrayToBase64Url(new Uint8Array(key as ArrayBuffer)) === vapidPublicKey
}

/** base64url (VAPID public key) → bytes for `applicationServerKey`. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function defaultLabelToken(seed: Uint8Array, label: string): Promise<string> {
  const { labelToken } = await import('kkachi/inbox-key')
  return labelToken(seed, label)
}

function createPushStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(PUSH_STORE_NAME)) db.createObjectStore(PUSH_STORE_NAME, { keyPath: 'token' })
  if (!db.objectStoreNames.contains(PUSH_CONFIG_STORE)) db.createObjectStore(PUSH_CONFIG_STORE, { keyPath: 'key' })
}

/**
 * Page/SW share the same-origin storage; the SW reads a single record on push
 * events. Version-free open (NO versionchange — never blocked/aborted by other
 * connections). The record is keyed by the message itself (keyPath 'token'; a
 * v3-remnant 'key' store is degraded-raw by design). A put to the same message
 * overwrites in place — last-writer-wins, no deletes.
 */
async function defaultStoreLabel(token: string, title: string | null): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(PUSH_DB_NAME)
    request.onupgradeneeded = () => createPushStores(request.result)
    request.onsuccess = () => {
      const db = request.result
      const store = db.transaction(PUSH_STORE_NAME, 'readwrite').objectStore(PUSH_STORE_NAME)
      const op = store.put({ token, title })
      op.onsuccess = () => resolve()
      op.onerror = () => reject(op.error)
    }
    request.onerror = () => reject(request.error)
  })
}

/** Persist (or clear with null) the registration intent in the shared IDB. */
async function defaultPersistIntent(opts: PushDevOptions | null): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(PUSH_DB_NAME)
    request.onupgradeneeded = () => createPushStores(request.result)
    request.onsuccess = () => {
      const store = request.result.transaction(PUSH_CONFIG_STORE, 'readwrite').objectStore(PUSH_CONFIG_STORE)
      const op = opts === null ? store.delete(PUSH_INTENT_KEY) : store.put({ key: PUSH_INTENT_KEY, ...opts })
      op.onsuccess = () => resolve()
      op.onerror = () => reject(op.error)
    }
    request.onerror = () => reject(request.error)
  })
}

/** Read the persisted intent; null when unset (production defaults apply). */
async function defaultReadIntent(): Promise<PushDevOptions | null> {
  if (typeof indexedDB === 'undefined') return null
  return new Promise((resolve) => {
    const request = indexedDB.open(PUSH_DB_NAME)
    request.onupgradeneeded = () => createPushStores(request.result)
    request.onsuccess = () => {
      const get = request.result.transaction(PUSH_CONFIG_STORE, 'readonly').objectStore(PUSH_CONFIG_STORE).get(PUSH_INTENT_KEY)
      get.onsuccess = () => {
        const entry = get.result as { label?: unknown; obfuscate?: unknown; store?: unknown; title?: unknown } | undefined
        if (!entry) return resolve(null)
        const intent: PushDevOptions = {}
        if (typeof entry.label === 'string') intent.label = entry.label
        if (typeof entry.obfuscate === 'boolean') intent.obfuscate = entry.obfuscate
        if (typeof entry.store === 'boolean') intent.store = entry.store
        if (typeof entry.title === 'string') intent.title = entry.title
        resolve(intent)
      }
      get.onerror = () => resolve(null)
    }
    request.onerror = () => resolve(null)
  })
}

export class WebPushAdapter {
  private readonly config: KkachiConfig | null
  private readonly signer: InboxSigner
  private readonly browser: PushBrowser
  private readonly sdk: PushSdk
  private readonly labelToken: (seed: Uint8Array, label: string) => Promise<string>
  private readonly storeLabel: (token: string, title: string | null) => Promise<void>
  private readonly persistIntent: (opts: PushDevOptions | null) => Promise<void>
  private readonly readIntent: () => Promise<PushDevOptions | null>
  /** Last registered message (this session) — dev readout keys on it. */
  private lastMessage: string | null = null

  constructor(deps: WebPushAdapterDeps) {
    this.config = deps.config
    this.signer = createIdentitySigner(deps.identitySecretKey)
    this.browser = deps.browser ?? createBrowserPush()
    this.sdk = deps.sdk ?? createSdk()
    this.labelToken = deps.labelToken ?? defaultLabelToken
    this.storeLabel = deps.storeLabel ?? defaultStoreLabel
    this.persistIntent = deps.persistIntent ?? defaultPersistIntent
    this.readIntent = deps.readIntent ?? defaultReadIntent
  }

  get supported(): boolean {
    return this.config !== null && this.browser.isSupported()
  }

  permission(): PushPermission {
    return this.supported ? this.browser.permission() : 'unsupported'
  }

  async enable(relays?: string[], opts?: PushDevOptions): Promise<boolean> {
    if (!this.supported) return false
    if ((await this.browser.requestPermission()) !== 'granted') return false
    // Dev 등록은 명시적 opts를 의도로 영속화 — 이후 sync()가 같은 모드를 재등록.
    if (opts !== undefined) await this.persistIntent(opts)
    return this.register(relays, opts)
  }

  async sync(relays?: string[]): Promise<void> {
    if (!this.supported || this.browser.permission() !== 'granted') return
    // Activate마다 재등록할 때는 영속된 의도(dev 모드)를 따르고, 없으면 프로덕션 기본값.
    const intent = await this.readIntent()
    await this.register(relays, intent ?? {})
  }

  async disable(): Promise<void> {
    if (!this.supported) return
    const registration = await this.browser.getRegistration()
    const subscription = await registration?.pushManager?.getSubscription()
    if (subscription) await subscription.unsubscribe()
    if (this.config) await this.sdk.unsubscribe(this.config.serverUrl, this.signer)
  }

  async notifyIncoming(summary: string): Promise<void> {
    if (this.permission() !== 'granted') return
    await this.browser.showNotification(summary, {
      tag: INCOMING_TAG,
      body: summary,
      data: { url: '/' },
    })
  }

  /** Dev diagnostics — what the server has registered for this signer. */
  async serverSubscription(): Promise<unknown> {
    if (!this.config) return null
    const response = await this.sdk.getSubscription(this.config.serverUrl, this.signer)
    if (!response.ok) return { error: `HTTP ${response.status}` }
    try {
      return (await response.json()) as unknown
    } catch {
      return { error: 'non-JSON response' }
    }
  }

  /** Dev diagnostics — the SW-visible label record for the last registered message. */
  async localLabelMap(): Promise<unknown> {
    if (typeof indexedDB === 'undefined') return { error: 'no indexedDB in page' }
    const message = this.lastMessage
    if (!message) return { note: '이번 세션에 등록한 메시지가 없음 — 등록 후 조회' }
    return new Promise((resolve) => {
      const request = indexedDB.open(PUSH_DB_NAME)
      request.onupgradeneeded = () => createPushStores(request.result)
      request.onsuccess = () => {
        const store = request.result.transaction(PUSH_STORE_NAME, 'readonly').objectStore(PUSH_STORE_NAME)
        const get = store.get(message)
        get.onsuccess = () => resolve(get.result ? [get.result] : [])
        get.onerror = () => resolve({ error: 'get failed' })
      }
      request.onerror = () => resolve({ error: 'open failed' })
    })
  }

  /** Returns false when anything short of a server-accepted registration happened. */
  private async register(relays?: string[], opts: PushDevOptions = {}): Promise<boolean> {
    if (!this.config) return false
    const registration = await this.browser.getRegistration()
    if (!registration?.pushManager) {
      console.warn(
        '[push] no active service worker — push can only register in a built PWA (dev server serves a self-destroying SW)',
      )
      return false
    }
    let subscription = await registration.pushManager.getSubscription()
    // A subscription created with a previous VAPID key cannot be reused: pushes
    // signed with the new key are rejected by the push service.
    if (subscription && !matchesVapidKey(subscription, this.config.vapidPublicKey)) {
      console.warn('[push] existing subscription uses a different VAPID key — resubscribing')
      await subscription.unsubscribe()
      subscription = null
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(this.config.vapidPublicKey) as BufferSource,
    })
    const push = await this.sdk.parsePushMaterial(subscription.toJSON())
    if (!push) return false
    // Per-seed HKDF-salted label token (or the label verbatim in plaintext
    // mode), registered as the opaque push message. Stored for the SW only when
    // deobfuscation is wanted — otherwise the SW shows the payload as-is.
    const label = opts.label ?? PUSH_LABEL_ZAPPI_NIP_17
    const obfuscate = opts.obfuscate ?? true
    const message = obfuscate ? await this.labelToken(this.signer.secretKey, label) : label
    this.lastMessage = message
    // 단일 레코드: 같은 메시지 키로 put — mode 2는 사용자 타이틀, mode 1/평문은
    // null (last-writer-wins, 이력 없음). 앱 재실행 sync()도 영속된 intent로
    // 같은 put을 반복하므로 모드/타이틀이 항상 유지된다.
    const resolveTitle =
      obfuscate && (opts.store ?? true) ? (opts.title?.trim() || PUSH_LABEL_TITLE) : null
    await this.storeLabel(message, resolveTitle)
    try {
      const response = await this.sdk.subscribe(this.config.serverUrl, this.signer, push, {
        relays,
        kinds: [PUSH_KIND_NIP_1059],
        message,
      })
      if (!response.ok) console.warn(`[push] register failed: ${response.status}`)
      return response.ok
    } catch (error) {
      console.warn('[push] register error:', error)
      return false
    }
  }
}
