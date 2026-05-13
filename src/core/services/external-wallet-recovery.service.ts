import type { EventBus } from '@/core/events/event-bus'
import type { ExternalMnemonicMintDiscoveryPort } from '@/core/ports/driven/external-mnemonic-mint-discovery.port'
import type {
  ExternalMnemonicRecoveryPort,
  ExternalMnemonicRecoveryProgress,
} from '@/core/ports/driven/external-mnemonic-recovery.port'
import type { RecoveredTokenReceiver } from '@/core/ports/driven/recovered-token-receiver.port'
import type { TrustedAccountStore } from '@/core/ports/driven/trusted-account-store.port'
import type {
  ExternalWalletRecoveryReport,
  ExternalWalletRecoveryUseCase,
} from '@/core/ports/driving/external-wallet-recovery.usecase'

export class ExternalWalletRecoveryService implements ExternalWalletRecoveryUseCase {
  constructor(
    private readonly mintDiscovery: ExternalMnemonicMintDiscoveryPort,
    private readonly mnemonicRecovery: ExternalMnemonicRecoveryPort,
    private readonly tokenReceiver: RecoveredTokenReceiver,
    private readonly trustedAccounts: TrustedAccountStore,
    private readonly eventBus: EventBus,
  ) {}

  async recoverFromMnemonic(params: {
    mnemonic: string
    currentMintUrls: string[]
    onProgress?: (progress: ExternalMnemonicRecoveryProgress) => void
  }): Promise<ExternalWalletRecoveryReport> {
    const discovery = await this.mintDiscovery.discoverMintUrls({ mnemonic: params.mnemonic })
    const mintUrls = uniqueNormalizedUrls([
      ...params.currentMintUrls,
      ...discovery.mintUrls,
    ])

    const recovery = await this.mnemonicRecovery.recoverTokens({
      mnemonic: params.mnemonic,
      mintUrls,
      onProgress: params.onProgress,
    })

    let recovered = 0
    let failed = recovery.failedMints.length
    const recoveredMintUrls: string[] = []
    let trustedMintUrls = await this.trustedAccounts.getTrustedAccounts()

    for (const item of recovery.tokens) {
      const result = await this.tokenReceiver.receiveRecoveredToken(item.token)
      if (result.success) {
        recovered += Number(result.amount.value)
        recoveredMintUrls.push(item.mintUrl)
        trustedMintUrls = await this.trustedAccounts.addTrustedAccount(item.mintUrl)
      } else {
        failed += 1
      }
    }

    if (recovered > 0) {
      this.eventBus.emit({
        type: 'recovery:completed',
        payload: { moduleId: 'cashu', recovered, failed },
      })
    }

    return {
      recovered,
      failed,
      scannedMints: recovery.scannedMints,
      recoveredMintUrls: uniqueNormalizedUrls(recoveredMintUrls),
      discoveredMintUrls: uniqueNormalizedUrls(discovery.mintUrls),
      trustedMintUrls,
      failedMints: recovery.failedMints,
    }
  }
}

function uniqueNormalizedUrls(urls: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const url of urls) {
    const normalized = url.trim().replace(/\/+$/, '')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }

  return result
}
