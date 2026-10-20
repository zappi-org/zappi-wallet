/** `?seed=1` must skip the install screen. The second case pins that the bypass does not
 * leak into a plain visit. */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PWAInstallGuard } from '@/ui/components/PWAInstallGuard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function visit(search: string) {
  window.history.replaceState({}, '', `/${search}`)
}

afterEach(() => {
  visit('')
})

describe('PWAInstallGuard', () => {
  it('renders the app when ?seed=1 is present', () => {
    visit('?seed=1')
    render(
      <PWAInstallGuard>
        <div data-testid="app-child" />
      </PWAInstallGuard>,
    )
    expect(screen.getByTestId('app-child')).toBeTruthy()
    expect(screen.queryByTestId('app-install-skip')).toBeNull()
  })

  it('stays on the install screen without the seed param, with a locale-independent skip handle', () => {
    visit('')
    render(
      <PWAInstallGuard>
        <div data-testid="app-child" />
      </PWAInstallGuard>,
    )
    expect(screen.queryByTestId('app-child')).toBeNull()
    expect(screen.getByTestId('app-install-skip')).toBeTruthy()
  })
})
