export type Screen =
  | 'home'
  // Dismantled ecash tab. Kept registered because historySyncPlugin replays
  // serialized history state by activity NAME (bypassing route fallback) — an
  // unregistered 'Token' would crash-loop restored sessions. Renders a redirect
  // to 'history'. Safe to drop only after a release cycle.
  | 'token'
  | 'settings'
  | 'contacts'
  | 'history'
  | 'notifications'
  | 'transfer'
  | 'analytics'
  | 'add-mint'
  | 'mint-management'
  | 'relay-management'
  | 'amount-action'
  | 'send'
  | 'receive'
  | 'my-address'
  | 'username-change'
  | 'transaction-detail'
  | 'mint-detail'
  | 'token-detail'
  | 'token-easter-egg'

export type TabId = 'wallet' | 'contacts' | 'settings'

export const TAB_SCREENS: Record<TabId, Screen> = {
  wallet: 'home',
  contacts: 'contacts',
  settings: 'settings',
}

// 'token' is intentionally absent: the screen survives only as a redirect stub
// for pre-dismantle sessions (see Screen union comment), not as a tab.
export const SCREEN_TO_TAB: Partial<Record<Screen, TabId>> = {
  home: 'wallet',
  contacts: 'contacts',
  settings: 'settings',
}

/**
 * Detail screens whose render is gated on a memory-only payload (selected token /
 * transaction / mint). historySyncPlugin can restore these as the initial activity
 * on deep-link/reload, when the payload is null — the mapped parent is the safe
 * landing so the screen never renders a dead/blank state. Real param-based
 * restoration (rebuilding the payload from the URL) is the future deepening.
 */
export const PAYLOAD_DEPENDENT_PARENT: Partial<Record<Screen, Screen>> = {
  'token-detail': 'history',
  'transaction-detail': 'history',
  'mint-detail': 'home',
}

export type StackActivityName =
  | 'Home'
  | 'Token'
  | 'Settings'
  | 'Contacts'
  | 'History'
  | 'Notifications'
  | 'Transfer'
  | 'Analytics'
  | 'AddMint'
  | 'MintManagement'
  | 'RelayManagement'
  | 'AmountAction'
  | 'Send'
  | 'Receive'
  | 'MyAddress'
  | 'UsernameChange'
  | 'TransactionDetail'
  | 'MintDetail'
  | 'TokenDetail'
  | 'TokenEasterEgg'

export const SCREEN_TO_ACTIVITY: Record<Screen, StackActivityName> = {
  home: 'Home',
  token: 'Token',
  settings: 'Settings',
  contacts: 'Contacts',
  history: 'History',
  notifications: 'Notifications',
  transfer: 'Transfer',
  analytics: 'Analytics',
  'add-mint': 'AddMint',
  'mint-management': 'MintManagement',
  'relay-management': 'RelayManagement',
  'amount-action': 'AmountAction',
  send: 'Send',
  receive: 'Receive',
  'my-address': 'MyAddress',
  'username-change': 'UsernameChange',
  'transaction-detail': 'TransactionDetail',
  'mint-detail': 'MintDetail',
  'token-detail': 'TokenDetail',
  'token-easter-egg': 'TokenEasterEgg',
}
