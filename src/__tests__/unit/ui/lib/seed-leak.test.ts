/** A scanner that cannot see a planted leak proves nothing. Also pins precision: the app's
 * i18n has "abandon the remaining …", which must not count as a hit. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DEV_SEED_MNEMONIC } from '@/ui/lib/dev-seed'
import { findSeedLeak } from '../../../../../scripts/seed-leak.mjs'

const dir = mkdtempSync(join(tmpdir(), 'seed-leak-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('seed leak scan', () => {
  it('flags a bundle that contains the DEV_SEED_MNEMONIC constant', () => {
    writeFileSync(join(dir, 'leaked.js'), `const seed = "${DEV_SEED_MNEMONIC}";`)
    expect(findSeedLeak({ distDir: dir })).toEqual({ leaked: true, files: [join(dir, 'leaked.js')] })
  })

  it('flags a minified form split across whitespace only', () => {
    const words = DEV_SEED_MNEMONIC.split(' ')
    writeFileSync(join(dir, 'spaced.js'), `x="${words.slice(0, 6).join('\\n')} ${words.slice(6).join(' ')}"`)
    expect(findSeedLeak({ distDir: dir }).leaked).toBe(true)
  })

  it('does not flag a bundle without the constant, even with similar wording', () => {
    rmSync(join(dir, 'leaked.js'), { force: true })
    rmSync(join(dir, 'spaced.js'), { force: true })
    writeFileSync(
      join(dir, 'clean.js'),
      'const t = "abandon the remaining {{amount}} on that mint."; const u = "abandon abandon about";',
    )
    expect(findSeedLeak({ distDir: dir })).toEqual({ leaked: false, files: [] })
  })
})
