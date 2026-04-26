import { describe, expect, it } from 'vitest'
import { isSameOrder, moveItem, reconcileOrder } from '@/utils/reorder'

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

describe('isSameOrder', () => {
  it('checks strict ordered equality', () => {
    expect(isSameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(isSameOrder(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(isSameOrder(['a'], ['a', 'b'])).toBe(false)
  })
})

describe('reconcileOrder', () => {
  it('keeps local order while adding new source items and dropping removed ones', () => {
    expect(reconcileOrder(['b', 'a', 'removed'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })
})
