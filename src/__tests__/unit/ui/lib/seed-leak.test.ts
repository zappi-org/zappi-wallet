/** Planted hits prove the scanners work; the clean cases pin precision (i18n wording, and the
 * bare words `seed`/`standalone`/`bypass` that ship legitimately). */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DEV_SEED_MNEMONIC } from '@/ui/lib/dev-seed'
import { findDevEscapes, findSeedLeak } from '../../../../../scripts/seed-leak.mjs'

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

describe('install-screen escape scan', () => {
  const escapeDir = mkdtempSync(join(tmpdir(), 'escape-leak-'))
  afterAll(() => rmSync(escapeDir, { recursive: true, force: true }))

  it('flags each escape the minifier would emit for a live dev gate', () => {
    for (const shape of [
      'p.get("mode")==="standalone"',
      'p.get("bypass")==="true"',
      'p.has("seed")',
    ]) {
      writeFileSync(join(escapeDir, 'bundle.js'), `const x=${shape}`)
      expect(findDevEscapes({ distDir: escapeDir }).leaked, shape).toBe(true)
    }
  })

  it('does not flag a clean bundle, nor the bare words that legitimately ship', () => {
    writeFileSync(
      join(escapeDir, 'bundle.js'),
      'matchMedia("(display-mode: standalone)");"standalone"in navigator;const bypass=1;seedPhrase;',
    )
    expect(findDevEscapes({ distDir: escapeDir })).toEqual({ leaked: false, files: [] })
  })
})
