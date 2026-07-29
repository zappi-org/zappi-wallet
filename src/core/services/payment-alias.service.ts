import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type {
  AccountInfo,
  AliasResult,
  PaidQuote,
} from '@/core/ports/driven/payment-alias-provider.port'
import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'
import type { AuthSession } from '@/core/ports/driven/payment-alias-provider.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import type { PaymentAliasUseCase, AliasPriceInfo } from '@/core/ports/driving/payment-alias.usecase'
import { Ok, type Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import { NpubcashPaymentRequiredError } from '@/core/errors/npubcash'
import { createTransaction, settleAsDelivered, failTransaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'

export type SignerFactory = (privkey: string) => NostrSigner

export class PaymentAliasService implements PaymentAliasUseCase {
  constructor(
    private readonly provider: PaymentAliasProvider,
    private readonly mint: Pick<RoutePaymentOperator, 'mintAndReceive'>,
    private readonly createSigner: SignerFactory,
    private readonly txRepo: TransactionRepository,
    private readonly routePaymentOperator: RoutePaymentOperator,
    private readonly eventBus: EventBus,
    private readonly domain: string,
  ) {}

  private async authenticate(privkey: string): Promise<Result<AuthSession, BaseError>> {
    const signer = this.createSigner(privkey)
    return this.provider.authenticate(signer)
  }

  async getAlias(privkey: string): Promise<Result<AccountInfo, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session
    return this.provider.getAccountInfo(session.value)
  }

  async registerAlias(privkey: string): Promise<Result<AliasResult, BaseError>> {
    const signer = this.createSigner(privkey)
    const session = await this.provider.authenticate(signer)
    if (!session.ok) return session
    const npub = signer.getNpub()

    const info = await this.provider.getAccountInfo(session.value)
    if (!info.ok) return info

    if (info.value.alias) {
      return Ok({ alias: info.value.alias, npub })
    }

    return Ok({ alias: npub, npub })
  }

  async checkAliasPrice(privkey: string, alias: string): Promise<Result<AliasPriceInfo, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session

    const result = await this.provider.purchaseAlias(session.value, alias, '')

    if (!result.ok && result.error instanceof NpubcashPaymentRequiredError) {
      const parsed = await this.routePaymentOperator.parsePaymentRequest(result.error.encodedRequest)
      const mintUrl = parsed.mints[0]
      return Ok({ amount: parsed.amount, unit: parsed.unit ?? 'sat', mintUrl: mintUrl ?? '' })
    }

    if (!result.ok) return result

    return Ok({ amount: 0, unit: 'sat', mintUrl: '' })
  }

  async changeAlias(privkey: string, alias: string, cashuToken: string): Promise<Result<AliasResult, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session

    let result = await this.provider.purchaseAlias(session.value, alias, cashuToken)

    if (!result.ok && result.error instanceof NpubcashPaymentRequiredError && !cashuToken) {
      const paymentReq = result.error
      console.log('[PaymentAlias] 402 received, creq length:', paymentReq.encodedRequest.length)
      const parsed = await this.routePaymentOperator.parsePaymentRequest(paymentReq.encodedRequest)
      const mintUrl = parsed.mints[0]
      console.log('[PaymentAlias] creq decoded:', { amount: parsed.amount, unit: parsed.unit, mintUrl })
      if (!mintUrl || !parsed.amount) return result

      const destination = `${alias}@${this.domain}`
      const txId = `payment-alias-${alias}-${Date.now()}`
      let operationId: string | undefined

      const tx = createTransaction({
        id: txId,
        direction: 'send',
        method: 'cashu:ecash',
        protocol: 'nut24',
        amount: sat(parsed.amount),
        accountId: mintUrl,
        intent: 'request-pay',
        memo: `username:${destination}`,
        metadata: {
          destination,
          domain: this.domain,
          paymentRequest: paymentReq.encodedRequest,
        },
      })
      await this.txRepo.save(tx)

      try {
        const prepared = await this.routePaymentOperator.prepareTokenSend({
          mintUrl,
          amount: parsed.amount,
        })
        operationId = prepared.operationId

        const { token } = await this.routePaymentOperator.executeTokenSend(
          prepared.operationId,
          { memo: destination },
        )
        console.log('[PaymentAlias] token generated:', { prefix: token.slice(0, 10), length: token.length, mintUrl, amount: parsed.amount })

        await this.txRepo.update(txId, {
          metadata: {
            ...tx.metadata,
            token,
            operationId: prepared.operationId,
            tokenState: 'unspent',
          },
        })

        result = await this.provider.purchaseAlias(session.value, alias, token)

        if (result.ok) {
          console.log('[PaymentAlias] purchaseAlias(retry) OK:', result.value)
          await this.txRepo.update(txId, settleAsDelivered(tx))
          this.eventBus.emit({
            type: 'balance:changed',
            payload: { moduleId: 'cashu', accountId: mintUrl },
          })
          this.eventBus.emit({
            type: 'transactions:changed',
            payload: { reason: 'payment-alias' },
          })
        } else {
          if (operationId) {
            await this.routePaymentOperator.rollbackTokenSend(operationId).catch(() => {})
          }
          await this.txRepo.update(txId, failTransaction(tx))
        }
      } catch (error) {
        if (operationId) {
          await this.routePaymentOperator.rollbackTokenSend(operationId).catch(() => {})
        }
        const message = error instanceof Error ? error.message : 'Payment failed'
        await this.txRepo.update(txId, failTransaction(tx, message))
        throw error
      }
    }

    return result
  }

  async setMint(privkey: string, mintUrl: string): Promise<Result<void, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session
    return this.provider.setPreferredMint(session.value, mintUrl)
  }

  async toggleLock(privkey: string): Promise<Result<boolean, BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session
    return this.provider.toggleLock(session.value)
  }

  async claimPaidQuotes(privkey: string): Promise<Result<PaidQuote[], BaseError>> {
    const session = await this.authenticate(privkey)
    if (!session.ok) return session

    const quotes = await this.provider.getPaidQuotes(session.value)
    if (!quotes.ok) return quotes

    for (const q of quotes.value) {
      await this.mint.mintAndReceive(q.quoteId, q.mintUrl, q.amount)
    }

    return quotes
  }
}
