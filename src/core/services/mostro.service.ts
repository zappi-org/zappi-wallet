import type { MostroMarket } from '@/core/ports/driven/mostro-market.port'
import type { MostroUseCase } from '@/core/ports/driving/mostro.usecase'
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
 * MostroService — thin orchestration over the MostroMarket port.
 *
 * Placeholder for cross-port policy (availability gates, status mapping); for
 * now it delegates verbatim.
 */
export class MostroService implements MostroUseCase {
  constructor(private readonly market: MostroMarket) {}

  getSnapshot(): MostroSnapshot {
    return this.market.getSnapshot()
  }

  connect(): Promise<MostroSnapshot> {
    return this.market.connect()
  }

  disconnect(): Promise<void> {
    return this.market.disconnect()
  }

  destroy(): Promise<void> {
    return this.market.destroy()
  }

  createOrder(input: CreateMostroOrderInput): Promise<MostroCreatedOrder> {
    return this.market.createOrder(input)
  }

  takeOrder(input: TakeMostroOrderInput): Promise<MostroTakeOrderResult> {
    return this.market.takeOrder(input)
  }

  submitInvoice(orderId: string, invoice: string): Promise<void> {
    return this.market.submitInvoice(orderId, invoice)
  }

  waitForOrderLive(orderId: string, timeoutMs?: number): Promise<void> {
    return this.market.waitForOrderLive(orderId, timeoutMs)
  }

  sendTradeAction(orderId: string, action: MostroTradeAction): Promise<void> {
    return this.market.sendTradeAction(orderId, action)
  }

  cancelOrder(orderId: string): Promise<void> {
    return this.market.cancelOrder(orderId)
  }

  openDispute(orderId: string): Promise<string> {
    return this.market.openDispute(orderId)
  }

  rateUser(orderId: string, rating: number): Promise<void> {
    return this.market.rateUser(orderId, rating)
  }

  restore(): Promise<void> {
    return this.market.restore()
  }

  subscribe(listener: MostroMarketListener): () => void {
    return this.market.subscribe(listener)
  }
}
