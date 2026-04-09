import type { MintHealthUseCase, MintHealthStatus } from '@/core/ports/driving/mint-health.usecase'
import type { MintHealthChecker } from '@/core/ports/driven/mint-health-checker.port'

export class MintHealthFacadeService implements MintHealthUseCase {
  constructor(private readonly checker: MintHealthChecker) {}

  checkMint(mintUrl: string): Promise<MintHealthStatus> {
    return this.checker.checkMint(mintUrl)
  }

  checkAllMints(mintUrls: string[]): Promise<MintHealthStatus[]> {
    return this.checker.checkAllMints(mintUrls)
  }

  async selectMintWithFallback(
    preferred: string,
    all: string[],
  ): Promise<{ mintUrl: string; wasPreferred: boolean } | null> {
    const preferredStatus = await this.checker.checkMint(preferred)
    if (preferredStatus.isOnline) {
      return { mintUrl: preferred, wasPreferred: true }
    }

    const statuses = await this.checker.checkAllMints(all)
    const online = statuses.find((s) => s.isOnline)
    if (online) {
      return { mintUrl: online.url, wasPreferred: false }
    }

    return null
  }

  getCached(mintUrl: string): MintHealthStatus | null {
    return this.checker.getCached(mintUrl)
  }
}
