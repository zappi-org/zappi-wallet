import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import { useAppStore } from '@/store'
import { normalizeMintUrl } from '@/utils/url'

export class TrustedMintProviderAdapter implements TrustedMintProvider {
  async hasTrustedMint(mintUrl: string): Promise<boolean> {
    const normalized = normalizeMintUrl(mintUrl)
    return useAppStore.getState().settings.mints.some((candidate) => normalizeMintUrl(candidate) === normalized)
  }
}
