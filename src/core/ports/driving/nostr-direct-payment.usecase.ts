import type { DirectPaymentResolution } from '@/core/domain/send-route-resolution'
import type { DirectTokenInfo } from './address-resolver.usecase'

export type NostrDirectPaymentResolution = DirectPaymentResolution

export interface NostrDirectPaymentUseCase {
  resolve(params: {
    address: string
    ownMintUrls: string[]
    selectedMintUrl?: string | null
  }): Promise<NostrDirectPaymentResolution>

  resolveWithInfo(params: {
    address: string
    pubkey: string
    directToken: DirectTokenInfo
    ownMintUrls: string[]
    selectedMintUrl?: string | null
  }): NostrDirectPaymentResolution
}
