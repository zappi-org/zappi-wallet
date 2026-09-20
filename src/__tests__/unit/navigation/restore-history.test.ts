import { afterEach, describe, expect, it } from 'vitest'
import { makeCoreStore, makeEvent } from '@stackflow/core'
import { historySyncPlugin } from '@stackflow/plugin-history-sync'
import { stringify } from 'flatted'
import { sanitizeInitialHistory } from '@/ui/navigation/restore-history'

const registered = new Set(['Home', 'Messages', 'Chat'])
const tag = '@stackflow/plugin-history-sync'
function saved(name: string, eventName = name) {
  return {
    _TAG: tag,
    flattedState: stringify({
      activity: {
        id: 'old-activity',
        name,
        enteredBy: makeEvent('Pushed', {
          activityId: 'old-activity',
          activityName: eventName,
          activityParams: {},
        }),
      },
    }),
  }
}
function boot() {
  return makeCoreStore({
    initialEvents: [
      makeEvent('Initialized', { transitionDuration: 0 }),
      ...[...registered].map((activityName) =>
        makeEvent('ActivityRegistered', { activityName })
      ),
      makeEvent('Pushed', {
        activityId: 'home',
        activityName: 'Home',
        activityParams: {},
      }),
    ],
    plugins: [
      historySyncPlugin({
        routes: { Home: '/', Messages: '/messages', Chat: '/chat' },
        fallbackActivity: () => 'Home',
        useHash: true,
      }),
    ],
  })
}
afterEach(() => window.history.replaceState(null, '', '#/'))

describe('saved Stackflow activity restoration', () => {
  it('reproduces the real plugin crash and repairs a removed activity without clearing other data', () => {
    window.history.replaceState(
      { idx: 3, key: 'keep', usr: saved('RemovedScreen'), other: 42 },
      '',
      '#/removed'
    )
    expect(boot).toThrow('the corresponding activity does not exist')
    expect(sanitizeInitialHistory(registered)).toBe(true)
    expect(window.history.state).toEqual({
      idx: 3,
      key: 'keep',
      usr: null,
      other: 42,
    })
    expect(boot().actions.getStack().activities.at(-1)?.name).toBe('Home')
  })
  it('preserves registered chat restoration', () => {
    const state = { idx: 1, key: 'keep', usr: saved('Chat') }
    window.history.replaceState(state, '', '#/chat')
    expect(sanitizeInitialHistory(registered)).toBe(false)
    expect(window.history.state).toEqual(state)
    expect(boot().actions.getStack().activities.at(-1)?.name).toBe('Chat')
  })
  it('validates the actual restored event, not just the display name', () => {
    window.history.replaceState(
      { usr: saved('Home', 'RemovedScreen') },
      '',
      '#/'
    )
    expect(boot).toThrow('the corresponding activity does not exist')
    expect(sanitizeInitialHistory(registered)).toBe(true)
    expect(() => boot()).not.toThrow()
  })
  it.each([
    'invalid JSON',
    stringify({}),
    stringify({ activity: { name: 'Home' } }),
  ])('removes malformed serialized state: %s', (flattedState) => {
    window.history.replaceState(
      { usr: { _TAG: tag, flattedState }, idx: 2 },
      '',
      '#/'
    )
    expect(sanitizeInitialHistory(registered)).toBe(true)
    expect(() => boot()).not.toThrow()
  })
  it('leaves the root back sentinel and unrelated history untouched', () => {
    const state = { __zappiRootGuard: true, usr: { unrelated: true } }
    window.history.replaceState(state, '', '#/')
    expect(sanitizeInitialHistory(registered)).toBe(false)
    expect(window.history.state).toEqual(state)
  })
  it('preserves valid replace events and handles legacy top-level state', () => {
    const serialized = saved('Home')
    window.history.replaceState({ ...serialized, keep: true }, '', '#/')
    expect(sanitizeInitialHistory(registered)).toBe(false)
    window.history.replaceState({ ...saved('OldTab'), keep: true }, '', '#/')
    expect(sanitizeInitialHistory(registered)).toBe(true)
    expect(window.history.state).toEqual({ keep: true })
  })
})
