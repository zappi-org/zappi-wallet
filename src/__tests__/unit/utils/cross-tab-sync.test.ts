/**
 * notifyKdfMigrated — KDF 마이그레이션 직후 타 탭 하드닝 (docs §6.4 R1).
 * handleUnlock 이 migrated=true 에 호출하는 UI-층 side-effect 의 계약:
 * settings_changed broadcast 1회 + localStorage['lockout'] 소거.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { notifyKdfMigrated } from '@/utils/cross-tab-sync'

interface Post {
  channel: string
  data: unknown
}
const posts: Post[] = []

class FakeBroadcastChannel {
  constructor(public name: string) {}
  postMessage(data: unknown) {
    posts.push({ channel: this.name, data })
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

describe('notifyKdfMigrated', () => {
  beforeEach(() => {
    posts.length = 0
    localStorage.clear()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  it('broadcasts settings_changed exactly once', () => {
    notifyKdfMigrated()
    const settings = posts.filter((p) => (p.data as { type?: string }).type === 'settings_changed')
    expect(settings).toHaveLength(1)
    expect(settings[0].channel).toBe('zappi-sync')
  })

  it('removes the false lockout that a downgraded old-bundle tab may have written', () => {
    localStorage.setItem('lockout', JSON.stringify({ attempts: 5, until: Date.now() + 900000 }))
    notifyKdfMigrated()
    expect(localStorage.getItem('lockout')).toBeNull()
  })

  it('does both effects together', () => {
    localStorage.setItem('lockout', JSON.stringify({ attempts: 5 }))
    notifyKdfMigrated()
    expect(localStorage.getItem('lockout')).toBeNull()
    expect(posts.some((p) => (p.data as { type?: string }).type === 'settings_changed')).toBe(true)
  })

  it('swallows a localStorage.removeItem throw (private-mode) — broadcast still went out (구현 리뷰 NIT)', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    try {
      expect(() => notifyKdfMigrated()).not.toThrow()
      expect(posts.some((p) => (p.data as { type?: string }).type === 'settings_changed')).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
