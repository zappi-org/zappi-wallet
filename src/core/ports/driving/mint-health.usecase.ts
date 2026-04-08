export interface MintHealthStatus {
  url: string
  isOnline: boolean
  lastChecked: number
  responseTimeMs?: number
  errorMessage?: string
  checkMethod?: 'websocket' | 'http' | 'cached'
}

export interface MintHealthUseCase {
  checkMint(mintUrl: string): Promise<MintHealthStatus>
  checkAllMints(mintUrls: string[]): Promise<MintHealthStatus[]>
  selectMintWithFallback(
    preferred: string,
    all: string[],
  ): Promise<{ mintUrl: string; wasPreferred: boolean } | null>
  getCached(mintUrl: string): MintHealthStatus | null
}
