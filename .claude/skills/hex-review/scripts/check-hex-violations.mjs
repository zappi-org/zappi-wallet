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
 *
 * Layer map (2026-04-10):
 *   ui/           → driving adapter (screens, hooks, components, ...)
 *   composition/  → wiring (bootstrap, observers, cross-tab-sync)
 *   core/         → hexagon center (domain, ports, services, events, errors)
 *   adapters/     → driven adapter implementations
 *   modules/      → SDK integration (cashu)
 *   store/        → Zustand (cross-cutting, allowed from ui/composition)
 *   i18n/         → internationalization (cross-cutting)
 *   utils/        → cross-cutting utilities
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
    name: 'Module internal must not import ui/composition/adapters',
    severity: 'high',
    test(filePath, importPath) {
      if (!isModuleInternal(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      return resolved.startsWith('ui/') ||
             resolved.startsWith('composition/') ||
             resolved.startsWith('adapters/')
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
    name: 'UI must not import adapters/modules/composition',
    severity: 'high',
    test(filePath, importPath) {
      if (!isUI(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      return resolved.startsWith('adapters/') ||
             resolved.startsWith('modules/') ||
             resolved.startsWith('composition/')
    },
  },
  {
    id: 'R5',
    name: 'Composition must not import ui',
    severity: 'medium',
    test(filePath, importPath) {
      if (!isComposition(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      return resolved.startsWith('ui/')
    },
  },
  {
    id: 'R6',
    name: 'Core services must use ports, not concrete implementations',
    severity: 'medium',
    test(filePath, importPath) {
      if (!isCoreService(filePath)) return false
      const resolved = resolveAlias(importPath, filePath)
      if (!resolved) return false
      return resolved.startsWith('adapters/') ||
             /^modules\/[^/]+\/internal\//.test(resolved)
    },
  },
]

// ─── Path classifiers ───

function isCore(fp) {
  return fp.startsWith('core/')
}

function isCoreService(fp) {
  return fp.startsWith('core/services/')
}

function isModuleInternal(fp) {
  return /^modules\/[^/]+\/internal\//.test(fp)
}

function isAdapter(fp) {
  return fp.startsWith('adapters/')
}

function isUI(fp) {
  return fp.startsWith('ui/')
}

function isComposition(fp) {
  return fp.startsWith('composition/')
}

function getAdapterGroup(fp) {
  const match = fp.match(/^adapters\/([^/]+)\//)
  return match ? match[1] : null
}

function resolveAlias(importPath, filePath) {
  if (importPath.startsWith('@/')) return importPath.slice(2)
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
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
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist' || entry === '.pipeline') continue
      results.push(...collectFiles(full, ext))
    } else if (ext.some(e => full.endsWith(e))) {
      results.push(full)
    }
  }
  return results
}

function extractImports(content) {
  const imports = []
  const lines = content.split('\n')
  for (const line of lines) {
    const fromMatch = line.match(/\bfrom\s+['"]([^'"]+)['"]/)
    if (fromMatch) { imports.push(fromMatch[1]); continue }
    const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/)
    if (sideEffect) { imports.push(sideEffect[1]); continue }
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
