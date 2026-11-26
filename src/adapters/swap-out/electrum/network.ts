import { NETWORK, TEST_NETWORK } from '@scure/btc-signer'

export type PayoutNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest'

export interface PayoutNetworkParams {
  readonly bech32: string
  readonly pubKeyHash: number
  readonly scriptHash: number
  readonly wif: number
}

const REGTEST_NETWORK: PayoutNetworkParams = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
}

const NETWORKS: Record<PayoutNetwork, PayoutNetworkParams> = {
  mainnet: NETWORK,
  testnet: TEST_NETWORK,
  signet: TEST_NETWORK,
  regtest: REGTEST_NETWORK,
}

export function payoutNetworkParams(network: PayoutNetwork): PayoutNetworkParams {
  return NETWORKS[network]
}
