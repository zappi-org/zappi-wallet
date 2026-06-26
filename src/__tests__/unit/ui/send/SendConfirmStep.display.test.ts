import { describe, expect, it } from 'vitest'

import { PaymentRoute } from '@/core/domain/routing'
import { getConfirmDisplayInfo } from '@/ui/screens/Send/steps/SendConfirmStep'
import { getDestinationDisplay } from '@/ui/screens/Send/sendDisplayHelpers'
import type { ValidatedBolt11 } from '@/core/domain/input-types'

const t = (key: string) => {
  if (key === 'send.confirm.lightningInvoice') return 'Lightning 인보이스'
  return key
}

describe('send display text', () => {
  it('does not use a Lightning invoice description as the recipient name', () => {
    const invoice: ValidatedBolt11 = {
      type: 'bolt11',
      invoice: 'lnbc1000n1ecashdescriptiontest',
      amountSats: 1000,
      description: 'eCash',
      expiry: Date.now() + 60_000,
    }

    const display = getConfirmDisplayInfo(invoice, PaymentRoute.MELT_TO_LN, t)

    expect(display.recipient).toBe('Lightning 인보이스')
    expect(display.memo).toBe('eCash')
    expect(getDestinationDisplay(invoice)).toBe('Lightning')
  })
})
