#!/usr/bin/env node
/**
 * Print the test-id inventory — the handles agents drive the app by.
 *
 *   npm run testids           # inventory
 *   npm run testids -- --check # exit 1 if a declared handle is never referenced
 *
 * Reads src/ui/lib/test-ids.ts, so it prints what the code uses, not a doc that rots.
 */

const modulePath = new URL('../src/ui/lib/test-ids.ts', import.meta.url)
const mod = await import(modulePath.href).catch((error) => {
  console.error(
    'Could not import src/ui/lib/test-ids.ts.\n' +
      'Node < 22.18 needs `bun scripts/list-test-ids.mjs`.\n' +
      `Cause: ${error.message}`,
  )
  process.exit(1)
})

function printGroup(title, group) {
  const screens = Object.keys(group)
  const total = screens.reduce((n, s) => n + Object.keys(group[s]).length, 0)
  console.log(`\n${title} (${total} ids / ${screens.length} screens)`)
  for (const screen of screens) {
    console.log(`  ${screen}`)
    for (const [name, value] of Object.entries(group[screen])) {
      console.log(`    ${String(value).padEnd(28)} ${name}`)
    }
  }
}

printGroup('WIRED — clickable today', mod.TEST_IDS)

if (process.argv.includes('--check')) {
  const { checkTestIds } = await import('./test-ids-check.mjs')
  const srcRoot = new URL('../src', import.meta.url).pathname
  const { ok, problems, checked } = checkTestIds({ inventory: mod.TEST_IDS, srcRoot })
  if (!ok) {
    console.error(`\n✗ ${problems.length} drift problem(s) in ${checked} handles:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`\n✓ all ${checked} handles are referenced by a component`)
}
