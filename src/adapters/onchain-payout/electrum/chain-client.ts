import { Transaction } from '@scure/btc-signer'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { PayoutNetwork } from './network'

export const DEFAULT_CHAIN_API: Partial<Record<PayoutNetwork, string>> = {
  mainnet: 'https://mempool.space/api',
  testnet: 'https://mempool.space/testnet/api',
  signet: 'https://mempool.space/signet/api',
}

const MAX_ADDRESS_PAGES = 40
const CONFIRMED_PAGE_SIZE = 25
const ALREADY_BROADCAST_PATTERNS = [
  'already in block chain',
  'transaction outputs already in utxo set',
  'txn-already-known',
  'txn-already-in-mempool',
  'transaction already in',
]

export interface ChainOutput {
  txid: string
  vout: number
  value: number
  confirmedHeight: number | null
}

export interface ChainOutspend {
  spent: boolean
  txid?: string
  confirmedHeight: number | null
}

interface EsploraStatus {
  confirmed?: boolean
  block_height?: number
}

interface EsploraTx {
  txid: string
  status?: EsploraStatus
  vout?: {
    n: number
    value: number
    scriptpubkey_address?: string
  }[]
}

function confirmedHeight(status: EsploraStatus | undefined): number | null {
  if (status?.confirmed && typeof status.block_height === 'number') return status.block_height
  return null
}

function transactionId(hex: string): string {
  return Transaction.fromRaw(hexToBytes(hex)).id
}

export class EsploraChainClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: { baseUrl: string; fetch?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`chain request failed: ${response.status}`)
    }
    return response
  }

  async tipHeight(): Promise<number> {
    const response = await this.request('/blocks/tip/height')
    const height = Number((await response.text()).trim())
    if (!Number.isSafeInteger(height) || height < 0) {
      throw new Error('chain returned a malformed tip height')
    }
    return height
  }

  async findOutputs(address: string): Promise<ChainOutput[]> {
    const outputs: ChainOutput[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_ADDRESS_PAGES; page++) {
      const path =
        cursor === null
          ? `/address/${address}/txs`
          : `/address/${address}/txs/chain/${cursor}`
      const response = await this.request(path)
      const transactions = (await response.json()) as EsploraTx[]
      for (const transaction of transactions) {
        for (const output of transaction.vout ?? []) {
          if (output.scriptpubkey_address !== address) continue
          outputs.push({
            txid: transaction.txid,
            vout: output.n,
            value: output.value,
            confirmedHeight: confirmedHeight(transaction.status),
          })
        }
      }
      const confirmed = transactions.filter((transaction) => confirmedHeight(transaction.status) !== null)
      if (confirmed.length < CONFIRMED_PAGE_SIZE) return outputs
      cursor = confirmed[confirmed.length - 1].txid
    }
    throw new Error('address history is too long')
  }

  async outspend(txid: string, vout: number): Promise<ChainOutspend> {
    const response = await this.request(`/tx/${txid}/outspend/${vout}`)
    const body = (await response.json()) as {
      spent?: boolean
      txid?: string
      status?: EsploraStatus
    }
    if (!body.spent) return { spent: false, confirmedHeight: null }
    return {
      spent: true,
      txid: body.txid,
      confirmedHeight: confirmedHeight(body.status),
    }
  }

  async broadcast(hex: string): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/tx`, {
      method: 'POST',
      body: hex,
      headers: { 'content-type': 'text/plain' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
    const text = (await response.text()).trim()
    if (response.ok) return text || transactionId(hex)
    const lowered = text.toLowerCase()
    if (ALREADY_BROADCAST_PATTERNS.some((pattern) => lowered.includes(pattern))) {
      return transactionId(hex)
    }
    throw new Error(`chain rejected the transaction: ${response.status}`)
  }

  async feeRate(targetBlocks = 2): Promise<number> {
    const response = await this.request('/fee-estimates')
    const estimates = (await response.json()) as Record<string, unknown>
    const usable: { target: number; rate: number }[] = []
    for (const [key, value] of Object.entries(estimates)) {
      const target = Number(key)
      if (!Number.isFinite(target) || typeof value !== 'number' || !Number.isFinite(value)) continue
      if (value <= 0) continue
      usable.push({ target, rate: value })
    }
    if (usable.length === 0) throw new Error('chain returned no usable fee estimates')
    const exact = usable.find((entry) => entry.target === targetBlocks)
    const nearestLower = usable
      .filter((entry) => entry.target <= targetBlocks)
      .sort((a, b) => b.target - a.target)[0]
    const smallest = usable.sort((a, b) => a.target - b.target)[0]
    const chosen = exact ?? nearestLower ?? smallest
    return Math.max(1, Math.ceil(chosen.rate))
  }

  async txConfirmations(txid: string): Promise<number | null> {
    const response = await this.request(`/tx/${txid}/status`)
    const status = (await response.json()) as EsploraStatus
    const height = confirmedHeight(status)
    if (height === null) return null
    const tip = await this.tipHeight()
    return Math.max(1, tip - height + 1)
  }
}
