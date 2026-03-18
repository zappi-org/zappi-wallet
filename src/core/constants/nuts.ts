/**
 * Cashu NUT (Notation, Usage & Terminology) names
 * @see https://github.com/cashubtc/nuts
 */
export const NUT_NAMES: Record<string, string> = {
  '0': 'Cryptography', '1': 'Mint Keys', '2': 'Keysets', '3': 'Swap',
  '4': 'Mint (Lightning)', '5': 'Melt (Lightning)', '6': 'Mint Info',
  '7': 'State Check', '8': 'Fee Return', '9': 'Restore',
  '10': 'Spending Conditions', '11': 'P2PK', '12': 'DLEQ Proofs',
  '13': 'Deterministic Secrets', '14': 'HTLC', '15': 'MPP',
  '17': 'WebSocket', '18': 'Payment Request', '19': 'Cached Responses',
  '20': 'Signature on Quote',
}

export function getNutName(nut: string): string {
  return NUT_NAMES[nut] || `NUT-${nut.padStart(2, '0')}`
}

export function getSupportedNuts(nuts: Record<string, unknown> | undefined): string[] {
  if (!nuts) return []
  return Object.keys(nuts)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => parseInt(a) - parseInt(b))
}
