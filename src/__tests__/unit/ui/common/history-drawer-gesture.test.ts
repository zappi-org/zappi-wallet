import { describe, expect, it } from 'vitest'
import { shouldHistoryDrawerStayOpen } from '@/ui/components/common/history-drawer-gesture'

describe('history drawer release decision', () => {
  it('closes an expanded drawer after 100px of downward travel', () => {
    expect(shouldHistoryDrawerStayOpen({
      expanded: true,
      travelled: 101,
      velocityY: 0,
    })).toBe(false)
  })

  it('returns an expanded drawer when a short drag is released', () => {
    expect(shouldHistoryDrawerStayOpen({
      expanded: true,
      travelled: 99,
      velocityY: 0,
    })).toBe(true)
  })

  it('uses flick direction before distance', () => {
    expect(shouldHistoryDrawerStayOpen({
      expanded: true,
      travelled: 20,
      velocityY: 501,
    })).toBe(false)
    expect(shouldHistoryDrawerStayOpen({
      expanded: false,
      travelled: 20,
      velocityY: -501,
    })).toBe(true)
  })
})
