/**
 * Needles come from `DEV_SEED_MNEMONIC` itself, so a seed change cannot leave this stale.
 * `DEV_SEED_PIN` is not a needle: '123456' hits base64 alphabets and i18n number patterns.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEV_SEED_MNEMONIC } from '../src/ui/lib/dev-seed.ts'

const SCANNABLE = /\.(js|mjs|cjs|html|json|webmanifest|css)$/

/** Plain phrase plus a whitespace-tolerant form, for minified output. */
export function seedNeedles(mnemonic = DEV_SEED_MNEMONIC) {
  return {
    plain: mnemonic.trim(),
    spaced: new RegExp(mnemonic.trim().split(/\s+/).join('\\s+'), 'i'),
  }
}

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, out)
    else if (SCANNABLE.test(entry.name)) out.push(full)
  }
  return out
}

export function findSeedLeak({ distDir, mnemonic = DEV_SEED_MNEMONIC }) {
  const { plain, spaced } = seedNeedles(mnemonic)
  const files = collectFiles(distDir).filter((file) => {
    const text = readFileSync(file, 'utf-8')
    return text.includes(plain) || spaced.test(text)
  })
  return { leaked: files.length > 0, files }
}
