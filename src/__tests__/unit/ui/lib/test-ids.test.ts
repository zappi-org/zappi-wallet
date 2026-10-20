/**
 * TEST_IDS guard: no duplicate values (across both groups), no screen-prefix drift, and the
 * wired/pending groups stay disjoint so a promoted handle can't be forgotten in both.
 */
import { describe, it, expect } from 'vitest'
import { PENDING_TEST_IDS, TEST_IDS, rowAttrs, stateAttrs } from '@/ui/lib/test-ids'

function entriesOf(group: Record<string, Record<string, string>>) {
  return Object.entries(group).flatMap(([screen, ids]) =>
    Object.entries(ids).map(([name, value]) => ({ screen, name, value: String(value) })),
  )
}

const wired = entriesOf(TEST_IDS)
const pending = entriesOf(PENDING_TEST_IDS)
const all = [...wired, ...pending]

describe('test-id inventory', () => {
  it('has no duplicate values across wired AND pending handles', () => {
    const seen = new Set<string>()
    for (const { value } of all) {
      expect(seen.has(value), `duplicate id: ${value}`).toBe(false)
      seen.add(value)
    }
  })

  it('every id is kebab-case and starts with its screen prefix', () => {
    for (const { screen, value } of all) {
      const prefix = screen.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      expect(value, `${screen}/${value}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(value.startsWith(`${prefix}-`), `${value} should start with ${prefix}-`).toBe(true)
    }
  })

  it('keeps the two groups disjoint — a pending handle that went live must move', () => {
    const wiredScreens = new Set(Object.keys(TEST_IDS))
    for (const screen of Object.keys(PENDING_TEST_IDS)) {
      expect(wiredScreens.has(screen), `${screen} is in both groups`).toBe(false)
    }
  })
})

describe('rowAttrs', () => {
  it('keeps the row id fixed and the varying part in data-item-id', () => {
    expect(rowAttrs('signer-activity-row', 'evt-1')).toEqual({
      'data-testid': 'signer-activity-row',
      'data-item-id': 'evt-1',
    })
    expect(rowAttrs('signer-activity-row', 'evt-2', 3)).toMatchObject({
      'data-testid': 'signer-activity-row',
      'data-item-id': 'evt-2',
      'data-index': 3,
    })
  })
})

describe('stateAttrs', () => {
  it('omits data-count when unknown (empty/loading states)', () => {
    expect(stateAttrs('signer-activity-list', 'loading')).not.toHaveProperty('data-count')
    expect(stateAttrs('signer-activity-list', 'ready', 0)).toMatchObject({
      'data-state': 'ready',
      'data-count': 0,
    })
  })
})
