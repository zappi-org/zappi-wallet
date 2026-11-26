import type { JsonValue } from '@/core/domain/json'
import type { PayoutNetwork } from './network'

export const PROVIDER_STATE_VERSION = 1

export interface QuoteOfferRef {
  pubkey: string
  feePercent: number
  networkFee: number
  relays: string[]
  feeRate: number
  sweepVsize: number
}

export interface ProviderRefData {
  v: number
  network: PayoutNetwork
  serverPubkey: string
  serverId: string
  destination: string
  lockupAddress: string
  redeemScriptHex: string
  locktime: number
  onchainAmount: number
  paymentHash: string
  sweepVsize: number
  maxSweepFee: number
}

export interface SweepRecord {
  txid: string
  hex: string
  fee: number
  feeRate: number
  createdAtHeight: number
  replaces?: string
}

export interface SecretsData {
  v: number
  secret: string
  claimKey: string
  sweeps: SweepRecord[]
}

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string') throw new Error(`payout reference is missing ${key}`)
  return value
}

function readNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`payout reference is missing ${key}`)
  }
  return value
}

function readNetwork(value: unknown): PayoutNetwork {
  if (value === 'mainnet' || value === 'testnet' || value === 'signet' || value === 'regtest') {
    return value
  }
  throw new Error('payout reference has an unknown network')
}

export function parseProviderRef(value: unknown): ProviderRefData {
  if (!isRecord(value) || readNumber(value, 'v') !== PROVIDER_STATE_VERSION) {
    throw new Error('payout reference has an unknown version')
  }
  return {
    v: PROVIDER_STATE_VERSION,
    network: readNetwork(value.network),
    serverPubkey: readString(value, 'serverPubkey'),
    serverId: readString(value, 'serverId'),
    destination: readString(value, 'destination'),
    lockupAddress: readString(value, 'lockupAddress'),
    redeemScriptHex: readString(value, 'redeemScriptHex'),
    locktime: readNumber(value, 'locktime'),
    onchainAmount: readNumber(value, 'onchainAmount'),
    paymentHash: readString(value, 'paymentHash'),
    sweepVsize: readNumber(value, 'sweepVsize'),
    maxSweepFee: readNumber(value, 'maxSweepFee'),
  }
}

export function parseSecrets(secrets: string): SecretsData {
  let parsed: unknown
  try {
    parsed = JSON.parse(secrets)
  } catch {
    throw new Error('payout secrets are not valid json')
  }
  if (!isRecord(parsed) || readNumber(parsed, 'v') !== PROVIDER_STATE_VERSION) {
    throw new Error('payout secrets have an unknown version')
  }
  const sweeps = parsed.sweeps
  if (!Array.isArray(sweeps)) throw new Error('payout secrets are missing sweeps')
  return {
    v: PROVIDER_STATE_VERSION,
    secret: readString(parsed, 'secret'),
    claimKey: readString(parsed, 'claimKey'),
    sweeps: sweeps.map((entry) => {
      if (!isRecord(entry)) throw new Error('payout sweep record is malformed')
      return {
        txid: readString(entry, 'txid'),
        hex: readString(entry, 'hex'),
        fee: readNumber(entry, 'fee'),
        feeRate: readNumber(entry, 'feeRate'),
        createdAtHeight: readNumber(entry, 'createdAtHeight'),
        ...(typeof entry.replaces === 'string' ? { replaces: entry.replaces } : {}),
      }
    }),
  }
}

export function parseQuoteOfferRef(value: JsonValue): QuoteOfferRef {
  if (!isRecord(value)) throw new Error('payout quote has no offer reference')
  const relays = value.relays
  if (!Array.isArray(relays) || !relays.every((relay) => typeof relay === 'string')) {
    throw new Error('payout quote offer relays are malformed')
  }
  return {
    pubkey: readString(value, 'pubkey'),
    feePercent: readNumber(value, 'feePercent'),
    networkFee: readNumber(value, 'networkFee'),
    relays: relays as string[],
    feeRate: readNumber(value, 'feeRate'),
    sweepVsize: readNumber(value, 'sweepVsize'),
  }
}
