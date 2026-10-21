/** Every install-screen escape must work in dev and be dead in a production build: a shipped
 * escape strands users in a Safari tab, whose storage Safari evicts after 7 days of no use. */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PWAInstallGuard } from '@/ui/components/PWAInstallGuard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function visit(search: string) {
  window.history.replaceState({}, '', `/${search}`)
}

const ESCAPES = ['?seed=1', '?mode=standalone', '?bypass=true']

function renderGuard() {
  return render(
    <PWAInstallGuard>
      <div data-testid="app-child" />
    </PWAInstallGuard>,
  )
}

afterEach(() => {
  visit('')
  vi.unstubAllEnvs()
})

describe('PWAInstallGuard', () => {
  it('renders the app when ?seed=1 is present', () => {
    visit('?seed=1')
    renderGuard()
    expect(screen.getByTestId('app-child')).toBeTruthy()
    expect(screen.queryByTestId('app-install-skip')).toBeNull()
  })

  it('offers the skip button behind every escape in dev', () => {
    for (const search of ESCAPES) {
      vi.stubEnv('DEV', true)
      visit(search)
      const { unmount } = renderGuard()
      expect(screen.getByTestId('app-child'), search).toBeTruthy()
      unmount()
    }
  })

  it('ignores every escape in a production build', () => {
    vi.stubEnv('DEV', false)
    for (const search of ESCAPES) {
      visit(search)
      const { unmount } = renderGuard()
      expect(screen.queryByTestId('app-child'), search).toBeNull()
      expect(screen.queryByTestId('app-install-skip'), search).toBeNull()
      unmount()
    }
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
