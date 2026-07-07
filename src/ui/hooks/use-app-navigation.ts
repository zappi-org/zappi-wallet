import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export type Screen = 'home' | 'token' | 'settings' | 'contacts' | 'history' | 'notifications' | 'transfer' | 'analytics' | 'add-mint' | 'mint-management' | 'relay-management' | 'amount-action' | 'send' | 'receive' | 'username-change' | 'transaction-detail' | 'mint-detail' | 'token-create' | 'token-register' | 'token-detail' | 'token-easter-egg'

export type TabId = 'wallet' | 'token' | 'contacts' | 'settings'
const TAB_SCREENS: Record<TabId, Screen> = { wallet: 'home', token: 'token', contacts: 'contacts', settings: 'settings' }
const SCREEN_TO_TAB: Partial<Record<Screen, TabId>> = { home: 'wallet', token: 'token', contacts: 'contacts', settings: 'settings' }

export interface AppNavigation {
  currentScreen: Screen
  previousScreen: Screen | null
  setCurrentScreen: Dispatch<SetStateAction<Screen>>
  setPreviousScreen: Dispatch<SetStateAction<Screen | null>>
  /** Derived: tab owning the current screen (non-tab screens fall back to 'wallet') */
  activeTab: TabId
  /** Whether current screen is a tab screen (show bottom nav) */
  isTabScreen: boolean
  /** Setter for the SettingsScreen sub-page open flag (injected via onSubPageChange); state owned by this hook. */
  setHasSettingsSubPage: Dispatch<SetStateAction<boolean>>
  handleTabSelect: (tabId: string) => void
  handleBack: () => void
}

/**
 * Screen navigation state and logic.
 *
 * Owns: currentScreen/previousScreen, hasSettingsSubPage (and derived isTabScreen/activeTab),
 * tab-switch/back handlers, and Android back-button integration (History API pushState/popstate).
 *
 * The popstate listener runs on the bubble phase — SettingsScreen's capture-phase listener
 * consumes it first via stopImmediatePropagation when a sub-page is open.
 */
export function useAppNavigation(): AppNavigation {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home')
  const [previousScreen, setPreviousScreen] = useState<Screen | null>(null)
  const activeTab: TabId = SCREEN_TO_TAB[currentScreen] ?? 'wallet'

  const [hasSettingsSubPage, setHasSettingsSubPage] = useState(false)
  const isTabScreen = !!SCREEN_TO_TAB[currentScreen] && !hasSettingsSubPage

  const handleTabSelect = useCallback((tabId: string) => {
    setCurrentScreen(TAB_SCREENS[tabId as TabId])
    setPreviousScreen(null)
    // Arriving at a tab screen resets the sub-page flag (symmetric with handleBack).
    // Currently always already false here (no-op), but reset defensively so a future
    // caller can't inherit a stale true — the bottom nav hides while the flag is true.
    setHasSettingsSubPage(false)
  }, [])

  const handleBack = useCallback(() => {
    const target = previousScreen || 'home'
    setPreviousScreen(null)
    setCurrentScreen(target)
    // Returning to a tab screen resets the sub-page flag (handles edge-swipe back).
    if (SCREEN_TO_TAB[target]) {
      setHasSettingsSubPage(false)
    }
  }, [previousScreen])

  // Android back button support via History API
  useEffect(() => {
    if (!window.history.state?.screen) {
      window.history.replaceState({ screen: 'home' }, '')
    }
  }, [])

  useEffect(() => {
    if (currentScreen === 'home') {
      window.history.replaceState({ screen: 'home' }, '')
    } else if (window.history.state?.screen !== currentScreen) {
      window.history.pushState({ screen: currentScreen }, '')
    }
  }, [currentScreen])

  // popstate handler via useEffectEvent: registered once, but reads the last-committed
  // state at call time. A render-time ref update would expose values from renders that
  // never commit (StrictMode double-render, aborted concurrent renders). popstate only
  // fires in a task outside render, so both read the same value on the normal path and
  // the commit-based one is more accurate on pathological ones.
  const onPopState = useEffectEvent(() => {
    if (currentScreen === 'home') {
      window.history.pushState({ screen: 'home' }, '')
    } else {
      handleBack()
    }
  })

  useEffect(() => {
    const handlePopState = () => onPopState()
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return {
    currentScreen,
    previousScreen,
    setCurrentScreen,
    setPreviousScreen,
    activeTab,
    isTabScreen,
    setHasSettingsSubPage,
    handleTabSelect,
    handleBack,
  }
}
