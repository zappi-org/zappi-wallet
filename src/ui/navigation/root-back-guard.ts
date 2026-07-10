import { getNavigationSnapshot } from './navigation-store'

/**
 * Keeps a hardware/browser BACK at the Home root from exiting the PWA.
 *
 * historySyncPlugin owns popstate; at the root activity its onBeforePop computes
 * popCount 0, so a browser back at Home simply propagates out of the app. While the
 * app rests on Home we seed a path-less sentinel history entry above the root: a back
 * at Home lands on Home's real entry and the guard immediately re-arms, so the user
 * never leaves.
 *
 * Pushes do NOT remove the sentinel — history.back() is asynchronous, so any
 * drop-before-push scheme races the plugin's own pushState and cancels the navigation.
 * Instead pushed screens stack above the buried sentinel, and a back that lands on the
 * buried sentinel mid-stack is passed through with one more history.back().
 *
 * Safe against the plugin because the sentinel carries no serialized state (the
 * history package delivers state.usr === undefined, so the plugin's popstate handler
 * early-returns without touching the stackflow stack), and re-arming is deferred to a
 * microtask so it never races the plugin's in-flight history tick.
 */

const SENTINEL_MARKER = '__zappiRootGuard'
// Matches historySyncPlugin's serialized-state tag (its dist STATE_TAG).
const STACKFLOW_STATE_TAG = '@stackflow/plugin-history-sync'

interface SentinelState {
  [SENTINEL_MARKER]: true
}

function isSentinel(state: unknown): state is SentinelState {
  return typeof state === 'object' && state !== null && SENTINEL_MARKER in state
}

/** True when the current entry carries a stackflow serialized state (its own back-stop).
 *  The plugin writes through the `history` package (v5), which nests user state
 *  under `usr` — so the tag lives at state.usr._TAG, not state._TAG. */
function hasStackflowState(): boolean {
  const raw = window.history.state as { _TAG?: unknown; usr?: { _TAG?: unknown } } | null
  if (typeof raw !== 'object' || raw === null) return false
  return raw._TAG === STACKFLOW_STATE_TAG || raw.usr?._TAG === STACKFLOW_STATE_TAG
}

function atHomeRoot(): boolean {
  const { currentScreen, stack } = getNavigationSnapshot()
  return currentScreen === 'home' && stack.length === 1
}

let installed = false
let disposed = false
let armed = false

/** Seed the sentinel above Home's real entry (idempotent, Home-root only). */
export function armRootSentinel(): void {
  if (!installed || disposed || armed || typeof window === 'undefined' || !atHomeRoot()) return
  if (isSentinel(window.history.state)) {
    armed = true
    return
  }
  // Only seed when the current entry is the plugin's own root state — never stack a
  // sentinel above a pushed screen.
  if (!hasStackflowState()) return
  // During boot reconcile the store already says Home while the plugin's replace
  // (URL → #/) is still in flight; arming then would seed above the stale entry.
  const { hash } = window.location
  if (hash !== '' && hash !== '#' && hash !== '#/') return
  armed = true
  window.history.pushState({ [SENTINEL_MARKER]: true }, '')
}

export function installRootBackGuard(): () => void {
  if (installed || typeof window === 'undefined') return () => {}
  installed = true
  disposed = false

  const handlePopState = () => {
    // Defer past the plugin's synchronous popstate handling + tick queue.
    queueMicrotask(() => {
      if (disposed) return
      if (isSentinel(window.history.state) && !atHomeRoot()) {
        // Back from a pushed screen landed on the buried sentinel — pass through
        // so the user reaches the real previous entry with one gesture.
        window.history.back()
        return
      }
      armed = false
      armRootSentinel()
    })
  }

  window.addEventListener('popstate', handlePopState)
  // Seed once the plugin has established the initial root entry.
  queueMicrotask(armRootSentinel)

  return () => {
    disposed = true
    window.removeEventListener('popstate', handlePopState)
    installed = false
    armed = false
  }
}
