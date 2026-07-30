import type { TranslationKey } from '@/i18n'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType } from '@/core/domain/transaction'

export type TxStateTone = 'done' | 'current' | 'todo' | 'void' | 'fail'

export interface TxStateNode {
  labelKey: TranslationKey
  tone: TxStateTone
  /** Timestamp shown under the node — undefined renders as "—". */
  at?: number
}

export interface TxStateTrack {
  nodes: TxStateNode[]
  noteKey?: TranslationKey
}

/**
 * Transaction → horizontal state-machine track for the unified detail screen.
 * Derives only from persisted, observable fields (status/outcome/intent/
 * direction/protocol) — request-pay is keyed on intent, never on protocol,
 * because live creq payments persist as cashu-token + intent request-pay
 * while protocol 'nut18' only survives on legacy rows.
 */
export function buildTxStateTrack(tx: Transaction): TxStateTrack {
  const type = getTransactionType(tx)
  const isReceive = tx.direction === 'receive'
  const settledAt = tx.completedAt

  // Failure collapses any machine: the first node turns into the failure
  // itself and everything downstream is unreachable.
  const failed = tx.status === 'failed'
  const fail = (happy: TxStateNode[]): TxStateTrack => ({
    nodes: [
      { labelKey: 'txDetail.state.failed', tone: 'fail', at: settledAt ?? tx.createdAt },
      ...happy.slice(1).map((n) => ({ ...n, tone: 'void' as const, at: undefined })),
    ],
  })

  // ── Bearer-token / request-pay sender lifecycle (3 nodes with branches) ──
  const isTokenSend = type === 'ecash-token' && !isReceive && tx.intent !== 'swap'
  const isRequestPay = tx.intent === 'request-pay' && !isReceive

  if (isTokenSend || isRequestPay) {
    const first: TranslationKey = isRequestPay ? 'txDetail.state.sent' : 'txDetail.state.created'
    const middle: TranslationKey = isRequestPay ? 'txDetail.state.awaitingReceipt' : 'txDetail.state.waiting'
    const happy: TxStateNode[] = [
      { labelKey: first, tone: 'done', at: tx.createdAt },
      { labelKey: middle, tone: 'todo' },
      { labelKey: 'txDetail.state.used', tone: 'todo' },
    ]
    if (failed) return fail(happy)
    if (tx.status === 'settled' && tx.outcome === 'reclaimed') {
      // The mockup keeps the passed-through waiting node: the token DID wait,
      // then branched into reclaim — used becomes the unreachable fourth stop.
      return {
        nodes: [
          happy[0],
          { labelKey: middle, tone: 'done' },
          { labelKey: 'txDetail.state.reclaimed', tone: 'done', at: settledAt },
          { labelKey: 'txDetail.state.used', tone: 'void' },
        ],
        noteKey: 'txDetail.state.noteReclaimed',
      }
    }
    if (tx.status === 'settled') {
      return {
        nodes: [
          happy[0],
          { ...happy[1], tone: 'done' },
          { labelKey: 'txDetail.state.used', tone: 'done', at: settledAt },
        ],
        noteKey: 'txDetail.state.noteClaimed',
      }
    }
    return {
      nodes: [happy[0], { ...happy[1], tone: 'current' }, happy[2]],
      noteKey: 'txDetail.state.notePending',
    }
  }

  // ── Two-node machines ──
  // pendingAt: where the amber light sits while unsettled. Sends are genuinely
  // WORKING on the last stage (melt confirming) — light on last. A receive
  // request is just RESTING at the first stage until someone pays — light on
  // first, last stays hollow.
  const twoNode = (
    firstKey: TranslationKey,
    lastKey: TranslationKey,
    pendingAt: 'first' | 'last',
    pendingNote?: TranslationKey,
  ): TxStateTrack => {
    const happy: TxStateNode[] = [
      { labelKey: firstKey, tone: 'done', at: tx.createdAt },
      { labelKey: lastKey, tone: 'todo' },
    ]
    if (failed) return fail(happy)
    if (tx.status === 'settled') {
      return { nodes: [happy[0], { labelKey: lastKey, tone: 'done', at: settledAt }] }
    }
    if (pendingAt === 'first') {
      return {
        nodes: [{ labelKey: firstKey, tone: 'current', at: tx.createdAt }, happy[1]],
        noteKey: pendingNote,
      }
    }
    return {
      nodes: [happy[0], { labelKey: lastKey, tone: 'current' }],
      noteKey: pendingNote,
    }
  }

  if (type === 'swap') {
    return twoNode('txDetail.state.swapStart', 'txDetail.state.swapDone', 'last')
  }
  if (type === 'lightning') {
    return isReceive
      ? twoNode('txDetail.state.requested', 'txDetail.state.received', 'first')
      : twoNode('txDetail.state.sent', 'txDetail.state.confirmed', 'last', 'txDetail.state.noteInTransit')
  }
  if (type === 'ecash-token' && isReceive) {
    return twoNode('txDetail.state.received', 'txDetail.state.registered', 'first')
  }

  // Legacy nut18 rows, nutzap, and anything new fall back to a plain
  // sent/received → completed pair.
  return twoNode(
    isReceive ? 'txDetail.state.received' : 'txDetail.state.sent',
    'txDetail.state.completed',
    isReceive ? 'first' : 'last',
  )
}
