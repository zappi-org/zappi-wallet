export type Screen =
  | 'home'
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
  | 'username-change'
  | 'transaction-detail'
  | 'mint-detail'
  | 'token-create'
  | 'token-detail'
  | 'token-easter-egg'

export type TabId = 'wallet' | 'token' | 'contacts' | 'settings'

export const TAB_SCREENS: Record<TabId, Screen> = {
  wallet: 'home',
  token: 'token',
  contacts: 'contacts',
  settings: 'settings',
}

export const SCREEN_TO_TAB: Partial<Record<Screen, TabId>> = {
  home: 'wallet',
  token: 'token',
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
  'token-detail': 'token',
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
  | 'UsernameChange'
  | 'TransactionDetail'
  | 'MintDetail'
  | 'TokenCreate'
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
  'username-change': 'UsernameChange',
  'transaction-detail': 'TransactionDetail',
  'mint-detail': 'MintDetail',
  'token-create': 'TokenCreate',
  'token-detail': 'TokenDetail',
  'token-easter-egg': 'TokenEasterEgg',
}
