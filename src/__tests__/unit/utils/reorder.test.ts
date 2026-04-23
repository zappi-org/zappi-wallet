import { describe, expect, it } from 'vitest'
import { moveItem } from '@/utils/reorder'

describe('moveItem', () => {
  it('moves an item within the list', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('returns the same array reference when the move is invalid', () => {
    const items = ['a', 'b', 'c']
    expect(moveItem(items, 0, 0)).toBe(items)
    expect(moveItem(items, -1, 1)).toBe(items)
    expect(moveItem(items, 1, 3)).toBe(items)
  })
})
