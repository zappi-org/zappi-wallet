/**
 * Lightning Receipt Cursor — tracks the last sync point for npubcash paid quotes.
 *
 * Much simpler than GiftwrapCursor: single server, no per-relay EOSE tracking,
 * no deep-resync. The cursor is purely for efficiency (shrinking HTTP payload).
 *
 * Overlap: 5 minutes — conservative clock-skew buffer between server and client.
 * Giftwrap needs 54h (NIP-59 2-day randomization + 6h clock skew); Lightning
 * address receipts have no such randomization.
 */

export const LIGHTNING_RECEIPT_OVERLAP_MS = 5 * 60 * 1000

export interface LightningReceiptCursor {
  key: string
  lastSyncAtMs: number
}

export function lightningReceiptCursorKey(pubkeyHex: string): string {
  return `npubcash:lightning-receipt:${pubkeyHex.slice(0, 8)}`
}

export function lightningReceiptSince(record: LightningReceiptCursor | null): number | undefined {
  if (!record || record.lastSyncAtMs <= 0) return undefined
  return Math.max(0, record.lastSyncAtMs - LIGHTNING_RECEIPT_OVERLAP_MS)
}
