export interface MockMint {
  name: string
  logo: string
}

export const MOCK_MINT: MockMint = {
  name: '민트 1',
  logo: '🟣',
}

export const MOCK_BALANCE = 46789
export const MOCK_CREATE_FEE = 2
export const MOCK_FIAT_RATE_USD = 0.001

export function mockSatsToUsd(sats: number): number {
  return sats * MOCK_FIAT_RATE_USD
}
