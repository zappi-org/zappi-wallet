#!/usr/bin/env node

/**
 * Hexagonal Architecture Violation Scanner
 *
 * Scans TypeScript/JavaScript source files for import-path violations
 * across hexagonal layer boundaries.
 *
 * Usage: node check-hex-violations.mjs [src-dir]
 *        Default src-dir: ./src
 *
 * Exit code 0: no violations, 1: violations found
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const srcDir = process.argv[2] || './src'

// ─── Rules ───

const rules = [
  {
    id: 'R1',
    name: 'Core must not import outside core',
    severity: 'critical',
    test(filePath, importPath) {
      if (!isCore(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      return !resolved.startsWith('core/')
    },
  },
  {
    id: 'R2',
    name: 'Module internal must not import legacy',
    severity: 'high',
    test(filePath, importPath) {
      if (!isModuleInternal(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      return resolved.startsWith('data/') || resolved.startsWith('coco/')
    },
  },
  {
    id: 'R3',
    name: 'Adapters must not cross-reference',
    severity: 'medium',
    test(filePath, importPath) {
      if (!isAdapter(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      if (!resolved.startsWith('adapters/')) return false
      const fileGroup = getAdapterGroup(filePath)
      const importGroup = getAdapterGroup(resolved)
      return fileGroup && importGroup && fileGroup !== importGroup
    },
  },
  {
    id: 'R4',
    name: 'Services must use ports, not concrete implementations',
    severity: 'medium',
    test(filePath, importPath) {
      if (!isService(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      return resolved.startsWith('data/') || /^modules\/[^/]+\/internal\//.test(resolved)
    },
  },
]

// ─── Path classifiers ───

function isCore(fp) {
  return fp.startsWith('core/')
}

function isModuleInternal(fp) {
  return /^modules\/[^/]+\/internal\//.test(fp)
}

function isAdapter(fp) {
  return fp.startsWith('adapters/')
}

function isService(fp) {
  return fp.startsWith('services/')
}

function getAdapterGroup(fp) {
  const match = fp.match(/^adapters\/([^/]+)\//)
  return match ? match[1] : null
}

function resolveAlias(importPath, filePath) {
  if (importPath.startsWith('@/')) return importPath.slice(2)
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    // Resolve relative path to detect cross-layer bypasses
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
    const parts = dir.split('/').filter(Boolean)
    for (const seg of importPath.split('/')) {
      if (seg === '..') parts.pop()
      else if (seg !== '.') parts.push(seg)
    }
    return parts.join('/')
  }
  return null // node_modules — skip
}

// ─── Scanner ───

function collectFiles(dir, ext = ['.ts', '.tsx', '.js', '.jsx']) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue
      results.push(...collectFiles(full, ext))
    } else if (ext.some(e => full.endsWith(e))) {
      results.push(full)
    }
  }
  return results
}

function extractImports(content) {
  const imports = []
  // Line-by-line scan for `from '...'` and `import '...'` patterns.
  // Handles multi-line imports like: import {\n  foo,\n  bar\n} from '@/...'
  const lines = content.split('\n')
  for (const line of lines) {
    // Static: from '...' or from "..."
    const fromMatch = line.match(/\bfrom\s+['"]([^'"]+)['"]/)
    if (fromMatch) { imports.push(fromMatch[1]); continue }
    // Side-effect: import '...' (no from keyword, no dynamic parens)
    const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/)
    if (sideEffect) { imports.push(sideEffect[1]); continue }
    // Dynamic: import('...')
    const dynMatch = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    if (dynMatch) imports.push(dynMatch[1])
  }
  return imports
}

function findLineNumber(content, importPath) {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(importPath)) {
      if (lines[i].includes('hex-ignore')) return { line: i + 1, ignored: true }
      return { line: i + 1, ignored: false }
    }
  }
  return { line: 0, ignored: false }
}

// ─── Main ───

const files = collectFiles(srcDir)
const violations = []
let ignoredCount = 0

for (const file of files) {
  const content = readFileSync(file, 'utf-8')
  const filePath = relative(srcDir, file).split(sep).join('/')
  const imports = extractImports(content)

  for (const imp of imports) {
    for (const rule of rules) {
      if (rule.test(filePath, imp)) {
        const { line, ignored } = findLineNumber(content, imp)
        if (ignored) {
          ignoredCount++
          continue
        }
        violations.push({
          rule: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          file: filePath,
          line,
          import: imp,
        })
      }
    }
  }
}

// ─── Output ───

if (violations.length === 0) {
  console.log(`\u2705 No hexagonal violations found. (${files.length} files scanned, ${ignoredCount} ignored)`)
  process.exit(0)
}

// Group by rule
const grouped = {}
for (const v of violations) {
  if (!grouped[v.rule]) grouped[v.rule] = []
  grouped[v.rule].push(v)
}

console.log(`\u274c ${violations.length} hexagonal violation(s) found (${files.length} files scanned, ${ignoredCount} ignored)\n`)

for (const [ruleId, items] of Object.entries(grouped).sort()) {
  const first = items[0]
  console.log(`--- ${ruleId}: ${first.ruleName} [${first.severity}] (${items.length}) ---`)
  for (const v of items) {
    console.log(`  ${v.file}:${v.line}  \u2192  ${v.import}`)
  }
  console.log()
}

process.exit(1)
