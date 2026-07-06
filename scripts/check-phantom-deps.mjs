#!/usr/bin/env node
/**
 * 팬텀 의존성 검사 (감사 Phase 3 프로세스 게이트 — 리뷰 MINOR 2회 재발 처방)
 *
 * warm-tree 검증(lint/build/test)은 lock 이 추적하지 않는 stale node_modules
 * 고아 디렉토리 덕에 green 일 수 있다 — light-bolt11-decoder(3a),
 * recharts/react-day-picker(3c)가 실제 사고 사례. 이 스크립트는 src + vite.config
 * 의 bare import 전수를 package.json 선언과 대조해, 신선 설치에서 깨질 참조를
 * 커밋 전에 잡는다. `bun run check:phantom` 으로 실행.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { builtinModules } from 'node:module'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])

// vite 가상 모듈 등 해석기가 소유하는 특수 스킴
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
    if (spec.startsWith('.') || spec.startsWith('@/')) continue // 상대/앨리어스
    if (VIRTUAL_PREFIXES.some((p) => spec.startsWith(p))) continue
    const name = packageOf(spec)
    if (NODE_BUILTINS.has(name)) continue
    if (!declared.has(name)) {
      if (!phantoms.has(name)) phantoms.set(name, [])
      phantoms.get(name).push(`${file} ← '${spec}'`)
    }
  }
}

// manualChunks 의 문자열 패키지 참조도 대조 — vendor-* 청크가 삭제된 패키지를
// 가리키면 vite 해석 단계에서 빌드가 깨진다 (3a의 ndk, 3c의 recharts 클래스)
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
  console.error('✘ PHANTOM DEPENDENCIES — src 가 import 하지만 package.json 에 선언되지 않음:')
  for (const [name, sites] of phantoms) {
    console.error(`  ${name}`)
    for (const s of sites.slice(0, 3)) console.error(`    ${s}`)
  }
  console.error('\n신선 설치(fresh clone/CI)에서 빌드가 깨집니다. dependencies 에 선언하세요.')
  process.exit(1)
}
console.log(`✓ phantom deps 없음 (${files.length} files, ${declared.size} declared packages)`)
