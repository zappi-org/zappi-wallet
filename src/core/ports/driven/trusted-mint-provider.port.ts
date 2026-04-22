export interface TrustedMintProvider {
  hasTrustedMint(mintUrl: string): Promise<boolean>
}
