import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  getNavigationSnapshot,
  navigateBack,
  navigateToScreen,
  replaceToScreen,
  setPreviousScreenOverride,
  subscribeNavigation,
} from '@/ui/navigation/navigation-store'
import { SCREEN_TO_TAB, TAB_SCREENS, type Screen, type TabId } from '@/ui/navigation/types'

export type { Screen, TabId } from '@/ui/navigation/types'

export interface AppNavigation {
  currentScreen: Screen
  previousScreen: Screen | null
  setCurrentScreen: (screen: Screen) => void
  /** Navigate without growing history (redirect stubs) — pop to it or replace the top. */
  replaceScreen: (screen: Screen) => void
  setPreviousScreen: (screen: Screen | null) => void
  /** Derived: tab owning the current screen (non-tab screens fall back to 'wallet') */
  activeTab: TabId
  /** Whether current screen is a tab screen (show bottom nav) */
  isTabScreen: boolean
  /** Setter for the SettingsScreen sub-page open flag (state remains local to the shell). */
  setHasSettingsSubPage: Dispatch<SetStateAction<boolean>>
  handleTabSelect: (tabId: string) => void
  handleBack: () => void
}

/**
 * Compatibility facade over Stackflow navigation.
 *
 * MainApp can migrate its existing screen callbacks incrementally while Stackflow
 * owns the real activity stack, browser history, and forward/back restoration.
 */
export function useAppNavigation(): AppNavigation {
  const navigation = useSyncExternalStore(subscribeNavigation, getNavigationSnapshot, getNavigationSnapshot)
  const { currentScreen, previousScreen } = navigation
  const activeTab: TabId = SCREEN_TO_TAB[currentScreen] ?? 'wallet'

  const [hasSettingsSubPage, setHasSettingsSubPage] = useState(false)
  const isTabScreen = SCREEN_TO_TAB[currentScreen] !== undefined && !hasSettingsSubPage

  const setCurrentScreen = useCallback((screen: Screen) => {
    navigateToScreen(screen)
  }, [])

  const setPreviousScreen = useCallback((screen: Screen | null) => {
    setPreviousScreenOverride(screen)
  }, [])

  const handleTabSelect = useCallback((tabId: string) => {
    const target = TAB_SCREENS[tabId as TabId]
    if (!target) return
    // Re-tapping the active tab must be a complete no-op — a reset here would
    // remount the screen and wipe its scroll/state.
    if (target === getNavigationSnapshot().currentScreen) return
    setPreviousScreenOverride(null)
    navigateToScreen(target, { reset: true, animate: false })
    setHasSettingsSubPage(false)
  }, [])

  const handleBack = useCallback(() => {
    const target = navigateBack()
    if (SCREEN_TO_TAB[target]) {
      setHasSettingsSubPage(false)
    }
  }, [])

  const replaceScreen = useCallback((screen: Screen) => {
    replaceToScreen(screen)
  }, [])

  return {
    currentScreen,
    previousScreen,
    setCurrentScreen,
    replaceScreen,
    setPreviousScreen,
    activeTab,
    isTabScreen,
    setHasSettingsSubPage,
    handleTabSelect,
    handleBack,
  }
}
