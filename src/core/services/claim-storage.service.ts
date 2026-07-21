import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { AuthSession } from '@/core/ports/driven/payment-alias-provider.port'
import type { ClaimResult, ClaimStorageMode } from '@/core/ports/driven/payment-alias-provider.port'
import type { ClaimStorageUseCase } from '@/core/ports/driving/claim-storage.usecase'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'
import type { EventBus } from '@/core/events/event-bus'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export type SignerFactory = (privkey: string) => NostrSigner

export class ClaimStorageService implements ClaimStorageUseCase {
  constructor(
    private readonly provider: PaymentAliasProvider,
    private readonly createSigner: SignerFactory,
    private readonly eventBus: EventBus,
  ) {}

  private async authenticate(privkey: string): Promise<Result<AuthSession, BaseError>> {
    const signer = this.createSigner(privkey)
    return this.provider.authenticate(signer)
  }

  async getBalance(privkey: string): Promise<Result<number, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session
    return this.provider.getBalance(session.value)
  }

  async getClaim(privkey: string): Promise<Result<ClaimResult, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session
    return this.provider.getClaim(session.value)
  }

  async getClaimStorageMode(privkey: string): Promise<Result<ClaimStorageMode, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session
    return this.provider.getClaimStorageMode(session.value)
  }

  async setClaimStorageMode(privkey: string, mode: ClaimStorageMode): Promise<Result<ClaimStorageMode, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session
    return this.provider.setClaimStorageMode(session.value, mode)
  }
}
