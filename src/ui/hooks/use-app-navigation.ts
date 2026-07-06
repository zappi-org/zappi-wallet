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
    // 탭 화면 도착 = 서브페이지 플래그 리셋 (handleBack과 대칭 불변식, 4a 잠복 a).
    // 현행 도달 경로에서는 항상 false 라 no-op — 하단 nav 는 플래그 true 면
    // 숨고(유일한 라이브 호출자), SettingsScreen onBack 배선은 미사용(_onBack).
    // 미래의 신규 호출처가 stale true 를 상속하지 않도록 방어적으로 리셋한다.
    setHasSettingsSubPage(false)
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

  // popstate 핸들러 — useEffectEvent 전환 (React 19.2, R2-C 7번):
  // 리스너는 1회 등록하되 호출 시점의 "마지막 커밋" 상태를 본다. 구현전
  // render-중 ref 갱신은 커밋되지 않는 렌더(StrictMode 이중 렌더·중단된
  // concurrent 렌더)의 값까지 노출하던 잠복(react-hooks/refs 지적)이었다.
  // popstate 는 렌더 밖 별도 태스크에서만 발화하므로 두 방식은 정상 경로에서
  // 동일 값을 읽고, 병리 경로에서는 커밋-기준이 더 정확하다 — 계약 판정 안전.
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
