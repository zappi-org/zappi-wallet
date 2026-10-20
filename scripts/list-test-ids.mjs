#!/usr/bin/env node
/**
 * Print the test-id inventory — WIRED (clickable) first, then PENDING (screen not here yet).
 *
 *   npm run testids
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
printGroup('PENDING — screen not on this branch yet', mod.PENDING_TEST_IDS)
console.log('\nOnly WIRED handles are reachable; PENDING ones ship with their screen.')
