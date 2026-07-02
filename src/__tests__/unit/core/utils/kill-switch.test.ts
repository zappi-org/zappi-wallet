import { describe, it, expect, afterEach } from 'vitest'
import { isKillSwitchOn, readKillSwitches, KILL_SWITCH_NAMES } from '@/core/utils/kill-switch'

describe('kill-switch', () => {
  afterEach(() => {
    for (const name of KILL_SWITCH_NAMES) {
      localStorage.removeItem(`zappi.ks.${name}`)
    }
  })

  it('is off by default', () => {
    expect(isKillSwitchOn('cursor')).toBe(false)
  })

  it("is on only when the stored value is exactly '1'", () => {
    localStorage.setItem('zappi.ks.tls-sweep', '1')
    expect(isKillSwitchOn('tls-sweep')).toBe(true)

    localStorage.setItem('zappi.ks.cursor', 'true')
    expect(isKillSwitchOn('cursor')).toBe(false)
  })

  it('readKillSwitches returns a snapshot covering every switch', () => {
    localStorage.setItem('zappi.ks.recovery-split', '1')
    const snapshot = readKillSwitches()

    expect(Object.keys(snapshot).sort()).toEqual([...KILL_SWITCH_NAMES].sort())
    expect(snapshot['recovery-split']).toBe(true)
    expect(snapshot['nostr-controller']).toBe(false)
  })
})
