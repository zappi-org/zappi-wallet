/**
 * Universal input router — maps validated input to the screen that owns it.
 *
 * Used by any scanner/paste surface (Home send, Token register, scanner modal)
 * so a pasted/scanned value always lands on the right flow regardless of
 * where it was entered.
 */

import type { ValidatedData } from '@/core/domain/input-types'

export type InputRouteTarget =
  | { screen: 'send'; validatedData: ValidatedData }
  | { screen: 'receive-redeem'; token: string }
  | { screen: 'amount-action'; amount: number }
  | { screen: 'unsupported'; type: ValidatedData['type'] }

export function routeValidatedInput(data: ValidatedData): InputRouteTarget {
  switch (data.type) {
    case 'bolt11':
    case 'lightning-address':
    case 'lnurl-pay':
    case 'cashu-request':
    case 'my-wallet':
      return { screen: 'send', validatedData: data }
    case 'cashu-token':
      return { screen: 'receive-redeem', token: data.token }
    case 'amount':
      return { screen: 'amount-action', amount: data.amount }
    case 'lnurl-withdraw':
      return { screen: 'unsupported', type: 'lnurl-withdraw' }
  }
}
