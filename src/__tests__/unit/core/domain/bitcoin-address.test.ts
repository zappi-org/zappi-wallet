import { describe, expect, it } from 'vitest'
import {
  bitcoinUriLightningInvoice,
  parseBitcoinPaymentInput,
} from '@/core/domain/bitcoin-address'

const MAINNET_BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'
const TESTNET_BECH32 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
const REGTEST_BECH32 = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'
const MAINNET_P2PKH = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
const MAINNET_P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'
const TESTNET_P2PKH = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'
const TESTNET_P2SH = '2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc'

describe('parseBitcoinPaymentInput', () => {
  it.each([
    MAINNET_BECH32,
    TESTNET_BECH32,
    REGTEST_BECH32,
    MAINNET_P2PKH,
    MAINNET_P2SH,
    TESTNET_P2PKH,
    TESTNET_P2SH,
  ])('accepts %s', (address) => {
    expect(parseBitcoinPaymentInput(address)).toEqual({ address })
  })

  it('parses a BIP21 amount with exact decimals', () => {
    expect(parseBitcoinPaymentInput(`bitcoin:${MAINNET_BECH32}?amount=0.001`)).toEqual({
      address: MAINNET_BECH32,
      amountSats: 100000,
    })
    expect(
      parseBitcoinPaymentInput(`BITCOIN:${MAINNET_BECH32}?amount=1.23456789`),
    ).toEqual({ address: MAINNET_BECH32, amountSats: 123456789 })
  })

  it('rejects over-precise or zero amounts', () => {
    expect(
      parseBitcoinPaymentInput(`bitcoin:${MAINNET_BECH32}?amount=0.000000001`),
    ).toBeNull()
    expect(parseBitcoinPaymentInput(`bitcoin:${MAINNET_BECH32}?amount=0`)).toBeNull()
  })

  it('returns null for a unified URI carrying a lightning invoice', () => {
    const uri = `bitcoin:${MAINNET_BECH32}?lightning=lnbc1invoice&amount=0.001`
    expect(parseBitcoinPaymentInput(uri)).toBeNull()
    expect(bitcoinUriLightningInvoice(uri)).toBe('lnbc1invoice')
  })

  it('rejects garbage and emails', () => {
    expect(parseBitcoinPaymentInput('garbage')).toBeNull()
    expect(parseBitcoinPaymentInput('alice@domain.test')).toBeNull()
    expect(parseBitcoinPaymentInput('')).toBeNull()
  })

  it('does not treat a lightning prefix as an address', () => {
    expect(bitcoinUriLightningInvoice('lightning:lnbc1foo')).toBeNull()
  })
})
