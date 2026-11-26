import { Address, OutScript, Transaction } from '@scure/btc-signer'
import { pubECDSA, signECDSA } from '@scure/btc-signer/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { payoutSweepVsizeForScriptLength, validatePayoutSweep } from '@/core/domain/onchain-payout'
import { isErr } from '@/core/domain/result'
import { parsePayoutScript } from './payout-script'
import { payoutNetworkParams, type PayoutNetwork } from './network'

const TX_VERSION = 2
const TX_LOCKTIME = 0
const INPUT_SEQUENCE = 1
const SIGHASH_ALL = 1
const SECRET_LENGTH = 32

export interface BuildSweepTxParams {
  fundingTxId: string
  fundingVout: number
  fundingValue: number
  script: Uint8Array
  secret: Uint8Array
  claimSecretKey: Uint8Array
  destination: string
  fee: number
  maxFee: number
  fundingConfirmations: number
  network: PayoutNetwork
}

export interface BuiltSweepTx {
  hex: string
  txid: string
  vsize: number
}

export function estimateSweepVsize(destination: string, network: PayoutNetwork): number {
  const script = OutScript.encode(Address(payoutNetworkParams(network)).decode(destination))
  return payoutSweepVsizeForScriptLength(script.length)
}

function encodeUint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function encodeUint64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true)
  return bytes
}

function encodeVarInt(value: number): Uint8Array {
  if (value < 0xfd) return new Uint8Array([value])
  if (value <= 0xffff) {
    const bytes = new Uint8Array(3)
    bytes[0] = 0xfd
    new DataView(bytes.buffer).setUint16(1, value, true)
    return bytes
  }
  const bytes = new Uint8Array(5)
  bytes[0] = 0xfe
  new DataView(bytes.buffer).setUint32(1, value, true)
  return bytes
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function doubleSha256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes))
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function buildSweepTx(params: BuildSweepTxParams): BuiltSweepTx {
  const {
    fundingTxId,
    fundingVout,
    fundingValue,
    script,
    secret,
    claimSecretKey,
    destination,
    fee,
    maxFee,
    fundingConfirmations,
    network,
  } = params

  const validation = validatePayoutSweep({
    inputValue: fundingValue,
    outputs: [{ address: destination, value: fundingValue - fee }],
    fee,
    maxFee,
    destination,
    fundingConfirmations,
  })
  if (isErr(validation)) throw new Error(validation.error)

  if (secret.length !== SECRET_LENGTH) {
    throw new Error(`secret must be ${SECRET_LENGTH} bytes`)
  }
  const parsed = parsePayoutScript(script)
  if (!parsed) throw new Error('script is not a payout script')
  const hash160 = ripemd160(sha256(secret))
  if (!equalBytes(hash160, parsed.hash160)) {
    throw new Error('secret does not match the payout script')
  }
  if (!equalBytes(pubECDSA(claimSecretKey), parsed.claimPubkey)) {
    throw new Error('claim key does not match the payout script')
  }

  const destinationScript = OutScript.encode(
    Address(payoutNetworkParams(network)).decode(destination),
  )
  const previousOutput = concatBytes(hexToBytes(fundingTxId).reverse(), encodeUint32(fundingVout))
  const sequence = encodeUint32(INPUT_SEQUENCE)
  const output = concatBytes(
    encodeUint64(fundingValue - fee),
    encodeVarInt(destinationScript.length),
    destinationScript,
  )

  const preimage = concatBytes(
    encodeUint32(TX_VERSION),
    doubleSha256(previousOutput),
    doubleSha256(sequence),
    previousOutput,
    encodeVarInt(script.length),
    script,
    encodeUint64(fundingValue),
    sequence,
    doubleSha256(output),
    encodeUint32(TX_LOCKTIME),
    encodeUint32(SIGHASH_ALL),
  )

  const signature = concatBytes(
    signECDSA(doubleSha256(preimage), claimSecretKey, true),
    new Uint8Array([SIGHASH_ALL]),
  )

  const tx = new Transaction({ version: TX_VERSION, lockTime: TX_LOCKTIME, allowUnknownInputs: true })
  tx.addOutput({ script: destinationScript, amount: BigInt(fundingValue - fee) })
  tx.addInput({
    txid: hexToBytes(fundingTxId),
    index: fundingVout,
    sequence: INPUT_SEQUENCE,
    witnessUtxo: { amount: BigInt(fundingValue), script: OutScript.encode({ type: 'wsh', hash: sha256(script) }) },
    finalScriptWitness: [signature, secret, script],
  })

  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize }
}
