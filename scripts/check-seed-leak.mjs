#!/usr/bin/env node
/**
 * Artifact scan: fails when the real `DEV_SEED_MNEMONIC` is in dist/. The alias in
 * vite.config.ts is the primary guard; this catches what an alias cannot see (relative
 * imports, a dropped override). `seed-leak.test.ts` proves a hit is detectable at all.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findSeedLeak } from './seed-leak.mjs'

const distDir = fileURLToPath(new URL('../dist', import.meta.url))
if (!existsSync(distDir)) {
  console.error('No dist/ — run `npm run build` first.')
  process.exit(1)
}

const { leaked, files } = findSeedLeak({ distDir })
if (leaked) {
  console.error('✗ DEV_SEED_MNEMONIC is present in the production bundle:')
  for (const file of files) console.error(`  - ${file}`)
  process.exit(1)
}
console.log('✓ DEV_SEED_MNEMONIC is absent from the production bundle')
