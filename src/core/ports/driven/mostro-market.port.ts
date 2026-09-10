import type {
  CreateMostroOrderInput,
  MostroCreatedOrder,
  MostroMarketListener,
  MostroSnapshot,
  MostroTakeOrderResult,
  MostroTradeAction,
  TakeMostroOrderInput,
} from '@/core/domain/mostro'

/**
 * MostroMarket — driven port for the Mostro P2P marketplace.
 *
 * Implemented by `MostroClientAdapter` (mostro-ts-client) and the disabled
 * fallback. Protocol-agnostic: no Nostr/SDK types cross this boundary.
 */
export interface MostroMarket {
  getSnapshot(): MostroSnapshot
  connect(): Promise<MostroSnapshot>
  disconnect(): Promise<void>
  destroy(): Promise<void>
  createOrder(input: CreateMostroOrderInput): Promise<MostroCreatedOrder>
  takeOrder(input: TakeMostroOrderInput): Promise<MostroTakeOrderResult>
  submitInvoice(orderId: string, invoice: string): Promise<void>
  /** Resolve once the order is live on Mostro (after paying a maker bond). */
  waitForOrderLive(orderId: string, timeoutMs?: number): Promise<void>
  /** Send FiatSent or Release to advance an active trade. */
  sendTradeAction(orderId: string, action: MostroTradeAction): Promise<void>
  cancelOrder(orderId: string): Promise<void>
  /** Open a dispute; resolves to the dispute id. */
  openDispute(orderId: string): Promise<string>
  /** Rate the counterpart of a completed trade (1..5). */
  rateUser(orderId: string, rating: number): Promise<void>
  /** Recover sessions/orders from the Mostro node after reconnect. */
  restore(): Promise<void>
  subscribe(listener: MostroMarketListener): () => void
}
