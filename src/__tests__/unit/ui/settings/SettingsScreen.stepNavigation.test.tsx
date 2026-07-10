import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

/**
 * Verifies the SettingsScreen sub-page step machine. The whole machine lives in
 * SettingsScreen.tsx; leaf pages are stubbed so the test exercises the
 * push/pop/reconcile logic — not their dependency trees. `useActivityStepNavigation`
 * is a controllable fake: pushStep/popStep mutate real depth (as Stackflow would),
 * and `browserBack()` simulates an external history pop.
 */

// --- Controllable step-navigation fake -------------------------------------
let stepDepth = 0
const pushStep = vi.fn(() => setDepth(stepDepth + 1))
const popStep = vi.fn(() => setDepth(Math.max(0, stepDepth - 1)))
const listeners = new Set<() => void>()
function setDepth(next: number) {
  stepDepth = next
  listeners.forEach((l) => l())
}
/** Simulate a browser/iOS back button press (external history pop). */
function browserBack() {
  // act() so the useSyncExternalStore re-render and the reconcile effect flush,
  // matching how Stackflow would push the depth change into React.
  act(() => setDepth(Math.max(0, stepDepth - 1)))
}
function useFakeStepNavigation() {
  const depth = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => stepDepth,
  )
  return { stepDepth: depth, pushStep, popStep }
}

vi.mock('@/ui/navigation/activity-step-navigation', () => ({
  useActivityStepNavigation: () => useFakeStepNavigation(),
}))

// --- Leaf stubs: expose onBack/onNavigate as buttons -----------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/ui/components/common/PageTransition', () => ({
  PageTransition: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/ui/screens/Settings/SettingsMainList', () => ({
  SettingsMainList: ({ onNavigate }: { onNavigate: (p: string) => void }) => (
    <div>
      <button onClick={() => onNavigate('category-profile')}>open-category</button>
      <button onClick={() => onNavigate('support')}>open-detail-direct</button>
    </div>
  ),
}))

vi.mock('@/ui/screens/Settings/pages/ProfileCategoryPage', () => ({
  ProfileCategoryPage: ({ onBack, onNavigate }: { onBack: () => void; onNavigate: (p: string) => void }) => (
    <div>
      <span>category-page</span>
      <button onClick={onBack}>category-back</button>
      <button onClick={() => onNavigate('npubDetail')}>open-detail</button>
    </div>
  ),
}))

vi.mock('@/ui/screens/Settings/pages/NpubDetailPage', () => ({
  NpubDetailPage: ({ onBack }: { onBack: () => void }) => (
    <div>
      <span>detail-page</span>
      <button onClick={onBack}>detail-back</button>
    </div>
  ),
}))

vi.mock('@/ui/screens/Settings/pages/SupportPage', () => ({
  SupportPage: ({ onBack }: { onBack: () => void }) => (
    <div>
      <span>support-page</span>
      <button onClick={onBack}>support-back</button>
    </div>
  ),
}))

// Remaining leaf pages are never mounted in these flows but must resolve.
vi.mock('@/ui/screens/Settings/pages/PreferencesCategoryPage', () => ({ PreferencesCategoryPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/SecurityCategoryPage', () => ({ SecurityCategoryPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/WalletCategoryPage', () => ({ WalletCategoryPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/LanguageSettingPage', () => ({ LanguageSettingPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/UnitDisplaySettingPage', () => ({ UnitDisplaySettingPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/FiatSettingPage', () => ({ FiatSettingPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/AutoLockSettingPage', () => ({ AutoLockSettingPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/POSSettingPage', () => ({ POSSettingPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/PrivacySettingPage', () => ({ PrivacySettingPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/LightningDetailPage', () => ({ LightningDetailPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/DiagnosticsPage', () => ({ DiagnosticsPage: () => null }))
vi.mock('@/ui/screens/Settings/pages/PinChangePage', () => ({ PinChangePage: () => null }))

vi.mock('@/ui/screens/Settings/usePinChange', () => ({
  usePinChange: () => ({ isOpen: false, open: vi.fn(), close: vi.fn() }),
}))

vi.mock('@/ui/components/common', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (isOpen ? <div>{children}</div> : null),
  PinInput: () => null,
}))

vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => ({ username: { getAddress: vi.fn() } }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      settings: { mints: [], relays: [] },
      updateSettings: vi.fn(),
      addToast: vi.fn(),
      nostrPubkey: null,
      nostrPrivkey: null,
      p2pkPubkey: null,
      setBalance: vi.fn(),
      supportUnreadCount: 0,
      updateAvailable: false,
    }),
}))

vi.mock('@/ui/config/feature-flags', () => ({ ENABLE_LIGHTNING_ADDRESS_SETTINGS: false }))

import { SettingsScreen } from '@/ui/screens/Settings/SettingsScreen'

const baseProps = {
  onBack: vi.fn(),
  onChangePassword: vi.fn(async () => true),
  onBackupMnemonic: vi.fn(async () => null),
  onLogout: vi.fn(async () => true),
  onVerifyPin: vi.fn(async () => true),
  onSaveSettings: vi.fn(async () => {}),
}

function renderScreen() {
  return render(<SettingsScreen {...baseProps} />)
}

beforeEach(() => {
  stepDepth = 0
  listeners.clear()
  pushStep.mockClear()
  popStep.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SettingsScreen step navigation', () => {
  it('invariant 5: opening category then detail pushes exactly two steps', () => {
    renderScreen()

    fireEvent.click(screen.getByText('open-category'))
    expect(screen.getByText('category-page')).toBeInTheDocument()

    fireEvent.click(screen.getByText('open-detail'))
    expect(screen.getByText('detail-page')).toBeInTheDocument()

    expect(pushStep).toHaveBeenCalledTimes(2)
    expect(stepDepth).toBe(2)
  })

  it('invariant 1: in-app back from detail keeps the category page open, pops one step', () => {
    renderScreen()
    fireEvent.click(screen.getByText('open-category'))
    fireEvent.click(screen.getByText('open-detail'))
    expect(stepDepth).toBe(2)

    fireEvent.click(screen.getByText('detail-back'))

    // The category layer MUST remain — this is the regression the fix targets.
    expect(screen.getByText('category-page')).toBeInTheDocument()
    expect(screen.queryByText('detail-page')).not.toBeInTheDocument()
    expect(popStep).toHaveBeenCalledTimes(1)
    expect(stepDepth).toBe(1)
  })

  it('invariant 2: browser back at detail keeps the category page open', () => {
    renderScreen()
    fireEvent.click(screen.getByText('open-category'))
    fireEvent.click(screen.getByText('open-detail'))
    expect(stepDepth).toBe(2)

    browserBack()

    expect(screen.getByText('category-page')).toBeInTheDocument()
    expect(screen.queryByText('detail-page')).not.toBeInTheDocument()
    // No extra popStep — the browser already popped the history entry.
    expect(popStep).not.toHaveBeenCalled()
    expect(stepDepth).toBe(1)
  })

  it('invariant 3: browser back at category returns to settings root', () => {
    renderScreen()
    fireEvent.click(screen.getByText('open-category'))
    expect(stepDepth).toBe(1)

    browserBack()

    expect(screen.queryByText('category-page')).not.toBeInTheDocument()
    expect(screen.getByText('open-category')).toBeInTheDocument()
    expect(popStep).not.toHaveBeenCalled()
    expect(stepDepth).toBe(0)
  })

  it('invariant 4: in-app back at category returns to settings root, pops one step', () => {
    renderScreen()
    fireEvent.click(screen.getByText('open-category'))
    expect(stepDepth).toBe(1)

    fireEvent.click(screen.getByText('category-back'))

    expect(screen.queryByText('category-page')).not.toBeInTheDocument()
    expect(screen.getByText('open-category')).toBeInTheDocument()
    expect(popStep).toHaveBeenCalledTimes(1)
    expect(stepDepth).toBe(0)
  })

  it('invariant 6: rapid double in-app back does not over-close or deadlock', () => {
    renderScreen()
    fireEvent.click(screen.getByText('open-category'))
    fireEvent.click(screen.getByText('open-detail'))
    expect(stepDepth).toBe(2)

    fireEvent.click(screen.getByText('detail-back'))
    fireEvent.click(screen.getByText('category-back'))

    // Both layers closed cleanly, depth balanced at root.
    expect(screen.queryByText('detail-page')).not.toBeInTheDocument()
    expect(screen.queryByText('category-page')).not.toBeInTheDocument()
    expect(screen.getByText('open-category')).toBeInTheDocument()
    expect(popStep).toHaveBeenCalledTimes(2)
    expect(stepDepth).toBe(0)
  })

  it('supports a detail page opened directly from the root (no category)', () => {
    renderScreen()

    fireEvent.click(screen.getByText('open-detail-direct'))
    expect(screen.getByText('support-page')).toBeInTheDocument()
    expect(pushStep).toHaveBeenCalledTimes(1)
    expect(stepDepth).toBe(1)

    fireEvent.click(screen.getByText('support-back'))
    expect(screen.queryByText('support-page')).not.toBeInTheDocument()
    expect(popStep).toHaveBeenCalledTimes(1)
    expect(stepDepth).toBe(0)
  })
})
