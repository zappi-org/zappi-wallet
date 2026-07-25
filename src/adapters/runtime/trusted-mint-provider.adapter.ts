import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import { normalizeMintUrl } from '@/core/domain/mint-url'

export class TrustedMintProviderAdapter implements TrustedMintProvider {
  constructor(
    private readonly getTrustedMintUrls: () => readonly string[],
  ) {}

  async hasTrustedMint(mintUrl: string): Promise<boolean> {
    const normalized = normalizeMintUrl(mintUrl)
    return this.getTrustedMintUrls().some((candidate) => normalizeMintUrl(candidate) === normalized)
  }
}
