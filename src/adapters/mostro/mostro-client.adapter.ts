import { MostroClient } from 'mostro-ts-client'
import type {
  ClientStoreSink,
  CreateOrderResult,
  NextStep,
  SmallOrder,
  Store,
  TakeOrderResult,
} from 'mostro-ts-client'
import type {
  CreateMostroOrderInput,
  MostroCreatedOrder,
  MostroMarketListener,
  MostroMarketStatus,
  MostroNextStep,
  MostroOrder,
  MostroSnapshot,
  MostroTakeOrderResult,
  MostroTradeAction,
  MostroTradeState,
  TakeMostroOrderInput,
} from '@/core/domain/mostro'
import type { MostroMarket } from '@/core/ports/driven/mostro-market.port'

/**
 * The subset of `MostroClient` this adapter drives. Exists as a seam so unit
 * tests can inject a fake without opening relays or IndexedDB.
 */
export interface MostroClientLike {
  bind(sink: ClientStoreSink): void
  start(): Promise<void>
  stop(): Promise<void>
  fetchOrders(): Promise<SmallOrder[]>
  createOrder(input: {
    kind: 'buy' | 'sell'
    fiatAmount: number
    fiatCode?: string
    amount?: number
    paymentMethod: string
    minAmount?: number
    maxAmount?: number
    expirationDays?: number
    premium?: number
  }): Promise<CreateOrderResult>
  takeOrder(order: SmallOrder, input?: { invoice?: string; amount?: number }): Promise<TakeOrderResult>
  submitInvoice(orderId: string, invoice: string): Promise<'accepted'>
  waitForOrderLive(orderId: string, timeoutMs?: number): Promise<void>
  sendTradeAction(orderId: string, action: 'fiat-sent' | 'release'): Promise<void>
  cancelOrder(orderId: string): Promise<void>
  openDispute(orderId: string): Promise<string>
  rateUser(orderId: string, rating: number): Promise<void>
  restore(): Promise<void>
}

export interface MostroClientAdapterDeps {
  /** BIP-39 seed — the client never receives the mnemonic itself. */
  seed: Uint8Array
  /** Mostro instance pubkey (hex). */
  mostroPubkeyHex: string
  relays: string[]
  store: Store
  /** Test seam; defaults to constructing a real `MostroClient`. */
  createClient?: () => MostroClientLike
}

/**
 * MostroClientAdapter — MostroMarket implementation over `mostro-ts-client`.
 *
 * The only place that imports the SDK. Owns the client lifecycle and mirrors
 * its callbacks into an SDK-free snapshot for the UI.
 */
export class MostroClientAdapter implements MostroMarket {
  private client: MostroClientLike | null = null
  private connected = false
  private rawOrders: SmallOrder[] = []
  private orders: MostroOrder[] = []
  private trades: Record<string, MostroTradeState> = {}
  private status: MostroMarketStatus = 'idle'
  private readonly listeners = new Set<MostroMarketListener>()
  private readonly createClient: () => MostroClientLike

  constructor(private readonly deps: MostroClientAdapterDeps) {
    this.createClient =
      deps.createClient ??
      (() =>
        new MostroClient({
          seed: deps.seed,
          mostroPubkey: deps.mostroPubkeyHex,
          relays: deps.relays,
          store: deps.store,
        }))
  }

  getSnapshot(): MostroSnapshot {
    return {
      status: this.status,
      availability: { available: true },
      orders: this.orders,
      trades: this.trades,
    }
  }

  async connect(): Promise<MostroSnapshot> {
    if (this.connected) return this.getSnapshot()

    this.status = 'connecting'
    this.emit()

    const client = this.client ?? this.createClient()
    this.client = client

    // bind() before start() so the order-book and trade sinks are live.
    client.bind({
      setOrders: (raw) => {
        this.rawOrders = raw
        this.orders = raw.map(mapSmallOrder)
        this.emit()
      },
      upsertTrade: (orderId, row) => {
        const prev = this.trades[orderId]
        this.trades = {
          ...this.trades,
          [orderId]: {
            orderId,
            status: row.status ?? prev?.status ?? null,
            action: row.lastAction ?? prev?.action ?? null,
            disputeId: row.disputeId ?? prev?.disputeId ?? null,
          },
        }
        this.emit()
      },
      setUser: () => {
        this.status = 'ready'
        this.emit()
      },
    })

    try {
      await client.start()
    } catch (error) {
      this.status = 'error'
      this.emit()
      throw error
    }

    this.connected = true
    return this.getSnapshot()
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.stop()
    }
    this.connected = false
    this.status = 'idle'
    this.emit()
  }

  async destroy(): Promise<void> {
    await this.disconnect()
    // Logout path: erase persisted trade secrets, then close.
    await this.deps.store.wipe()
    await this.deps.store.close()
  }

  async createOrder(input: CreateMostroOrderInput): Promise<MostroCreatedOrder> {
    const client = this.requireClient()
    const created = await client.createOrder({
      kind: input.kind,
      fiatAmount: input.fiatAmount,
      fiatCode: input.fiatCode,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
      expirationDays: input.expirationDays,
      premium: input.premium,
    })
    return { orderId: created.orderId, status: created.status, next: mapNextStep(created.next) }
  }

  async takeOrder(input: TakeMostroOrderInput): Promise<MostroTakeOrderResult> {
    const client = this.requireClient()
    const order =
      this.rawOrders.find((candidate) => candidate.id === input.orderId) ??
      (await client.fetchOrders()).find((candidate) => candidate.id === input.orderId)
    if (!order) {
      throw new Error(`Mostro order not found: ${input.orderId}`)
    }

    const result = await client.takeOrder(order, { invoice: input.invoice, amount: input.amount })
    return { orderId: result.orderId, status: result.status, next: mapNextStep(result.next) }
  }

  async submitInvoice(orderId: string, invoice: string): Promise<void> {
    await this.requireClient().submitInvoice(orderId, invoice)
  }

  async waitForOrderLive(orderId: string, timeoutMs?: number): Promise<void> {
    await this.requireClient().waitForOrderLive(orderId, timeoutMs)
  }

  async sendTradeAction(orderId: string, action: MostroTradeAction): Promise<void> {
    await this.requireClient().sendTradeAction(orderId, action)
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.requireClient().cancelOrder(orderId)
  }

  async openDispute(orderId: string): Promise<string> {
    return this.requireClient().openDispute(orderId)
  }

  async rateUser(orderId: string, rating: number): Promise<void> {
    await this.requireClient().rateUser(orderId, rating)
  }

  async restore(): Promise<void> {
    await this.requireClient().restore()
  }

  subscribe(listener: MostroMarketListener): () => void {
    this.listeners.add(listener)
    listener.onSnapshot?.(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private requireClient(): MostroClientLike {
    if (!this.client || !this.connected) {
      throw new Error('Mostro client is not connected')
    }
    return this.client
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener.onSnapshot?.(snapshot)
    }
  }
}

function mapNextStep(next: NextStep): MostroNextStep {
  switch (next.type) {
    case 'none':
      return { type: 'none' }
    case 'pay-bond':
      return { type: 'pay-bond', role: next.role, invoice: next.invoice, amount: next.amount }
    case 'pay-hold-invoice':
      return { type: 'pay-hold-invoice', invoice: next.invoice, amount: next.amount }
    case 'add-invoice':
      return { type: 'add-invoice', amount: next.amount }
  }
}

function mapSmallOrder(order: SmallOrder): MostroOrder {
  return {
    id: order.id ?? '',
    kind: order.kind,
    status: order.status,
    amount: order.amount,
    fiatCode: order.fiat_code,
    fiatAmount: order.fiat_amount,
    minAmount: order.min_amount,
    maxAmount: order.max_amount,
    paymentMethod: order.payment_method,
    premium: order.premium,
    createdAt: order.created_at,
    expiresAt: order.expires_at,
  }
}
