/**
 * BIP-177: Returns ₿ symbol for satoshi unit (prefix)
 */
export function satUnit(_amount?: number): string {
  return '₿'
}

/**
 * Formats amount with ₿ prefix (BIP-177)
 * e.g., "₿ 1,000"
 */
export function formatSats(amount: number): string {
  return `₿ ${amount.toLocaleString()}`
}
