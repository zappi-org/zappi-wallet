import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** SettingsScreen 서브페이지 열림 플래그 setter (onSubPageChange로 주입) — 상태 소유는 훅 */
  setHasSettingsSubPage: Dispatch<SetStateAction<boolean>>
  handleTabSelect: (tabId: string) => void
  handleBack: () => void
}

/**
 * 화면 내비게이션 상태/로직 (MainApp Phase 4a 순수 이동).
 *
 * 소유: currentScreen/previousScreen, hasSettingsSubPage(파생 isTabScreen·activeTab 포함),
 * 탭 전환/뒤로가기 핸들러, Android 뒤로가기(History API pushState/popstate) 연동.
 *
 * popstate 리스너는 bubble 단계 — SettingsScreen의 capture 단계 리스너가
 * 서브페이지 열림 시 stopImmediatePropagation으로 먼저 소비한다 (기존 계약 유지).
 */
export function useAppNavigation(): AppNavigation {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home')
  const [previousScreen, setPreviousScreen] = useState<Screen | null>(null)
  // Derive active tab from current screen
  const activeTab: TabId = SCREEN_TO_TAB[currentScreen] ?? 'wallet'

  // Whether current screen is a tab screen (show bottom nav)
  const [hasSettingsSubPage, setHasSettingsSubPage] = useState(false)
  const isTabScreen = !!SCREEN_TO_TAB[currentScreen] && !hasSettingsSubPage

  // Handle tab selection
  const handleTabSelect = useCallback((tabId: string) => {
    setCurrentScreen(TAB_SCREENS[tabId as TabId])
    setPreviousScreen(null)
  }, [])

  const handleBack = useCallback(() => {
    const target = previousScreen || 'home'
    setPreviousScreen(null)
    setCurrentScreen(target)
    // 탭 화면으로 돌아가면 서브페이지 플래그 리셋 (엣지 스와이프 뒤로가기 대응)
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

  // popstate 리스너를 1회만 등록하기 위한 최신값 ref 동기화 — MainApp 원본 그대로
  // (순수 이동). react-hooks/refs 지적은 MainApp에서는 컴파일러 분석 bail-out으로
  // 미검출되던 잠복 패턴 — useEffectEvent 전환은 후속 과제로 기록.
  const currentScreenRef = useRef(currentScreen)
  // eslint-disable-next-line react-hooks/refs
  currentScreenRef.current = currentScreen
  const handleBackRef = useRef(handleBack)
  // eslint-disable-next-line react-hooks/refs
  handleBackRef.current = handleBack

  useEffect(() => {
    const handlePopState = () => {
      if (currentScreenRef.current === 'home') {
        window.history.pushState({ screen: 'home' }, '')
      } else {
        handleBackRef.current()
      }
    }
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
