#!/usr/bin/env node
/**
 * Phantom-dependency check.
 *
 * warm-tree verification (lint/build/test) can be green thanks to stale
 * node_modules orphan directories the lockfile doesn't track — light-bolt11-decoder
 * and recharts/react-day-picker were real incidents. This script cross-checks every
 * bare import in src + vite.config against package.json declarations to catch, before
 * commit, references that would break on a fresh install. Run via `bun run check:phantom`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { builtinModules } from 'node:module'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])

// Special schemes owned by the resolver (e.g. vite virtual modules)
const VIRTUAL_PREFIXES = ['virtual:', 'node:']
const NODE_BUILTINS = new Set(builtinModules)

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      yield* walk(p)
    } else if (/\.(ts|tsx|mjs)$/.test(name)) {
      yield p
    }
  }
}

function packageOf(spec) {
  if (spec.startsWith('@')) {
    const [scope, name] = spec.split('/')
    return name ? `${scope}/${name}` : spec
  }
  return spec.split('/')[0]
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g

const phantoms = new Map()
const files = [...walk('src'), 'vite.config.ts']
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (!spec) continue
    if (spec.startsWith('.') || spec.startsWith('@/')) continue // relative / alias
    if (VIRTUAL_PREFIXES.some((p) => spec.startsWith(p))) continue
    const name = packageOf(spec)
    if (NODE_BUILTINS.has(name)) continue
    if (!declared.has(name)) {
      if (!phantoms.has(name)) phantoms.set(name, [])
      phantoms.get(name).push(`${file} ← '${spec}'`)
    }
  }
}

// Also check the string package refs in manualChunks — if a vendor-* chunk points
// at a removed package, the build breaks during vite resolution.
const vite = readFileSync('vite.config.ts', 'utf8')
const chunksBlock = vite.match(/manualChunks\s*:\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
for (const m of chunksBlock.matchAll(/\[([^\]]*)\]/g)) {
  for (const item of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
    const name = packageOf(item[1])
    if (!declared.has(name)) {
      if (!phantoms.has(name)) phantoms.set(name, [])
      phantoms.get(name).push(`vite.config.ts manualChunks ← '${item[1]}'`)
    }
  }
}

if (phantoms.size > 0) {
  console.error('✘ PHANTOM DEPENDENCIES — imported by src but not declared in package.json:')
  for (const [name, sites] of phantoms) {
    console.error(`  ${name}`)
    for (const s of sites.slice(0, 3)) console.error(`    ${s}`)
  }
  console.error('\nA fresh install (clone/CI) will fail to build. Declare them in dependencies.')
  process.exit(1)
}
console.log(`✓ no phantom deps (${files.length} files, ${declared.size} declared packages)`)
