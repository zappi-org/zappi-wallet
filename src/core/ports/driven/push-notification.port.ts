/**
 * PushNotificationGateway — driven port for background wake-up hints.
 *
 * The server pushes a content-less hint (see docs/push-notification-architecture.md):
 * the app must never depend on it for receiving funds, only to learn faster that
 * something arrived. The adapter owns the transport (Web Push today); the core
 * only sees permission + register/unregister + a summary replacement.
 *
 * `enable()` is a user-gesture path (permission prompt). `sync()` is the silent
 * startup path. `notifyIncoming()` replaces the generic OS notification with the
 * decrypted summary using the same OS tag.
 */

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export interface PushNotificationGateway {
  /** This environment can deliver background notifications at all. */
  readonly supported: boolean

  permission(): PushPermission

  /**
   * User-gesture path: request permission, subscribe, register with the server.
   * Resolves false if permission is denied OR the server did not accept the
   * registration — callers must not treat it as "permission only".
   */
  enable(relays?: string[]): Promise<boolean>

  /** Drop the local subscription and the server record. */
  disable(): Promise<void>

  /** Silent re-register when already enabled + granted (called on app activate). */
  sync(relays?: string[]): Promise<void>

  /** Replace the wake-up hint with the decrypted summary (same OS tag). */
  notifyIncoming(summary: string): Promise<void>
}
