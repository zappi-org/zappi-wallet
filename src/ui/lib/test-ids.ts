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
    /** Row inside a category detail page; the page key (`my-address`, …) is data-item-id. */
    pageRow: 'settings-page-row',
  },
  myAddress: {
    /** The live alias text (`<name>@<domain>`) — read it, never click it. */
    value: 'my-address-value',
    /** Pencil → opens the username-change sheet. */
    edit: 'my-address-edit',
    /** Deposit-mint "change" affordance → opens the mint picker. */
    mintEdit: 'my-address-mint-edit',
  },
  /**
   * Username purchase sheet. `notice` carries the state an assertion cares about:
   * `blocked` (no payable mint — only while the user can still act) vs `info`.
   */
  changeUsername: {
    input: 'change-username-input',
    /** "변경" — price check, then the confirm card. */
    submit: 'change-username-submit',
    /** "결제" — spends the fee. */
    pay: 'change-username-pay',
    notice: 'change-username-notice',
    success: 'change-username-success',
  },
  mintSelect: {
    /** One per carousel card; the mint url is data-item-id. */
    card: 'mint-select-card',
    confirm: 'mint-select-confirm',
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
  /** Region states are conventional; a sheet may name its own (e.g. 'blocked'). */
  state: UiRegionState | string,
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
