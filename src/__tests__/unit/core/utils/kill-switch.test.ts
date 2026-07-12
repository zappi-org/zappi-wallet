import { describe, it, expect, afterEach } from 'vitest'
import { isKillSwitchOn, readKillSwitches, KILL_SWITCH_NAMES } from '@/core/utils/kill-switch'

describe('kill-switch', () => {
  afterEach(() => {
    for (const name of KILL_SWITCH_NAMES) {
      localStorage.removeItem(`zappi.ks.${name}`)
    }
  })

  it.each([
    ['is off by default', 'cursor', undefined, false],
    ["is on when the stored value is exactly '1'", 'tls-sweep', '1', true],
    ['is off for other stored values', 'cursor', 'true', false],
  ] as const)('%s', (_description, name, storedValue, expected) => {
    if (storedValue !== undefined) {
      localStorage.setItem(`zappi.ks.${name}`, storedValue)
    }

    expect(isKillSwitchOn(name)).toBe(expected)
  })

  it('readKillSwitches returns a snapshot covering every switch', () => {
    localStorage.setItem('zappi.ks.recovery-split', '1')
    const snapshot = readKillSwitches()

    expect(Object.keys(snapshot).sort()).toEqual([...KILL_SWITCH_NAMES].sort())
    expect(snapshot['recovery-split']).toBe(true)
    expect(snapshot['nostr-controller']).toBe(false)
  })
})
