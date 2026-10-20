export declare function seedNeedles(mnemonic?: string): { plain: string; spaced: RegExp }
export declare function findSeedLeak(args: { distDir: string; mnemonic?: string }): {
  leaked: boolean
  files: string[]
}
