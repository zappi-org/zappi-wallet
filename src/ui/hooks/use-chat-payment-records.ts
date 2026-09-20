import { useEffect, useState } from 'react'
import type { ChatMessage } from '@/core/domain/chat'
import type { Transaction } from '@/core/domain/transaction'
import {
  chatPaymentRequestType,
  parseChatPaymentLink,
  parseChatPaymentNotice,
} from '@/core/domain/chat-payment'
import { useAppStore } from '@/store'
import { useServiceRegistry } from './use-service-registry'

export interface ChatPaymentRecord {
  status:
    | 'pending'
    | 'unclaimed'
    | 'settled'
    | 'failed'
    | 'cancelled'
    | 'expired'
    | 'unknown'
  transaction?: Transaction
  foldedIntoRequestId?: string
}

const empty = new Map<string, ChatPaymentRecord>()
const priority = {
  settled: 6,
  unclaimed: 5,
  pending: 4,
  unknown: -1,
  failed: 2,
  cancelled: 1,
  expired: 0,
}

export function useChatPaymentRecords(
  messages: readonly ChatMessage[],
  active: boolean
) {
  const { transactionMgmt, receiveRequest, processedStore, inputParser } =
    useServiceRegistry()
  const refresh = useAppStore((state) => state.txRefreshTrigger)
  const source = JSON.stringify(
    messages
      .filter(
        (message) =>
          chatPaymentRequestType(message.content) === 'cashu' ||
          (message.outgoing
            ? !!message.payment
            : !!parseChatPaymentNotice(message.content)?.deliveryId)
      )
      .map(
        ({
          id,
          conversationId,
          content,
          payment,
          outgoing,
          sender,
          recipient,
        }) => ({
          id,
          conversationId,
          content,
          payment,
          outgoing,
          sender,
          recipient,
        })
      )
  )
  const [snapshot, setSnapshot] = useState<{
    source: string
    records: Map<string, ChatPaymentRecord>
  }>()

  useEffect(() => {
    if (!active) return
    let disposed = false
    let revision = 0
    const linked: Pick<
      ChatMessage,
      | 'id'
      | 'conversationId'
      | 'content'
      | 'payment'
      | 'outgoing'
      | 'sender'
      | 'recipient'
    >[] = JSON.parse(source)
    const run = async () => {
      const current = ++revision
      if (document.visibilityState !== 'visible') return
      const records = new Map<string, ChatPaymentRecord>()
      const aliases: Array<[string, string, ChatPaymentRecord]> = []
      const read = async (message: (typeof linked)[number]) => {
        let record: ChatPaymentRecord = { status: 'unknown' }
        const link = parseChatPaymentLink(message.payment)
        try {
          if (!message.outgoing) {
            const notice = parseChatPaymentNotice(message.content)
            if (notice?.deliveryId && notice.recipient === message.recipient) {
              const processed = await processedStore?.findById(
                notice.deliveryId
              )
              const localId =
                processed?.result === 'success' && processed.txId
                  ? processed.txId
                  : notice.deliveryId
              const transaction = await transactionMgmt.getById(localId)
              const delivery = transaction?.metadata?.paymentDelivery as
                | {
                    id?: unknown
                    sender?: unknown
                    recipient?: unknown
                    amount?: unknown
                  }
                | undefined
              if (
                transaction?.id === localId &&
                transaction.direction === 'receive' &&
                transaction.amount.unit === 'sat' &&
                (transaction.amount.value === BigInt(notice.amount) ||
                  (transaction.fee?.effective?.unit === 'sat' &&
                    transaction.amount.value +
                      transaction.fee.effective.value ===
                      BigInt(notice.amount))) &&
                delivery?.id === notice.deliveryId &&
                delivery.sender === message.sender &&
                delivery.recipient === message.recipient &&
                delivery.amount === notice.amount
              )
                record = { status: transaction.status, transaction }
            }
          } else if (link?.kind === 'send') {
            const notice = parseChatPaymentNotice(message.content)
            if (
              notice &&
              notice.transactionId === link.transactionId &&
              notice.amount === link.amount &&
              notice.requestMessageId === link.requestMessageId
            ) {
              const transaction = await transactionMgmt.getById(
                link.transactionId
              )
              if (
                transaction &&
                transaction.id === link.transactionId &&
                transaction.direction === 'send' &&
                transaction.amount.unit === 'sat' &&
                transaction.amount.value === BigInt(link.amount)
              ) {
                record = {
                  status:
                    transaction.outcome === 'reclaimed'
                      ? 'cancelled'
                      : transaction.status === 'pending' &&
                        transaction.outcome === 'unclaimed'
                      ? 'unclaimed'
                      : transaction.status,
                  transaction,
                }
              }
            }
          } else if (link?.kind === 'request') {
            const request = await receiveRequest.findByRequestId(link.requestId)
            if (request && request.amount === link.amount) {
              record = {
                status:
                  request.fulfillmentStatus === 'fulfilled'
                    ? 'settled'
                    : request.fulfillmentStatus === 'pending' &&
                      link.expiresAt <= Date.now()
                    ? 'expired'
                    : request.fulfillmentStatus,
              }
            }
          }
        } catch {
          // A failed lookup never establishes settlement.
        }
        const notice = parseChatPaymentNotice(message.content)
        const request = notice?.requestMessageId
          ? linked.find((candidate) => candidate.id === notice.requestMessageId)
          : undefined
        if (
          record.transaction &&
          notice &&
          request &&
          request.conversationId === message.conversationId &&
          request.outgoing !== message.outgoing &&
          request.sender === message.recipient &&
          request.recipient === message.sender &&
          notice.recipient === message.recipient &&
          chatPaymentRequestType(request.content) === 'cashu'
        ) {
          try {
            const decoded = inputParser.decodeCashuRequest(
              request.content.trim()
            )
            const delivery = record.transaction.metadata?.paymentDelivery as
              | { requestId?: unknown }
              | undefined
            const matchesRequest =
              message.outgoing ||
              (typeof decoded.id === 'string' &&
                decoded.id.length > 0 &&
                delivery?.requestId === decoded.id)
            if (
              decoded.unit === 'sat' &&
              decoded.amount === notice.amount &&
              matchesRequest
            )
              aliases.push([request.id, message.id, record])
          } catch {
            // Invalid requests retain their separate payment notice.
          }
        }
        records.set(message.id, record)
      }
      for (let i = 0; i < linked.length; i += 4) {
        if (disposed || current !== revision) return
        await Promise.all(linked.slice(i, i + 4).map(read))
      }
      aliases.sort((a, b) => priority[b[2].status] - priority[a[2].status])
      const attachedTransactions = new Set<string>()
      for (const [id, noticeId, record] of aliases) {
        if (
          !record.transaction ||
          attachedTransactions.has(record.transaction.id)
        )
          continue
        const existing = records.get(id)
        if (
          !existing ||
          priority[record.status] > priority[existing.status] ||
          (record.status === existing.status && !existing.transaction)
        )
          records.set(id, record)
        if (records.get(id) === record)
          attachedTransactions.add(record.transaction.id)
        // Preserve failed attempts and additional transfers in the timeline.
        if (
          ['settled', 'unclaimed', 'pending'].includes(record.status) &&
          records.get(id) === record
        )
          records.set(noticeId, { ...record, foldedIntoRequestId: id })
      }
      if (
        !disposed &&
        current === revision &&
        document.visibilityState === 'visible'
      )
        setSnapshot({ source, records })
    }
    const refreshRecords = () => {
      void run()
    }
    refreshRecords()
    const timer = linked.length
      ? window.setInterval(refreshRecords, 15_000)
      : undefined
    document.addEventListener('visibilitychange', refreshRecords)
    window.addEventListener('focus', refreshRecords)
    return () => {
      disposed = true
      revision++
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshRecords)
      window.removeEventListener('focus', refreshRecords)
    }
  }, [
    source,
    active,
    refresh,
    transactionMgmt,
    receiveRequest,
    processedStore,
    inputParser,
  ])

  return active && snapshot?.source === source ? snapshot.records : empty
}
