import { describe, expect, it, vi } from 'vitest'
import { sat } from '@/core/domain/amount'
import type { EventBus } from '@/core/events/event-bus'
import type { ExternalMnemonicMintDiscoveryPort } from '@/core/ports/driven/external-mnemonic-mint-discovery.port'
import type { ExternalMnemonicRecoveryPort } from '@/core/ports/driven/external-mnemonic-recovery.port'
import type { RecoveredTokenReceiver } from '@/core/ports/driven/recovered-token-receiver.port'
import type { TrustedAccountStore } from '@/core/ports/driven/trusted-account-store.port'
import { ExternalWalletRecoveryService } from '@/core/services/external-wallet-recovery.service'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('ExternalWalletRecoveryService', () => {
  it('discovers mint URLs, recovers tokens, receives them into the current wallet, and trusts only successful mints', async () => {
    const mintDiscovery: ExternalMnemonicMintDiscoveryPort = {
      discoverMintUrls: vi.fn().mockResolvedValue({
        mintUrls: ['https://old.mint/', 'https://current.mint'],
        discoveredMints: [],
        failedSources: [],
      }),
    }
    const mnemonicRecovery: ExternalMnemonicRecoveryPort = {
      recoverTokens: vi.fn().mockResolvedValue({
        tokens: [
          { mintUrl: 'https://current.mint', token: 'cashuAcurrent', amount: 100, proofCount: 1 },
          { mintUrl: 'https://old.mint', token: 'cashuAold', amount: 50, proofCount: 1 },
        ],
        scannedMints: 2,
        failedMints: [{ mintUrl: 'https://dead.mint', error: 'offline' }],
      }),
    }
    const tokenReceiver: RecoveredTokenReceiver = {
      receiveRecoveredToken: vi.fn()
        .mockResolvedValueOnce({ success: true, amount: sat(100) })
        .mockResolvedValueOnce({ success: false, error: 'spent' }),
    }
    const trustedAccounts: TrustedAccountStore = {
      getTrustedAccounts: vi.fn().mockResolvedValue(['https://current.mint']),
      addTrustedAccount: vi.fn().mockResolvedValue(['https://current.mint']),
    }
    const eventBus = { emit: vi.fn() } as unknown as EventBus
    const service = new ExternalWalletRecoveryService(
      mintDiscovery,
      mnemonicRecovery,
      tokenReceiver,
      trustedAccounts,
      eventBus,
    )

    const report = await service.recoverFromMnemonic({
      mnemonic: MNEMONIC,
      currentMintUrls: ['https://current.mint'],
    })

    expect(mintDiscovery.discoverMintUrls).toHaveBeenCalledWith({ mnemonic: MNEMONIC })
    expect(mnemonicRecovery.recoverTokens).toHaveBeenCalledWith({
      mnemonic: MNEMONIC,
      mintUrls: ['https://current.mint', 'https://old.mint'],
      onProgress: undefined,
    })
    expect(tokenReceiver.receiveRecoveredToken).toHaveBeenNthCalledWith(1, 'cashuAcurrent')
    expect(tokenReceiver.receiveRecoveredToken).toHaveBeenNthCalledWith(2, 'cashuAold')
    expect(trustedAccounts.addTrustedAccount).toHaveBeenCalledOnce()
    expect(trustedAccounts.addTrustedAccount).toHaveBeenCalledWith('https://current.mint')
    expect(report).toEqual({
      recovered: 100,
      failed: 2,
      scannedMints: 2,
      recoveredMintUrls: ['https://current.mint'],
      discoveredMintUrls: ['https://old.mint', 'https://current.mint'],
      trustedMintUrls: ['https://current.mint'],
      failedMints: [{ mintUrl: 'https://dead.mint', error: 'offline' }],
    })
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: 'recovery:completed',
      payload: { moduleId: 'cashu', recovered: 100, failed: 2 },
    })
  })
})
