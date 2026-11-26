import { Address, Script, ScriptNum, type ScriptType } from '@scure/btc-signer'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Err, Ok, type Result } from '@/core/domain/result'
import { payoutNetworkParams, type PayoutNetwork } from './network'

export const MIN_LOCKTIME_DELTA = 60
export const MAX_LOCKTIME_DELTA = 100

const MAX_BLOCK_HEIGHT_LOCKTIME = 500_000_000
const SECRET_LENGTH = 32
const HASH160_LENGTH = 20
const PUBKEY_LENGTH = 33

export interface BuildPayoutScriptParams {
  paymentHash: Uint8Array
  claimPubkey: Uint8Array
  refundPubkey: Uint8Array
  locktime: number
}

export interface ParsedPayoutScript {
  hash160: Uint8Array
  claimPubkey: Uint8Array
  refundPubkey: Uint8Array
  locktime: number
}

export function buildPayoutScript(params: BuildPayoutScriptParams): Uint8Array {
  const { paymentHash, claimPubkey, refundPubkey, locktime } = params
  if (paymentHash.length !== SECRET_LENGTH) {
    throw new Error(`paymentHash must be ${SECRET_LENGTH} bytes`)
  }
  if (claimPubkey.length !== PUBKEY_LENGTH || refundPubkey.length !== PUBKEY_LENGTH) {
    throw new Error(`pubkeys must be ${PUBKEY_LENGTH} bytes`)
  }
  if (!Number.isSafeInteger(locktime) || locktime < 0) {
    throw new Error('locktime must be a non-negative integer')
  }
  return Script.encode([
    'SIZE',
    SECRET_LENGTH,
    'EQUAL',
    'IF',
    'HASH160',
    ripemd160(paymentHash),
    'EQUALVERIFY',
    claimPubkey,
    'ELSE',
    'DROP',
    locktime,
    'CHECKLOCKTIMEVERIFY',
    'DROP',
    refundPubkey,
    'ENDIF',
    'CHECKSIG',
  ])
}

function isBytes(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.length === length
}

export function parsePayoutScript(script: Uint8Array): ParsedPayoutScript | null {
  let ops: ScriptType
  try {
    ops = Script.decode(script)
  } catch {
    return null
  }
  if (ops.length !== 16) return null
  const [size, secretLength, equal, ifOp, hash160Op, hash160, equalVerify, claim, elseOp, drop] = ops
  const [locktimeOp, cltv, drop2, refund, endif, checksig] = ops.slice(10)
  if (size !== 'SIZE' || equal !== 'EQUAL' || ifOp !== 'IF') return null
  if (hash160Op !== 'HASH160' || equalVerify !== 'EQUALVERIFY') return null
  if (elseOp !== 'ELSE' || drop !== 'DROP') return null
  if (cltv !== 'CHECKLOCKTIMEVERIFY' || drop2 !== 'DROP') return null
  if (endif !== 'ENDIF' || checksig !== 'CHECKSIG') return null
  if (!isBytes(secretLength, 1) || secretLength[0] !== SECRET_LENGTH) return null
  if (!isBytes(hash160, HASH160_LENGTH)) return null
  if (!isBytes(claim, PUBKEY_LENGTH) || !isBytes(refund, PUBKEY_LENGTH)) return null
  if (!(locktimeOp instanceof Uint8Array)) return null
  let locktime: bigint
  try {
    locktime = ScriptNum(5, true).decode(locktimeOp)
  } catch {
    return null
  }
  if (locktime < 0n || locktime > 0xffffffffn) return null
  return {
    hash160,
    claimPubkey: claim,
    refundPubkey: refund,
    locktime: Number(locktime),
  }
}

export function payoutScriptAddress(script: Uint8Array, network: PayoutNetwork): string {
  return Address(payoutNetworkParams(network)).encode({
    type: 'wsh',
    hash: sha256(script),
  })
}

export interface VerifyServerPayoutScriptParams {
  script: Uint8Array
  expectedPaymentHash: Uint8Array
  expectedClaimPubkey: Uint8Array
  expectedLocktime: number
  expectedAddress: string
  currentHeight: number
  network: PayoutNetwork
}

export function verifyServerPayoutScript(
  params: VerifyServerPayoutScriptParams,
): Result<{ refundPubkey: string }, string> {
  const {
    script,
    expectedPaymentHash,
    expectedClaimPubkey,
    expectedLocktime,
    expectedAddress,
    currentHeight,
    network,
  } = params
  if (expectedLocktime >= MAX_BLOCK_HEIGHT_LOCKTIME) {
    return Err('locktime must be a block height')
  }
  const locktimeDelta = expectedLocktime - currentHeight
  if (locktimeDelta <= MIN_LOCKTIME_DELTA) return Err('locktime is too close')
  if (locktimeDelta > MAX_LOCKTIME_DELTA) return Err('locktime is too far')
  const parsed = parsePayoutScript(script)
  if (!parsed) return Err('payout script does not match the expected template')
  const rebuilt = buildPayoutScript({
    paymentHash: expectedPaymentHash,
    claimPubkey: expectedClaimPubkey,
    refundPubkey: parsed.refundPubkey,
    locktime: expectedLocktime,
  })
  if (rebuilt.length !== script.length) return Err('payout script does not match the expected script')
  for (let i = 0; i < rebuilt.length; i++) {
    if (rebuilt[i] !== script[i]) return Err('payout script does not match the expected script')
  }
  if (payoutScriptAddress(rebuilt, network) !== expectedAddress) {
    return Err('payout address does not match the expected address')
  }
  return Ok({ refundPubkey: bytesToHex(parsed.refundPubkey) })
}
