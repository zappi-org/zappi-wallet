/** Types for the plain-node drift checker so TS guards can import it. */
export declare function collectSourceFiles(srcRoot: string): string[]
export declare function checkTestIds(args: {
  inventory: Record<string, Record<string, string>>
  srcRoot: string
}): { ok: boolean; problems: string[]; checked: number }
