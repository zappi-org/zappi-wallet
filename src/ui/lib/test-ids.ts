/**
 * UI test-id contract — the stable handles agents (and future e2e) drive the app by.
 *
 * Rules (docs/ui-test-contract.md):
 * - Prefer the accessible name (aria-label / role / text) when an element has one. Ids
 *   exist for what the a11y tree cannot give a stable, locale-independent handle on
 *   (icon-only controls, containers you must assert state on, list rows).
 * - NEVER build an id from a label / translated string — ids must not change with locale.
 * - List rows keep ONE fixed id and carry the varying part in `data-item-id` / `data-index`,
 *   so adding or reordering a row never renumbers existing assertions.
 * - Never put secrets (PIN, mnemonic, signed payload) into ids or data-* attributes.
 *
 * `bun scripts/list-test-ids.mjs` prints this whole inventory — that output is the map an
 * agent reads before touching the screen.
 */

/** Static handles, grouped by screen. The screen prefix is what keeps ids unique app-wide. */
export const TEST_IDS = {
  /** App shell — what "the app is up and usable" looks like. */
  app: {
    ready: 'app-ready',
  },
  signer: {
    screen: 'signer-screen',
    scan: 'signer-scan',
    paste: 'signer-paste',
    sessions: 'signer-sessions',
    sessionRow: 'signer-session-row',
    activityList: 'signer-activity-list',
    activityRow: 'signer-activity-row',
    revokeConfirm: 'signer-revoke-confirm',
    approval: 'signer-approval',
    approvalAllow: 'signer-approval-allow',
    approvalDeny: 'signer-approval-deny',
  },
  myAddress: {
    screen: 'my-address-screen',
    address: 'my-address-address',
    copy: 'my-address-copy',
    register: 'my-address-register',
  },
  settings: {
    /** One id for every category card; the page key lives in `data-item-id`. */
    categoryRow: 'settings-category-row',
    signerEntry: 'settings-signer-entry',
  },
} as const

/**
 * Attributes for one row of a list.
 *
 * `testId` is fixed for every row; `itemId` is the entity key (event id, pubkey, …) so an
 * assertion can target one row without depending on its position.
 */
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

/**
 * Attributes for a region whose state an agent must assert without parsing text.
 * `state` is a small closed set — keep it that way so assertions stay writable.
 */
export function stateAttrs(
  testId: string,
  state: 'empty' | 'loading' | 'ready' | 'error',
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
