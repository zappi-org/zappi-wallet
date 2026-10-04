/**
 * Mostro marketplace domain types (SDK-free).
 *
 * The adapter maps `mostro-ts-client` types into these; core/UI never see
 * protocol or SDK types.
 */

export type MostroOrderKind = 'buy' | 'sell'

export type MostroMarketStatus = 'idle' | 'connecting' | 'ready' | 'error'

export interface MostroOrder {
  id: string
  kind: MostroOrderKind | null
  status: string | null
  amount: number
  fiatCode: string
  fiatAmount: number
  minAmount: number | null
  maxAmount: number | null
  paymentMethod: string
  premium: number
  createdAt: number | null
  expiresAt: number | null
}

export interface MostroTradeState {
  orderId: string
  status: string | null
  action: string | null
  disputeId: string | null
}

export type MostroUnavailableReason = 'not_configured' | 'invalid_config'

export interface MostroAvailability {
  available: boolean
  reason?: MostroUnavailableReason
}

export interface MostroSnapshot {
  status: MostroMarketStatus
  availability: MostroAvailability
  orders: MostroOrder[]
  trades: Record<string, MostroTradeState>
}

export interface CreateMostroOrderInput {
  kind: MostroOrderKind
  fiatAmount: number
  fiatCode?: string
  amount?: number
  paymentMethod: string
  minAmount?: number
  maxAmount?: number
  expirationDays?: number
  premium?: number
}

export interface MostroCreatedOrder {
  orderId: string
  status: string | null
  next: MostroNextStep
}

export interface TakeMostroOrderInput {
  orderId: string
  invoice?: string
  amount?: number
}

/**
 * The next external step after createOrder/takeOrder, mirroring the SDK's
 * `NextStep` without importing it. Discriminate on `type`.
 */
export type MostroNextStep =
  | { type: 'none' }
  | { type: 'pay-bond'; role: 'maker' | 'taker'; invoice: string; amount: number | null }
  | { type: 'pay-hold-invoice'; invoice: string; amount: number | null }
  | { type: 'add-invoice'; amount: number | null }

export interface MostroTakeOrderResult {
  orderId: string
  status: string | null
  next: MostroNextStep
}

/** Trade actions a party sends to advance/cancel an active order. */
export type MostroTradeAction = 'fiat-sent' | 'release'

export interface MostroMarketListener {
  onSnapshot?(snapshot: MostroSnapshot): void
}
