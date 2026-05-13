import type { ValidatedCashuRequest } from '@/core/domain/input-types'

export type NostrDirectPaymentResolution =
  | {
      status: 'ready'
      validatedData: ValidatedCashuRequest
      commonMintUrls: string[]
      selectedMintUrl: string
    }
  | {
      status: 'needs-mint-selection'
      validatedData: ValidatedCashuRequest
      commonMintUrls: string[]
    }
  | { status: 'no-info' }
  | { status: 'no-common-mint' }
  | { status: 'no-relay' }

export interface NostrDirectPaymentUseCase {
  resolve(params: {
    address: string
    ownMintUrls: string[]
    selectedMintUrl?: string | null
  }): Promise<NostrDirectPaymentResolution>
}
