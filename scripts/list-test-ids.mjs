#!/usr/bin/env node
/**
 * Print the whole UI test-id inventory — the map an agent reads before driving the app.
 *
 *   bun scripts/list-test-ids.mjs      (or: node scripts/list-test-ids.mjs)
 *
 * Source of truth is src/ui/lib/test-ids.ts (plain data, no imports), so this prints what
 * the code actually uses rather than a doc that can rot.
 */

const modulePath = new URL('../src/ui/lib/test-ids.ts', import.meta.url)
const { TEST_IDS } = await import(modulePath.href).catch((error) => {
  console.error(
    'Could not import src/ui/lib/test-ids.ts.\n' +
      'Node < 22.18 needs `bun scripts/list-test-ids.mjs`.\n' +
      `Cause: ${error.message}`,
  )
  process.exit(1)
})

for (const [screen, ids] of Object.entries(TEST_IDS)) {
  console.log(`\n${screen}`)
  for (const [name, value] of Object.entries(ids)) {
    console.log(`  ${String(value).padEnd(28)} ${name}`)
  }
}

const total = Object.values(TEST_IDS).reduce((n, ids) => n + Object.keys(ids).length, 0)
console.log(`\n${Object.keys(TEST_IDS).length} screens · ${total} ids`)
