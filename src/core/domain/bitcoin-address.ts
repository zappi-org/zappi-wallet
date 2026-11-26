const BECH32_ADDRESS = /^(bc|tb|bcrt)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/i
const BASE58_ADDRESS = /^[13mn2][1-9A-HJ-NP-Za-km-z]{25,39}$/

const SATS_PER_BTC = 100_000_000n

export interface BitcoinPaymentInput {
  address: string
  amountSats?: number
}

function btcStringToSats(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim())
  if (!match) return null
  const fraction = (match[2] ?? '').padEnd(8, '0')
  const sats = BigInt(match[1]) * SATS_PER_BTC + BigInt(fraction || '0')
  if (sats <= 0n || sats > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(sats)
}

export function isBitcoinAddressShape(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  return BECH32_ADDRESS.test(trimmed) || BASE58_ADDRESS.test(trimmed)
}

export function parseBitcoinPaymentInput(raw: string): BitcoinPaymentInput | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  if (!/^bitcoin:/i.test(trimmed)) {
    if (!isBitcoinAddressShape(trimmed)) return null
    return { address: trimmed }
  }

  const body = trimmed.slice(trimmed.indexOf(':') + 1)
  const queryIndex = body.indexOf('?')
  const rawAddress = queryIndex === -1 ? body : body.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : body.slice(queryIndex + 1)

  let address: string
  try {
    address = decodeURIComponent(rawAddress).trim()
  } catch {
    return null
  }
  if (!isBitcoinAddressShape(address)) return null

  const params = new URLSearchParams(query)
  if (params.get('lightning')) return null

  const amount = params.get('amount')
  if (amount === null) return { address }

  const amountSats = btcStringToSats(amount)
  if (amountSats === null) return null
  return { address, amountSats }
}

export function bitcoinUriLightningInvoice(raw: string): string | null {
  const trimmed = raw.trim()
  if (!/^bitcoin:/i.test(trimmed)) return null
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex === -1) return null
  const lightning = new URLSearchParams(trimmed.slice(queryIndex + 1)).get('lightning')
  if (!lightning) return null
  return /^ln(bc|tb|tbs)1/i.test(lightning) ? lightning : null
}
