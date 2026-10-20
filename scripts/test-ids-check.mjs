/**
 * Drift check for the test-id contract, in the one direction a type system cannot see:
 * a handle that is declared in `src/ui/lib/test-ids.ts` but never referenced by a component
 * (renamed prop, dropped attribute, copy-paste leftover). Agents then assert on an id that
 * no screen renders and read the resulting silence as a product bug.
 *
 * The other direction — a screen that hardcodes its own `data-testid` string — is not gated
 * here: a handful of older screens use literal testids for their own unit tests, and they are
 * internal, not part of the agent contract.
 *
 * Shared by `npm run testids -- --check` and the vitest guard, so the two cannot disagree.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SCANNABLE = /\.(ts|tsx)$/
const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'dist'])
const CONTRACT_FILE = 'ui/lib/test-ids.ts'

/** Every .ts/.tsx under `srcRoot`, tests and build output excluded. */
export function collectSourceFiles(srcRoot) {
	const files = []
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
			const full = join(dir, entry.name)
			if (entry.isDirectory()) walk(full)
			else if (SCANNABLE.test(entry.name)) files.push(full)
		}
	}
	if (statSync(srcRoot).isDirectory()) walk(srcRoot)
	return files
}

/**
 * @param {object} args
 * @param {Record<string, Record<string, string>>} args.inventory  TEST_IDS
 * @param {string} args.srcRoot                                    `<repo>/src`
 * @returns {{ ok: boolean, problems: string[], checked: number }}
 */
export function checkTestIds({ inventory, srcRoot }) {
	const sources = collectSourceFiles(srcRoot)
		.filter((file) => !file.endsWith(CONTRACT_FILE))
		.map((file) => ({ file, text: readFileSync(file, 'utf-8') }))

	const problems = []
	let checked = 0

	for (const [screen, handles] of Object.entries(inventory)) {
		for (const [name, value] of Object.entries(handles)) {
			checked += 1
			const id = String(value)
			// Referenced either by constant (`TEST_IDS.app.navTab`) or by literal value.
			const used = sources.some(
				({ text }) => new RegExp(`\\.${name}\\b`).test(text) || text.includes(`'${id}'`) || text.includes(`"${id}"`),
			)
			if (!used) {
				problems.push(`${screen}.${name} ('${id}') is declared but never referenced — screen renamed it or stopped rendering it`)
			}
		}
	}

	return { ok: problems.length === 0, problems, checked }
}
