import { describe, expect, it } from 'vitest'
import { readOnchainPayoutConfig } from '@/composition/onchain-payout-config'

describe('readOnchainPayoutConfig', () => {
  it('is disabled by default', () => {
    const config = readOnchainPayoutConfig({})
    expect(config.enabled).toBe(false)
    expect(config.network).toBe('mainnet')
    expect(config.chainApiUrl).toBeNull()
    expect(config.relays).toBeNull()
    expect(config.minAmount).toBe(20_000)
    expect(config.maxAmount).toBe(1_000_000)
    expect(config.pollIntervalMs).toBe(30_000)
  })

  it('enables on explicit request for a supported network', () => {
    const config = readOnchainPayoutConfig({
      VITE_ONCHAIN_PAYOUT_ENABLED: 'true',
      VITE_ONCHAIN_PAYOUT_NETWORK: 'testnet',
    })
    expect(config.enabled).toBe(true)
    expect(config.network).toBe('testnet')
  })

  it('disables on an unknown network', () => {
    const config = readOnchainPayoutConfig({
      VITE_ONCHAIN_PAYOUT_ENABLED: 'true',
      VITE_ONCHAIN_PAYOUT_NETWORK: 'moonnet',
    })
    expect(config.enabled).toBe(false)
    expect(config.network).toBe('mainnet')
  })

  it('requires a chain API for regtest', () => {
    const missing = readOnchainPayoutConfig({
      VITE_ONCHAIN_PAYOUT_ENABLED: 'true',
      VITE_ONCHAIN_PAYOUT_NETWORK: 'regtest',
    })
    expect(missing.enabled).toBe(false)
    const configured = readOnchainPayoutConfig({
      VITE_ONCHAIN_PAYOUT_ENABLED: 'true',
      VITE_ONCHAIN_PAYOUT_NETWORK: 'regtest',
      VITE_ONCHAIN_PAYOUT_CHAIN_API: 'http://localhost:3003/api',
    })
    expect(configured.enabled).toBe(true)
    expect(configured.chainApiUrl).toBe('http://localhost:3003/api')
  })

  it('parses relay overrides', () => {
    const config = readOnchainPayoutConfig({
      VITE_ONCHAIN_PAYOUT_RELAYS: 'wss://a.example, , wss://b.example ',
    })
    expect(config.relays).toEqual(['wss://a.example', 'wss://b.example'])
    expect(readOnchainPayoutConfig({ VITE_ONCHAIN_PAYOUT_RELAYS: ' , ' }).relays).toBeNull()
  })

  it('clamps the poll interval', () => {
    expect(
      readOnchainPayoutConfig({ VITE_ONCHAIN_PAYOUT_POLL_MS: '500' }).pollIntervalMs,
    ).toBe(2_000)
    expect(
      readOnchainPayoutConfig({ VITE_ONCHAIN_PAYOUT_POLL_MS: '45000' }).pollIntervalMs,
    ).toBe(45_000)
    expect(
      readOnchainPayoutConfig({ VITE_ONCHAIN_PAYOUT_POLL_MS: 'nope' }).pollIntervalMs,
    ).toBe(30_000)
  })
})
