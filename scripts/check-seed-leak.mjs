#!/usr/bin/env node
/**
 * Artifact gate, run after build (CI and the Docker image, since that is what Jenkins deploys).
 * Fails when a dev-only surface reaches dist/.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findDevEscapes, findSeedLeak } from './seed-leak.mjs'

const distDir = fileURLToPath(new URL('../dist', import.meta.url))
if (!existsSync(distDir)) {
  console.error('No dist/ — run `npm run build` first.')
  process.exit(1)
}

const seed = findSeedLeak({ distDir })
const escapes = findDevEscapes({ distDir })

if (seed.leaked) {
  console.error('✗ DEV_SEED_MNEMONIC is present in the production bundle:')
  for (const file of seed.files) console.error(`  - ${file}`)
}
if (escapes.leaked) {
  console.error('✗ dev-only install-screen escapes are present in the production bundle:')
  for (const file of escapes.files) console.error(`  - ${file}`)
}
if (seed.leaked || escapes.leaked) process.exit(1)

console.log('✓ no dev seed, no install-screen escapes in the production bundle')
