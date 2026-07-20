import { describe, it, expect } from 'vitest'
import { InputParserService } from '@/core/services/input-parser.service'
import { InvoiceExpiredError } from '@/core/errors/lightning'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type { InputType } from '@/core/domain/input-types'

// validateAsync's bolt11 path touches neither the codec nor the LNURL gateway.
const parser = new InputParserService({} as TokenCodec, {} as LnurlGateway)

const bolt11Input = (isExpired: boolean): InputType => ({
  type: 'bolt11',
  invoice: 'lnbc20u1p3y0x3hdummy',
  amountSats: 2000,
  description: '',
  isExpired,
  expiry: 1650000000,
  paymentHash: 'hash',
})

describe('InputParserService.validateAsync bolt11 expiry gate', () => {
  it('rejects an expired invoice instead of validating it as payable', async () => {
    await expect(parser.validateAsync(bolt11Input(true))).rejects.toBeInstanceOf(InvoiceExpiredError)
  })

  it('passes a live invoice through with its fields intact', async () => {
    await expect(parser.validateAsync(bolt11Input(false))).resolves.toMatchObject({
      type: 'bolt11',
      invoice: 'lnbc20u1p3y0x3hdummy',
      amountSats: 2000,
    })
  })
})
