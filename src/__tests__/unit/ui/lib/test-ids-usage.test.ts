/**
 * Drift guard: every handle declared in `src/ui/lib/test-ids.ts` must be referenced by a
 * component. A declared-but-unrendered id is the worst failure mode for automation — the
 * smoke run reports "element not found" and whoever reads it blames the product.
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { TEST_IDS } from '@/ui/lib/test-ids'
import { checkTestIds } from '../../../../../scripts/test-ids-check.mjs'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')

describe('test-id drift', () => {
  it('every declared handle is referenced by a component', () => {
    const { ok, problems, checked } = checkTestIds({ inventory: TEST_IDS, srcRoot })
    expect(checked).toBeGreaterThan(0)
    expect(problems, problems.join('\n')).toEqual([])
    expect(ok).toBe(true)
  })
})
