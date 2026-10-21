export declare const DEV_ESCAPE_NEEDLES: string[]
export declare function seedNeedles(mnemonic?: string): { plain: string; spaced: RegExp }
export declare function findSeedLeak(args: { distDir: string; mnemonic?: string }): {
  leaked: boolean
  files: string[]
}
export declare function findDevEscapes(args: { distDir: string; needles?: string[] }): {
  leaked: boolean
  files: string[]
}
