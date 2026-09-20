import { useEffect } from 'react'
import { render, act, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStack } from '@stackflow/react'
import { AppStack } from '@/ui/navigation/stackflow'
import {
  navigateToScreen,
  getNavigationSnapshot,
  replaceToScreen,
} from '@/ui/navigation/navigation-store'

vi.mock('@stackflow/plugin-devtools', () => ({
  devtoolsPlugin: () => () => ({ key: 'test-devtools' }),
}))
let active = ''
function Screen() {
  const stack = useStack()
  useEffect(() => {
    active = stack.activities.find((a) => a.isActive)?.name ?? ''
  }, [stack])
  return <div>screen</div>
}

describe('real tab transitions with browser history', () => {
  it('returns from Messages to Home after repeated tab replacements and fast taps', async () => {
    render(<AppStack renderScreen={() => <Screen />} />)
    await waitFor(() => expect(active).toBe('Home'))
    fireEvent.pointerDown(document.body)
    for (let i = 0; i < 8; i++) {
      act(() => {
        navigateToScreen('messages', { reset: true, animate: false })
      })
      await waitFor(() => expect(active).toBe('Messages'))
      act(() => {
        navigateToScreen('contacts', { reset: true, animate: false })
        navigateToScreen('messages', { reset: true, animate: false })
        navigateToScreen('home', { reset: true, animate: false })
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      await waitFor(() => {
        expect(active).toBe('Home')
        expect(getNavigationSnapshot().currentScreen).toBe('home')
      })
    }
    act(() => replaceToScreen('chat'))
    await waitFor(() => expect(active).toBe('Chat'))
    act(() => replaceToScreen('messages'))
    await waitFor(() => expect(active).toBe('Messages'))
    act(() => navigateToScreen('home', { reset: true, animate: false }))
    await waitFor(() => expect(active).toBe('Home'))
  })
})
