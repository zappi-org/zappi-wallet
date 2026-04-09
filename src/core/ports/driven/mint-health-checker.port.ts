export interface MintHealthStatus {
  url: string
  isOnline: boolean
  lastChecked: number
  responseTimeMs?: number
  errorMessage?: string
  checkMethod?: 'websocket' | 'http' | 'cached'
}

export interface MintHealthChecker {
  checkMint(mintUrl: string): Promise<MintHealthStatus>
  checkAllMints(mintUrls: string[]): Promise<MintHealthStatus[]>
  getCached(mintUrl: string): MintHealthStatus | null
}
