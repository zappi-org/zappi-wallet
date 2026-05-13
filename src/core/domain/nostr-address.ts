/**
 * bech32 디코딩 — NIP-19 (npub, nprofile) + LNURL
 *
 * 외부 의존 없음. BIP-173 bech32 + NIP-19 TLV + LUD-17 스펙 구현.
 * core/domain에 위치하여 어댑터 경유 없이 사용 가능.
 */

// ─── Bech32 ───

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const CHARSET_MAP = new Map<string, number>()
for (let i = 0; i < CHARSET.length; i++) CHARSET_MAP.set(CHARSET[i], i)

const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i]
    }
  }
  return chk
}

function hrpExpand(hrp: string): number[] {
  const result: number[] = []
  for (let i = 0; i < hrp.length; i++) result.push(hrp.charCodeAt(i) >> 5)
  result.push(0)
  for (let i = 0; i < hrp.length; i++) result.push(hrp.charCodeAt(i) & 31)
  return result
}

function bech32Decode(str: string): { hrp: string; data: number[] } {
  const lower = str.toLowerCase()
  const sepIdx = lower.lastIndexOf('1')
  if (sepIdx < 1) throw new Error('Invalid bech32: no separator')

  const hrp = lower.slice(0, sepIdx)
  const dataChars = lower.slice(sepIdx + 1)
  if (dataChars.length < 6) throw new Error('Invalid bech32: too short')

  const data: number[] = []
  for (const c of dataChars) {
    const v = CHARSET_MAP.get(c)
    if (v === undefined) throw new Error(`Invalid bech32 character: ${c}`)
    data.push(v)
  }

  // bech32m uses constant 0x2bc830a3 instead of 1
  const check = polymod([...hrpExpand(hrp), ...data])
  if (check !== 1 && check !== 0x2bc830a3) {
    throw new Error('Invalid bech32 checksum')
  }

  return { hrp, data: data.slice(0, -6) }
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0
  let bits = 0
  const maxV = (1 << toBits) - 1
  const result: number[] = []

  for (const v of data) {
    acc = (acc << fromBits) | v
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push((acc >> bits) & maxV)
    }
  }

  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxV)
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxV) !== 0) {
    throw new Error('Invalid padding')
  }

  return result
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── NIP-19 ───

export function isNostrDirectAddress(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')
}

export function npubDecode(npub: string): string {
  const { hrp, data } = bech32Decode(npub)
  if (hrp !== 'npub') throw new Error(`Expected npub, got ${hrp}`)
  const bytes = convertBits(data, 5, 8, false)
  if (bytes.length !== 32) throw new Error(`Invalid npub: expected 32 bytes, got ${bytes.length}`)
  return bytesToHex(bytes)
}

export function nprofileDecode(nprofile: string): { pubkey: string; relays?: string[] } {
  const { hrp, data } = bech32Decode(nprofile)
  if (hrp !== 'nprofile') throw new Error(`Expected nprofile, got ${hrp}`)
  const bytes = convertBits(data, 5, 8, false)

  let pubkey: string | undefined
  const relays: string[] = []

  let i = 0
  while (i < bytes.length) {
    const type = bytes[i++]
    const len = bytes[i++]
    if (len === undefined) throw new Error('Invalid TLV: unexpected end')
    const value = bytes.slice(i, i + len)
    if (value.length !== len) throw new Error('Invalid TLV: truncated value')
    i += len

    if (type === 0x00) {
      if (value.length !== 32) throw new Error('Invalid TLV: pubkey must be 32 bytes')
      pubkey = bytesToHex(value)
    } else if (type === 0x01) {
      relays.push(new TextDecoder().decode(new Uint8Array(value)))
    }
    // unknown types are silently skipped per NIP-19
  }

  if (!pubkey) throw new Error('Invalid nprofile: missing pubkey')
  return relays.length > 0 ? { pubkey, relays } : { pubkey }
}

// ─── LNURL ───

export function lnurlDecode(lnurl: string): string {
  const { hrp, data } = bech32Decode(lnurl)
  if (hrp !== 'lnurl') throw new Error(`Expected lnurl, got ${hrp}`)
  const bytes = convertBits(data, 5, 8, false)
  return new TextDecoder().decode(new Uint8Array(bytes))
}
