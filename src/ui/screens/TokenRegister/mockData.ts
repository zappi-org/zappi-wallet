import type { MintCardVariant } from '@/ui/components/wallet/MintCard'

export interface MockRegisterMint {
  name: string
  subName?: string
  logo: string
  variant: MintCardVariant
}

export const MOCK_TRUSTED_MINT: MockRegisterMint = {
  name: '민트 3',
  subName: 'Lemonfizz Mint',
  logo: '🟢',
  variant: 'teal',
}

export const MOCK_UNTRUSTED_MINT: MockRegisterMint = {
  name: 'LNserver Mint',
  logo: '⚠️',
  variant: 'slate',
}

export const MOCK_REGISTER_AMOUNT = 2000
export const MOCK_REGISTER_MEMO = '커피값 보냅니다~'
export const MOCK_REGISTER_FEE = 2
export const MOCK_REGISTER_BALANCE = 46789
export const MOCK_FIAT_RATE_USD = 0.001

export function mockSatsToUsd(sats: number): number {
  return sats * MOCK_FIAT_RATE_USD
}
