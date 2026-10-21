/**
 * TEST_IDS guard: no duplicate values, no screen-prefix drift. Drift against the components
 * that render them is covered by test-ids-usage.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { TEST_IDS, rowAttrs, stateAttrs } from '@/ui/lib/test-ids'

function entriesOf(group: Record<string, Record<string, string>>) {
  return Object.entries(group).flatMap(([screen, ids]) =>
    Object.entries(ids).map(([name, value]) => ({ screen, name, value: String(value) })),
  )
}

const all = entriesOf(TEST_IDS)

describe('test-id inventory', () => {
  it('has no duplicate values', () => {
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
