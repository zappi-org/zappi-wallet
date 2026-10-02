/**
 * Foreground push handling.
 *
 * The service worker hands pushes to visible clients instead of showing a
 * notification itself (it can't read wallet settings). This listener applies
 * the setting: hidden when `hideNotificationInForeground` is on (default),
 * neutral wording otherwise. The SW passes the resolved label title (or raw
 * message) along with it, so foreground handling matches the background wake-up.
 * Incoming payments never push while the app is open — the balance UI is the
 * signal there.
 */

import i18n from '@/i18n'
import { useAppStore } from '@/store'
import type { WebPushAdapter } from '@/adapters/runtime/web-push.adapter'

/** Wallet default: hide OS notifications while the app is visible. */
export function shouldNotifyWithWalletSetting(): boolean {
  const hide = useAppStore.getState().settings.hideNotificationInForeground ?? true
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
  return !(hide && visible)
}

export interface ServiceWorkerMessagesOptions {
  /** Return false to skip the OS notification (e.g. foreground + hide setting). */
  shouldNotify?: () => boolean
  /** Neutral wording — a push hint carries no content. */
  hintText?: () => string
}

const defaultHintText = (): string => i18n.t('push.hint')

export function connectServiceWorkerMessages(
  target: EventTarget | null,
  gateway: Pick<WebPushAdapter, 'notifyIncoming'>,
  options: ServiceWorkerMessagesOptions = {},
): () => void {
  if (!target) return () => {}
  const shouldNotify = options.shouldNotify ?? (() => true)
  const hintText = options.hintText ?? defaultHintText
  const listener = (event: Event) => {
    const data = (event as MessageEvent).data as { type?: string; title?: string } | null | undefined
    if (data?.type !== 'zappi-push') return
    if (!shouldNotify()) return
    // The SW resolves the label — or the raw registered message — show that
    // when present, else fall back to the app-side neutral hint.
    void gateway.notifyIncoming(typeof data.title === 'string' ? data.title : hintText()).catch(() => {})
  }
  target.addEventListener('message', listener)
  return () => target.removeEventListener('message', listener)
}
