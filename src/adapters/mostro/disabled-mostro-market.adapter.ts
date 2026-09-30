import type { MostroMarket } from '@/core/ports/driven/mostro-market.port'
import type {
  CreateMostroOrderInput,
  MostroCreatedOrder,
  MostroMarketListener,
  MostroSnapshot,
  MostroTakeOrderResult,
  MostroTradeAction,
  MostroUnavailableReason,
  TakeMostroOrderInput,
} from '@/core/domain/mostro'

/**
 * DisabledMostroMarket — fallback when the Mostro instance is not configured.
 *
 * Mirrors DisabledCustomerSupportChannel: reads return an unavailable snapshot,
 * mutating actions throw.
 */
export class DisabledMostroMarket implements MostroMarket {
  private readonly snapshot: MostroSnapshot

  constructor(reason: MostroUnavailableReason = 'not_configured') {
    this.snapshot = {
      status: 'idle',
      availability: { available: false, reason },
      orders: [],
      trades: {},
    }
  }

  getSnapshot(): MostroSnapshot {
    return this.snapshot
  }

  async connect(): Promise<MostroSnapshot> {
    return this.snapshot
  }

  async disconnect(): Promise<void> {}

  async destroy(): Promise<void> {}

  async createOrder(_input: CreateMostroOrderInput): Promise<MostroCreatedOrder> {
    throw new Error('Mostro marketplace is not configured')
  }

  async takeOrder(_input: TakeMostroOrderInput): Promise<MostroTakeOrderResult> {
    throw new Error('Mostro marketplace is not configured')
  }

  async submitInvoice(_orderId: string, _invoice: string): Promise<void> {
    throw new Error('Mostro marketplace is not configured')
  }

  async waitForOrderLive(_orderId: string, _timeoutMs?: number): Promise<void> {
    throw new Error('Mostro marketplace is not configured')
  }

  async sendTradeAction(_orderId: string, _action: MostroTradeAction): Promise<void> {
    throw new Error('Mostro marketplace is not configured')
  }

  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error('Mostro marketplace is not configured')
  }

  async openDispute(_orderId: string): Promise<string> {
    throw new Error('Mostro marketplace is not configured')
  }

  async rateUser(_orderId: string, _rating: number): Promise<void> {
    throw new Error('Mostro marketplace is not configured')
  }

  async restore(): Promise<void> {}

  subscribe(listener: MostroMarketListener): () => void {
    listener.onSnapshot?.(this.snapshot)
    return () => {}
  }
}
