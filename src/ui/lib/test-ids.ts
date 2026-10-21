/**
 * UI test-id contract — the stable handles agents drive the app by.
 *
 * Rules: prefer the accessible name; never derive an id from a label (locale-dependent);
 * rows keep ONE fixed id with the varying part in `data-item-id`; never put secrets in
 * `data-*`. `npm run testids` prints the inventory.
 */

/** The closed set of region states an assertion may read. */
export type UiRegionState = 'empty' | 'loading' | 'ready' | 'error'

/**
 * Wired handles — clickable today. The screen prefix keeps ids unique app-wide.
 *
 * `categoryRow`: the settings list has five cards, page key in `data-item-id`. A sixth
 * (`category-login-auth`) arrives with the NIP-46 PR.
 */
export const TEST_IDS = {
  app: {
    ready: 'app-ready',
    /** Bottom dock tab button; the tab key (`wallet` | `contacts` | `settings`) is data-item-id. */
    navTab: 'app-nav-tab',
    /** "Skip install (dev only)" on the PWA install screen — i18n text must not be the handle. */
    installSkip: 'app-install-skip',
  },
  settings: {
    categoryRow: 'settings-category-row',
  },
} as const

/** Row attrs: fixed testid, entity key in `data-item-id`, optional position. */
export function rowAttrs(
  testId: string,
  itemId: string,
  index?: number,
): {
  'data-testid': string
  'data-item-id': string
  'data-index'?: number
} {
  return index === undefined
    ? { 'data-testid': testId, 'data-item-id': itemId }
    : { 'data-testid': testId, 'data-item-id': itemId, 'data-index': index }
}

/** Region attrs: state + count, for assertions that must not parse text. */
export function stateAttrs(
  testId: string,
  state: UiRegionState,
  count?: number,
): {
  'data-testid': string
  'data-state': string
  'data-count'?: number
} {
  return count === undefined
    ? { 'data-testid': testId, 'data-state': state }
    : { 'data-testid': testId, 'data-state': state, 'data-count': count }
}
