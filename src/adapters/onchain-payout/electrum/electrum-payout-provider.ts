import { Transaction } from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  decidePayoutSweep,
  PAYOUT_MIN_OUTPUT_VALUE,
  payoutReceiveAmount,
  payoutSweepFee,
  type PayoutSweepInput,
} from '@/core/domain/onchain-payout'
import type { JsonValue } from '@/core/domain/json'
import {
  OnchainPayoutAmountOutOfRangeError,
  OnchainPayoutInvalidDestinationError,
  OnchainPayoutProviderRejectedError,
  OnchainPayoutQuoteExpiredError,
  OnchainPayoutUnavailableError,
} from '@/core/errors/onchain-payout'
import type {
  OnchainPayoutAdvance,
  OnchainPayoutProvider,
  OnchainPayoutProgress,
  OnchainPayoutQuote,
  OnchainPayoutStartResult,
} from '@/core/ports/driven/onchain-payout-provider.port'
import type { OnchainPayoutStage } from '@/core/domain/onchain-payout'
import type { PayoutChain, ChainOutspend, ChainOutput } from './chain-client'
import {
  offerLimits,
  rankOffers,
  fetchOffers,
  POW_TARGET_BITS,
  type PayoutOffer,
} from './offers'
import type { PayoutRelayClient } from './relay-client'
import { DEFAULT_PAYOUT_RELAYS } from './relay-client'
import type { PayoutNetwork } from './network'
import { requestPayout } from './payout-request'
import { buildSweepTx, estimateSweepVsize } from './sweep-tx'
import { validatePayoutResponse } from './validate-response'

const VERSION = 1
const SECRET_LENGTH = 32
const BLOCK_INTERVAL_MS = 600_000
const QUOTE_TTL_MS = 60_000
const OFFER_CACHE_MS = 60_000
const OFFER_WAIT_MS = 6_000
const REQUEST_TIMEOUT_MS = 30_000
const SWEEP_TARGET_BLOCKS = 2
const FEE_BUMP_RATIO = 1.25

export interface ElectrumPayoutProviderOptions {
  network: PayoutNetwork
  relayClient: PayoutRelayClient
  chain: PayoutChain
  relays?: string[]
  appLimits: { minAmount: number; maxAmount: number }
  now?: () => number
  randomBytes?: (length: number) => Uint8Array
  quoteTtlMs?: number
  offerCacheMs?: number
  offerWaitMs?: number
  requestTimeoutMs?: number
  sweepTargetBlocks?: number
  powTargetBits?: number
}

interface QuoteOfferRef {
  pubkey: string
  feePercent: number
  networkFee: number
  relays: string[]
  feeRate: number
  sweepVsize: number
}

interface ProviderRefData {
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

interface SweepRecord {
  txid: string
  hex: string
  fee: number
  feeRate: number
  createdAtHeight: number
  replaces?: string
}

interface SecretsData {
  v: number
  secret: string
  claimKey: string
  sweeps: SweepRecord[]
}

function toJsonValue(value: unknown): JsonValue {
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

function parseProviderRef(value: unknown): ProviderRefData {
  if (!isRecord(value) || readNumber(value, 'v') !== VERSION) {
    throw new Error('payout reference has an unknown version')
  }
  return {
    v: VERSION,
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

function parseSecrets(secrets: string): SecretsData {
  let parsed: unknown
  try {
    parsed = JSON.parse(secrets)
  } catch {
    throw new Error('payout secrets are not valid json')
  }
  if (!isRecord(parsed) || readNumber(parsed, 'v') !== VERSION) {
    throw new Error('payout secrets have an unknown version')
  }
  const sweeps = parsed.sweeps
  if (!Array.isArray(sweeps)) throw new Error('payout secrets are missing sweeps')
  return {
    v: VERSION,
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

function parseQuoteOfferRef(value: JsonValue): QuoteOfferRef {
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

function chooseFundingOutput(outputs: ChainOutput[], expectedAmount: number): ChainOutput | null {
  if (outputs.length === 0) return null
  const qualifying = outputs.filter((output) => output.value >= expectedAmount)
  const confirmed = qualifying
    .filter((output) => output.confirmedHeight !== null)
    .sort((a, b) => (a.confirmedHeight ?? 0) - (b.confirmedHeight ?? 0))
  if (confirmed.length > 0) return confirmed[0]
  if (qualifying.length > 0) return qualifying[0]
  return [...outputs].sort((a, b) => b.value - a.value)[0]
}

interface ParsedInput {
  txid: string
  index: number
  witness: Uint8Array[]
}

function parseInputs(hex: string): ParsedInput[] {
  const tx = Transaction.fromRaw(hexToBytes(hex), { allowUnknownOutputs: true })
  const inputs: ParsedInput[] = []
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i)
    if (!input.txid) continue
    inputs.push({
      txid: bytesToHex(input.txid),
      index: input.index ?? 0,
      witness: [...(input.finalScriptWitness ?? [])],
    })
  }
  return inputs
}

function spendsFunding(hex: string, funding: ChainOutput): boolean {
  try {
    return parseInputs(hex).some(
      (input) => input.txid === funding.txid && input.index === funding.vout,
    )
  } catch {
    return false
  }
}

function progressOf(
  stage: OnchainPayoutStage,
  tip: number,
  patch: Partial<OnchainPayoutProgress> = {},
): OnchainPayoutProgress {
  return { stage, currentHeight: tip, ...patch }
}

export class ElectrumPayoutProvider implements OnchainPayoutProvider {
  readonly id = 'electrum'

  private readonly network: PayoutNetwork
  private readonly relayClient: PayoutRelayClient
  private readonly chain: PayoutChain
  private readonly relays: string[]
  private readonly appLimits: { minAmount: number; maxAmount: number }
  private readonly now: () => number
  private readonly randomBytes: (length: number) => Uint8Array
  private readonly quoteTtlMs: number
  private readonly offerCacheMs: number
  private readonly offerWaitMs: number
  private readonly requestTimeoutMs: number
  private readonly sweepTargetBlocks: number
  private readonly powTargetBits: number

  private cachedOffers: { fetchedAt: number; offers: PayoutOffer[] } | null = null

  private offerLimitsInput(): { appMinAmount: number; appMaxAmount: number } {
    return { appMinAmount: this.appLimits.minAmount, appMaxAmount: this.appLimits.maxAmount }
  }

  constructor(options: ElectrumPayoutProviderOptions) {
    this.network = options.network
    this.relayClient = options.relayClient
    this.chain = options.chain
    this.relays = options.relays ?? DEFAULT_PAYOUT_RELAYS
    this.appLimits = options.appLimits
    this.now = options.now ?? (() => Date.now())
    this.randomBytes =
      options.randomBytes ?? ((length) => crypto.getRandomValues(new Uint8Array(length)))
    this.quoteTtlMs = options.quoteTtlMs ?? QUOTE_TTL_MS
    this.offerCacheMs = options.offerCacheMs ?? OFFER_CACHE_MS
    this.offerWaitMs = options.offerWaitMs ?? OFFER_WAIT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.sweepTargetBlocks = options.sweepTargetBlocks ?? SWEEP_TARGET_BLOCKS
    this.powTargetBits = options.powTargetBits ?? POW_TARGET_BITS
  }

  private nowMs(): number {
    return this.now()
  }

  private nowSeconds(): number {
    return Math.floor(this.now() / 1000)
  }

  private destinationVsize(destination: string): number {
    try {
      return estimateSweepVsize(destination, this.network)
    } catch {
      throw new OnchainPayoutInvalidDestinationError('destination is not valid for this network')
    }
  }

  private async offers(): Promise<PayoutOffer[]> {
    const fetchedAt = this.nowMs()
    if (this.cachedOffers && fetchedAt - this.cachedOffers.fetchedAt < this.offerCacheMs) {
      return this.cachedOffers.offers
    }
    const offers = await fetchOffers(this.relayClient, {
      network: this.network,
      relays: this.relays,
      now: this.nowSeconds(),
      maxWaitMs: this.offerWaitMs,
      powTarget: this.powTargetBits,
    })
    this.cachedOffers = { fetchedAt, offers }
    return offers
  }

  async quote(params: {
    sendAmount: number
    destination: string
  }): Promise<OnchainPayoutQuote> {
    const { sendAmount, destination } = params
    this.destinationVsize(destination)
    const offers = await this.offers()
    if (offers.length === 0) {
      throw new OnchainPayoutUnavailableError('no payout provider is available')
    }
    const feeRate = await this.chain.feeRate(this.sweepTargetBlocks)
    const ranked = rankOffers(offers, sendAmount, this.offerLimitsInput(), feeRate)
    const overallLimits = offerLimits(offers, this.offerLimitsInput())
    const offer = ranked[0]
    if (!offer) {
      throw new OnchainPayoutAmountOutOfRangeError(
        'amount is outside the supported payout range',
        overallLimits.minAmount,
        overallLimits.maxAmount,
      )
    }
    const sweepVsize = estimateSweepVsize(destination, this.network)
    const sweepFee = payoutSweepFee(feeRate, sweepVsize)
    const grossOnchain = payoutReceiveAmount({
      sendAmount,
      feePercent: offer.feePercent,
      networkFee: offer.networkFee,
    })
    const receiveAmount = grossOnchain - sweepFee
    if (receiveAmount < PAYOUT_MIN_OUTPUT_VALUE) {
      throw new OnchainPayoutAmountOutOfRangeError(
        'amount is outside the supported payout range',
        overallLimits.minAmount,
        overallLimits.maxAmount,
      )
    }
    return {
      providerId: this.id,
      destination,
      sendAmount,
      receiveAmount,
      serviceFee: sendAmount - grossOnchain - offer.networkFee,
      networkFee: offer.networkFee,
      sweepFee,
      limits: overallLimits,
      estimatedMinutes: this.network === 'regtest' ? 1 : 30,
      offerRef: toJsonValue({
        pubkey: offer.pubkey,
        feePercent: offer.feePercent,
        networkFee: offer.networkFee,
        relays: offer.relays,
        feeRate,
        sweepVsize,
      }),
      expiresAt: this.nowMs() + this.quoteTtlMs,
    }
  }

  async start(params: { quote: OnchainPayoutQuote }): Promise<OnchainPayoutStartResult> {
    const { quote } = params
    if (quote.expiresAt < this.nowMs()) {
      throw new OnchainPayoutQuoteExpiredError('payout quote has expired')
    }
    this.destinationVsize(quote.destination)
    const offer = parseQuoteOfferRef(quote.offerRef)

    const secret = this.randomBytes(SECRET_LENGTH)
    const claimKey = this.drawClaimKey()
    const paymentHash = bytesToHex(sha256(secret))
    const claimPubkey = bytesToHex(pubECDSA(claimKey))
    const expectedOnchainAmount = payoutReceiveAmount({
      sendAmount: quote.sendAmount,
      feePercent: offer.feePercent,
      networkFee: offer.networkFee,
    })

    try {
      const tip = await this.chain.tipHeight()
      const response = await requestPayout({
        client: this.relayClient,
        offer: {
          pubkey: offer.pubkey,
          feePercent: offer.feePercent,
          networkFee: offer.networkFee,
          minAmount: 0,
          maxForwardAmount: Number.MAX_SAFE_INTEGER,
          maxReverseAmount: Number.MAX_SAFE_INTEGER,
          relays: offer.relays,
          powBits: 0,
          createdAt: this.nowSeconds(),
        },
        relays: this.relays,
        invoiceAmount: quote.sendAmount,
        paymentHash,
        claimPubkey,
        timeoutMs: this.requestTimeoutMs,
        now: this.nowSeconds(),
      })
      const validated = validatePayoutResponse(response, {
        paymentHash,
        claimPubkey,
        invoiceAmount: quote.sendAmount,
        expectedOnchainAmount,
        maxUpfrontAmount: 2 * offer.networkFee,
        feeRateSatPerVb: offer.feeRate,
        currentHeight: tip,
        now: this.nowSeconds(),
        network: this.network,
      })
      if (!validated.ok) {
        throw new OnchainPayoutProviderRejectedError(validated.error)
      }
      const payout = validated.value
      const paymentRequests = [
        ...(payout.upfrontRequest ? [payout.upfrontRequest] : []),
        payout.mainRequest,
      ]
      const providerRef: ProviderRefData = {
        v: VERSION,
        network: this.network,
        serverPubkey: offer.pubkey,
        serverId: payout.serverId,
        destination: quote.destination,
        lockupAddress: payout.lockupAddress,
        redeemScriptHex: payout.redeemScriptHex,
        locktime: payout.locktime,
        onchainAmount: payout.onchainAmount,
        paymentHash,
        sweepVsize: offer.sweepVsize,
        maxSweepFee: Math.floor(payout.onchainAmount / 10),
      }
      const secrets: SecretsData = {
        v: VERSION,
        secret: bytesToHex(secret),
        claimKey: bytesToHex(claimKey),
        sweeps: [],
      }
      return {
        providerRef: toJsonValue(providerRef),
        secrets: JSON.stringify(secrets),
        paymentRequests: paymentRequests.map((request) => ({
          request: request.request,
          amount: request.amount,
        })),
        sendAmount: quote.sendAmount,
        receiveAmount: payout.onchainAmount - quote.sweepFee,
        deadline: {
          blockHeight: payout.locktime,
          estimatedAt: this.nowMs() + (payout.locktime - tip) * BLOCK_INTERVAL_MS,
        },
      }
    } catch (error) {
      if (error instanceof OnchainPayoutProviderRejectedError) throw error
      const message = error instanceof Error ? error.message : 'payout provider failed'
      throw new OnchainPayoutProviderRejectedError(message, error)
    }
  }

  private drawClaimKey(): Uint8Array {
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = this.randomBytes(SECRET_LENGTH)
      try {
        pubECDSA(candidate)
        return candidate
      } catch {
        continue
      }
    }
    throw new OnchainPayoutProviderRejectedError('could not draw a claim key')
  }

  private async spenderRevealsPaymentHash(
    spenderTxId: string,
    funding: ChainOutput,
    paymentHash: string,
  ): Promise<boolean> {
    let hex: string
    try {
      hex = await this.chain.txHex(spenderTxId)
    } catch {
      return false
    }
    let inputs: ParsedInput[]
    try {
      inputs = parseInputs(hex)
    } catch {
      return false
    }
    const input = inputs.find(
      (candidate) => candidate.txid === funding.txid && candidate.index === funding.vout,
    )
    if (!input) return false
    return input.witness.some(
      (item) => item.length === 32 && bytesToHex(sha256(item)) === paymentHash,
    )
  }

  private async fundingState(ref: ProviderRefData): Promise<{
    tip: number
    funding: ChainOutput | null
    outspend: ChainOutspend | null
  }> {
    const tip = await this.chain.tipHeight()
    const outputs = await this.chain.findOutputs(ref.lockupAddress)
    const funding = chooseFundingOutput(outputs, ref.onchainAmount)
    if (!funding) return { tip, funding: null, outspend: null }
    return { tip, funding, outspend: await this.chain.outspend(funding.txid, funding.vout) }
  }

  private buildSweep(
    ref: ProviderRefData,
    secrets: SecretsData,
    funding: ChainOutput,
    fee: number,
    maxFee: number,
    feeRate: number,
    tip: number,
    fundingConfirmations: number,
    replaces?: string,
  ): SweepRecord {
    const built = buildSweepTx({
      fundingTxId: funding.txid,
      fundingVout: funding.vout,
      fundingValue: funding.value,
      script: hexToBytes(ref.redeemScriptHex),
      secret: hexToBytes(secrets.secret),
      claimSecretKey: hexToBytes(secrets.claimKey),
      destination: ref.destination,
      fee,
      maxFee,
      fundingConfirmations,
      network: ref.network,
    })
    return {
      txid: built.txid,
      hex: built.hex,
      fee,
      feeRate,
      createdAtHeight: tip,
      ...(replaces ? { replaces } : {}),
    }
  }

  private preparedAdvance(
    tip: number,
    secrets: SecretsData,
    sweep: SweepRecord,
  ): OnchainPayoutAdvance {
    return {
      progress: progressOf('sweeping', tip, { payoutTxId: sweep.txid }),
      prepared: {
        secrets: JSON.stringify({ ...secrets, sweeps: [...secrets.sweeps, sweep] }),
        payoutTxId: sweep.txid,
      },
    }
  }

  async resume(params: {
    providerRef: JsonValue
    secrets: string
    stage: OnchainPayoutStage
    published: boolean
  }): Promise<OnchainPayoutAdvance> {
    const ref = parseProviderRef(params.providerRef)
    const secrets = parseSecrets(params.secrets)
    const lastSweep = secrets.sweeps[secrets.sweeps.length - 1]

    if (params.stage === 'completed') {
      const tip = await this.chain.tipHeight()
      const confirmations = lastSweep
        ? await this.chain.txConfirmations(lastSweep.txid)
        : null
      return {
        progress: progressOf('completed', tip, {
          payoutTxId: lastSweep?.txid,
          confirmations: confirmations ?? undefined,
        }),
      }
    }

    const { tip, funding, outspend } = await this.fundingState(ref)
    let spend: PayoutSweepInput['spend'] = null
    let spenderTxId: string | undefined
    if (outspend?.spent && outspend.txid) {
      spenderTxId = outspend.txid
      const bySweep = secrets.sweeps.some((sweep) => sweep.txid === outspend.txid)
      const byUs =
        bySweep ||
        (funding
          ? await this.spenderRevealsPaymentHash(outspend.txid, funding, ref.paymentHash)
          : false)
      spend = { byUs, confirmed: outspend.confirmedHeight !== null }
    }

    const revealed = params.published || (spend?.byUs ?? false)
    const decision = decidePayoutSweep({
      expectedAmount: ref.onchainAmount,
      locktime: ref.locktime,
      currentHeight: tip,
      output: funding
        ? { value: funding.value, confirmedHeight: funding.confirmedHeight }
        : null,
      spend,
      secretRevealed: revealed,
    })

    if (decision.action === 'done') {
      const confirmations = spenderTxId
        ? await this.chain.txConfirmations(spenderTxId)
        : null
      return {
        progress: progressOf('completed', tip, {
          payoutTxId: spenderTxId,
          confirmations: confirmations ?? undefined,
        }),
      }
    }
    if (decision.action === 'refuse') {
      if (decision.reason === 'spent_by_provider') {
        return { progress: progressOf('refunded', tip, { failureReason: 'spent_by_provider' }) }
      }
      if (decision.reason === 'expired') {
        return { progress: progressOf('aborted', tip, { failureReason: 'expired' }) }
      }
      return { progress: progressOf('funded', tip, { failureReason: decision.reason }) }
    }
    if (decision.action === 'wait') {
      if (decision.reason === 'not_funded') return { progress: progressOf('paying', tip) }
      return { progress: progressOf('funded', tip) }
    }

    const feeRate = await this.chain.feeRate(this.sweepTargetBlocks)
    const rateFee = payoutSweepFee(feeRate, ref.sweepVsize)

    if (decision.action === 'sweep') {
      if (!funding || funding.confirmedHeight === null) {
        return { progress: progressOf('funded', tip) }
      }
      if (
        lastSweep &&
        !params.published &&
        spendsFunding(lastSweep.hex, funding)
      ) {
        return {
          progress: progressOf('sweeping', tip, { payoutTxId: lastSweep.txid }),
          prepared: { secrets: JSON.stringify(secrets), payoutTxId: lastSweep.txid },
        }
      }
      if (rateFee > ref.maxSweepFee) {
        return { progress: progressOf('funded', tip, { failureReason: 'fee_too_high' }) }
      }
      const sweep = this.buildSweep(
        ref,
        secrets,
        funding,
        rateFee,
        ref.maxSweepFee,
        feeRate,
        tip,
        tip - funding.confirmedHeight + 1,
      )
      return this.preparedAdvance(tip, secrets, sweep)
    }

    const ourTxId = spend?.byUs ? spenderTxId : lastSweep?.txid
    if (!funding || !lastSweep) {
      return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
    }
    const revealCap = funding.value - PAYOUT_MIN_OUTPUT_VALUE
    const fundingConfirmations =
      funding.confirmedHeight === null ? 1 : tip - funding.confirmedHeight + 1

    if (spend === null && !spendsFunding(lastSweep.hex, funding)) {
      const minimum = lastSweep.fee + ref.sweepVsize
      const fee = Math.min(Math.max(rateFee, minimum), revealCap)
      if (fee < minimum) {
        return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
      }
      const sweep = this.buildSweep(
        ref,
        secrets,
        funding,
        fee,
        revealCap,
        feeRate,
        tip,
        fundingConfirmations,
      )
      return this.preparedAdvance(tip, secrets, sweep)
    }

    if (spend && !spend.byUs && !spend.confirmed && spenderTxId) {
      let conflict: { fee: number; vsize: number }
      try {
        conflict = await this.chain.txFee(spenderTxId)
      } catch {
        return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
      }
      const minimum = lastSweep.fee + ref.sweepVsize
      const target = Math.max(
        rateFee,
        conflict.fee + ref.sweepVsize,
        Math.ceil((conflict.fee * ref.sweepVsize) / conflict.vsize) + ref.sweepVsize,
      )
      if (lastSweep.replaces === spenderTxId && lastSweep.fee >= target) {
        return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
      }
      const fee = Math.min(target, revealCap)
      if (fee < minimum) {
        return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
      }
      if (fee * conflict.vsize <= conflict.fee * ref.sweepVsize) {
        return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
      }
      const sweep = this.buildSweep(
        ref,
        secrets,
        funding,
        fee,
        revealCap,
        feeRate,
        tip,
        fundingConfirmations,
        spenderTxId,
      )
      return this.preparedAdvance(tip, secrets, sweep)
    }

    if (spend?.confirmed) {
      return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
    }

    const newBlock = tip > lastSweep.createdAtHeight
    const escalating = ref.locktime - tip <= 10 && newBlock
    const risen = feeRate >= FEE_BUMP_RATIO * lastSweep.feeRate && newBlock
    if (!escalating && !risen) {
      return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
    }
    const minimum = lastSweep.fee + ref.sweepVsize
    const target = Math.max(rateFee, Math.ceil(lastSweep.fee * 1.5), minimum)
    const fee = Math.min(target, revealCap)
    if (fee < minimum) {
      return { progress: progressOf('sweeping', tip, { payoutTxId: ourTxId }) }
    }
    const sweep = this.buildSweep(
      ref,
      secrets,
      funding,
      fee,
      revealCap,
      feeRate,
      tip,
      fundingConfirmations,
    )
    return this.preparedAdvance(tip, secrets, sweep)
  }

  async publish(params: { providerRef: JsonValue; secrets: string }): Promise<OnchainPayoutProgress> {
    parseProviderRef(params.providerRef)
    const secrets = parseSecrets(params.secrets)
    const lastSweep = secrets.sweeps[secrets.sweeps.length - 1]
    if (!lastSweep) throw new Error('payout has no signed sweep to publish')
    await this.chain.broadcast(lastSweep.hex)
    return { stage: 'sweeping', payoutTxId: lastSweep.txid }
  }

  async status(params: {
    providerRef: JsonValue
    stage: OnchainPayoutStage
    published: boolean
  }): Promise<OnchainPayoutProgress> {
    const ref = parseProviderRef(params.providerRef)
    const { tip, funding, outspend } = await this.fundingState(ref)
    let spend: PayoutSweepInput['spend'] = null
    if (outspend?.spent && outspend.txid) {
      const byUs = funding
        ? await this.spenderRevealsPaymentHash(outspend.txid, funding, ref.paymentHash)
        : false
      spend = { byUs, confirmed: outspend.confirmedHeight !== null }
    }
    const revealed = params.published || (spend?.byUs ?? false)
    const decision = decidePayoutSweep({
      expectedAmount: ref.onchainAmount,
      locktime: ref.locktime,
      currentHeight: tip,
      output: funding
        ? { value: funding.value, confirmedHeight: funding.confirmedHeight }
        : null,
      spend,
      secretRevealed: revealed,
    })
    if (decision.action === 'done') {
      const confirmations = spend?.byUs ? await this.chain.txConfirmations(outspend?.txid ?? '') : null
      return progressOf('completed', tip, {
        payoutTxId: spend?.byUs ? outspend?.txid : undefined,
        confirmations: confirmations ?? undefined,
      })
    }
    if (decision.action === 'refuse') {
      if (decision.reason === 'spent_by_provider') {
        if (spend?.confirmed) return progressOf('refunded', tip, { failureReason: 'spent_by_provider' })
        return progressOf('funded', tip, { failureReason: 'spent_by_provider' })
      }
      if (decision.reason === 'expired') {
        return progressOf('aborted', tip, { failureReason: 'expired' })
      }
      return progressOf('funded', tip, { failureReason: decision.reason })
    }
    if (decision.action === 'wait') {
      if (decision.reason === 'not_funded') return progressOf('paying', tip)
      return progressOf('funded', tip)
    }
    if (decision.action === 'sweep') {
      return progressOf('funded', tip)
    }
    return progressOf('sweeping', tip)
  }
}
