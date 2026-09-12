/**
 * WebPushAdapter — PushNotificationGateway on top of the `kkachi` SDK (NIP-98)
 * and the browser Push API. Registers under the wallet's real npub (senders
 * still target it until the ReceiveRequest inbox path ships; the server then
 * stores the identity pubkey — docs L12/L13). The secret never leaves the
 * device and the SDK is loaded lazily.
 */

import { getPublicKey } from 'nostr-tools'
import type { InboxSigner } from 'kkachi/register'
import type { PushMaterial } from 'kkachi/protocol'
import type {
  PushNotificationGateway,
  PushPermission,
} from '@/core/ports/driven/push-notification.port'

export const INCOMING_TAG = 'zappi-incoming'

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

/** The subset of the kkachi SDK the adapter needs. */
export interface PushSdk {
  subscribe(
    baseUrl: string,
    signer: InboxSigner,
    push: PushMaterial,
    relays?: string[],
  ): Promise<Response>
  unsubscribe(baseUrl: string, signer: InboxSigner): Promise<Response>
  /** Returns the validated material, or null when the payload is malformed. */
  parsePushMaterial(value: unknown): Promise<PushMaterial | null>
}

export interface WebPushAdapterDeps {
  /** null = push not configured (feature-gated off). */
  config: KkachiConfig | null
  /** Wallet nostr secret key — the NIP-98 signer is its real npub. */
  identitySecretKey: Uint8Array
  browser?: PushBrowser
  sdk?: PushSdk
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
    async subscribe(baseUrl, signer, push, relays) {
      const { subscribe } = await import('kkachi/register')
      return subscribe(baseUrl, signer, push, relays)
    },
    async unsubscribe(baseUrl, signer) {
      const { unsubscribe } = await import('kkachi/register')
      return unsubscribe(baseUrl, signer)
    },
    async parsePushMaterial(value) {
      const { isPushMaterial } = await import('kkachi/protocol')
      return isPushMaterial(value) ? value : null
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

export class WebPushAdapter implements PushNotificationGateway {
  private readonly config: KkachiConfig | null
  private readonly signer: InboxSigner
  private readonly browser: PushBrowser
  private readonly sdk: PushSdk

  constructor(deps: WebPushAdapterDeps) {
    this.config = deps.config
    this.signer = createIdentitySigner(deps.identitySecretKey)
    this.browser = deps.browser ?? createBrowserPush()
    this.sdk = deps.sdk ?? createSdk()
  }

  get supported(): boolean {
    return this.config !== null && this.browser.isSupported()
  }

  permission(): PushPermission {
    return this.supported ? this.browser.permission() : 'unsupported'
  }

  async enable(relays?: string[]): Promise<boolean> {
    if (!this.supported) return false
    if ((await this.browser.requestPermission()) !== 'granted') return false
    return this.register(relays)
  }

  async sync(relays?: string[]): Promise<void> {
    if (!this.supported || this.browser.permission() !== 'granted') return
    await this.register(relays)
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

  /** Returns false when anything short of a server-accepted registration happened. */
  private async register(relays?: string[]): Promise<boolean> {
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
    try {
      const response = await this.sdk.subscribe(this.config.serverUrl, this.signer, push, relays)
      if (!response.ok) console.warn(`[push] register failed: ${response.status}`)
      return response.ok
    } catch (error) {
      console.warn('[push] register error:', error)
      return false
    }
  }
}
