import type { PayoutNetwork } from '@/adapters/swap-out/electrum/network'

export interface SwapOutConfig {
  enabled: boolean
  network: PayoutNetwork
  chainApiUrl: string | null
  relays: string[] | null
  minAmount: number
  maxAmount: number
  pollIntervalMs: number
  powTargetBits: number
}

export interface SwapOutEnv {
  VITE_SWAP_OUT_ENABLED?: string
  VITE_SWAP_OUT_NETWORK?: string
  VITE_SWAP_OUT_CHAIN_API?: string
  VITE_SWAP_OUT_RELAYS?: string
  VITE_SWAP_OUT_POLL_MS?: string
  VITE_SWAP_OUT_POW_BITS?: string
}

const NETWORKS: PayoutNetwork[] = ['mainnet', 'testnet', 'signet', 'regtest']
const DEFAULT_NETWORK: PayoutNetwork = 'mainnet'
const MIN_AMOUNT = 20_000
const MAX_AMOUNT = 1_000_000
const POLL_INTERVAL_MS = 30_000
const MIN_POLL_INTERVAL_MS = 2_000
const DEFAULT_POW_TARGET_BITS = 30

function readNetwork(value: string | undefined): PayoutNetwork | null {
  if (value === undefined || value === '') return DEFAULT_NETWORK
  return NETWORKS.includes(value as PayoutNetwork) ? (value as PayoutNetwork) : null
}

function readRelays(value: string | undefined): string[] | null {
  if (!value) return null
  const relays = value
    .split(',')
    .map((relay) => relay.trim())
    .filter((relay) => relay.length > 0)
  return relays.length > 0 ? relays : null
}

function readPowTargetBits(value: string | undefined, network: PayoutNetwork): number {
  if (network !== 'regtest') return DEFAULT_POW_TARGET_BITS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 256) return DEFAULT_POW_TARGET_BITS
  return parsed
}

function readPollInterval(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return POLL_INTERVAL_MS
  return Math.max(MIN_POLL_INTERVAL_MS, Math.floor(parsed))
}

export function readSwapOutConfig(
  env: SwapOutEnv = import.meta.env,
): SwapOutConfig {
  const network = readNetwork(env.VITE_SWAP_OUT_NETWORK)
  const chainApiUrl = env.VITE_SWAP_OUT_CHAIN_API?.trim() || null
  const requested = env.VITE_SWAP_OUT_ENABLED === 'true'
  const enabled = requested && network !== null && (network !== 'regtest' || chainApiUrl !== null)
  return {
    enabled,
    network: network ?? DEFAULT_NETWORK,
    chainApiUrl,
    relays: readRelays(env.VITE_SWAP_OUT_RELAYS),
    minAmount: MIN_AMOUNT,
    maxAmount: MAX_AMOUNT,
    pollIntervalMs: readPollInterval(env.VITE_SWAP_OUT_POLL_MS),
    powTargetBits: readPowTargetBits(
      env.VITE_SWAP_OUT_POW_BITS,
      network ?? DEFAULT_NETWORK,
    ),
  }
}
