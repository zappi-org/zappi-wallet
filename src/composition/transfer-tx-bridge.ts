/**
 * TransferTxBridge — TransferLifecycleService의 이벤트를 TransactionRepository에 동기화
 *
 * TLS는 Transfer 생명주기를 관리하고, 이 Bridge가 거래내역을 생성/업데이트함.
 * 
 * 처리 흐름:
 * - transfer:phase-changed → 'submitted' (outgoing): Pending Transaction 생성
 * - transfer:settled → Transaction 업데이트 (completed)
 * - transfer:reclaimed → Transaction 업데이트 (reclaimed)
 */

import type { EventBus } from '@/core/events/event-bus'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import { createTransaction, settleAsDelivered } from '@/core/domain/transaction'
import type { PendingTransfer } from '@/core/domain/pending-transfer'
import { sat } from '@/core/domain/amount'

export interface TransferTxBridgeDeps {
  eventBus: EventBus
  txRepo: TransactionRepository
  triggerTxRefresh?: () => void
}

/**
 * Token 문자열에서 prefix 제거한 raw token 추출 (비교용)
 */
function normalizeTokenForComparison(token: string): string {
  if (token.startsWith('cashuA')) return token.slice(6)
  if (token.startsWith('cashuB')) return token.slice(6)
  return token
}

/**
 * Transfer의 transportRef에서 amount를 추출
 */
function extractAmountFromTransfer(transfer: PendingTransfer): number {
  if (transfer.amount != null) {
    return transfer.amount
  }

  const ref = transfer.transportRef as {
    amount?: number
    token?: string
    operationId?: string
  } | undefined

  if (ref?.amount) {
    return ref.amount
  }
  console.warn('[TransferTxBridge] Could not extract amount from transfer:', transfer.id)
  return 0
}

/**
 * Incoming token이 수령되면, 동일한 token을 가진 pending send를 찾아 claimed로 업데이트
 */
async function updatePendingSendIfMatched(
  txRepo: TransactionRepository,
  receivedToken: string,
): Promise<void> {
  try {
    // 1. 모든 pending send 조회 (unclaimed 상태)
    const pendingSends = await txRepo.list({
      status: 'pending',
      outcome: 'unclaimed',
      direction: 'send',
    })

    if (pendingSends.length === 0) return

    const normalizedReceived = normalizeTokenForComparison(receivedToken)

    // 2. token이 일치하는 pending send 찾기
    for (const pendingTx of pendingSends) {
      const pendingToken = pendingTx.metadata?.token as string | undefined
      if (!pendingToken) continue

      const normalizedPending = normalizeTokenForComparison(pendingToken)

      if (normalizedPending === normalizedReceived) {
        console.log('[TransferTxBridge] Found matching pending send:', pendingTx.id)

        // 3. pending send를 claimed 상태로 업데이트
        const claimedTx = {
          ...pendingTx,
          status: 'settled' as const,
          outcome: 'claimed' as const,
          completedAt: Date.now(),
          metadata: {
            ...pendingTx.metadata,
            tokenState: 'spent',
            linkedTxId: receivedToken, // 받은 transaction과 연결
          },
        }

        await txRepo.update(pendingTx.id, claimedTx)
        console.log('[TransferTxBridge] Pending send marked as claimed:', pendingTx.id)
      }
    }
  } catch (error) {
    console.error('[TransferTxBridge] Failed to update pending send:', error)
  }
}

/**
 * Transfer의 transportRef에서 mint URL을 추출
 */
function extractMintFromTransfer(transfer: PendingTransfer): string {
  const ref = transfer.transportRef as {
    mintUrl?: string
    accountId?: string
  } | undefined

  return ref?.mintUrl || ref?.accountId || 'unknown'
}

export function connectTransferTxBridge(deps: TransferTxBridgeDeps): () => void {
  const unsubscribers: (() => void)[] = []

  // 1. Submitted → Pending Transaction 생성
  unsubscribers.push(
    deps.eventBus.on('transfer:submitted', async (event) => {
      const { transfer } = event.payload

      // 이미 생성된 Transaction이 있는지 확인 (중복 방지)
      try {
        const existing = await deps.txRepo.getById(transfer.txId)
        if (existing) {
          return
        }
      } catch {
        // continue
      }

      const amount = extractAmountFromTransfer(transfer)
      const mint = extractMintFromTransfer(transfer)

      const ref = transfer.transportRef as { type?: string; protocol?: string }
      const protocol = ref?.protocol || ref?.type?.split('-')[0]

      // Outgoing: submitted/settled 모두 처리
      if (transfer.direction === 'outgoing') {
        try {
          if (protocol === 'bolt11') {
            //bolt11 outgoing send
            const bolt11Ref = transfer.transportRef as { operationId?: string; request?: string; preimage?: string; feeReserve?: number } | undefined
            const baseTx = createTransaction({
              id: transfer.txId,
              direction: 'send',
              method: 'cashu:lightning',
              protocol: 'bolt11',
              amount: sat(amount),
              accountId: mint,
              fee: bolt11Ref?.feeReserve ? { quoted: sat(bolt11Ref.feeReserve) } : undefined,
              metadata: {
                operationId: bolt11Ref?.operationId,
                bolt11: bolt11Ref?.request,
                preimage: bolt11Ref?.preimage,
                direction: transfer.direction,
              },
            })
            const tx = transfer.phase === 'settled' ? settleAsDelivered(baseTx) : baseTx
            await deps.txRepo.save(tx)
            deps.triggerTxRefresh?.()
          } else {
            // Pending 상태의 Transaction 생성 (outcome: 'unclaimed'로 설정)
            const baseTx = createTransaction({
              id: transfer.txId,
              direction: 'send',
              method: 'ecash',
              protocol: 'cashu-token',
              amount: sat(amount),
              accountId: mint,
              outcome: 'unclaimed', // ← 이캐시 탭에서 "대기중"으로 표시되려면 필요!
              metadata: {
                token: (transfer.transportRef as { token?: string })?.token,
                tokenState: 'unspent', // ← list() 필터에서 필요!
                direction: transfer.direction,
              },
            })
            const tx = transfer.phase === 'settled' ? settleAsDelivered(baseTx) : baseTx
            await deps.txRepo.save(tx)
            deps.triggerTxRefresh?.()
          }
        } catch (error) {
          console.error('[TransferTxBridge] Failed to create pending transaction:', error)
        }
      }

      // Incoming: pending TX 생성 (mint-quote-observer가 나중에 settle)
      if (transfer.direction === 'incoming') {
        try {
          if (protocol === 'bolt11') {
            const bolt11Ref = transfer.transportRef as { quoteId?: string; request?: string } | undefined
            const baseTx = createTransaction({
              id: transfer.txId,
              direction: 'receive',
              method: 'cashu:lightning',
              protocol: 'bolt11',
              amount: sat(amount),
              accountId: mint,
              metadata: {
                quoteId: bolt11Ref?.quoteId,
                bolt11: bolt11Ref?.request,
                direction: transfer.direction,
              },
            })
            await deps.txRepo.save(baseTx)
            deps.triggerTxRefresh?.()
          }
          // ecash incoming은 필요 시 추가
        } catch (error) {
          console.error('[TransferTxBridge] Failed to create incoming transaction:', error)
        }
      }
    }),
  )
  // 2. Settled → 기존 Transaction 업데이트 (또는 incoming이면 새로 생성)
  unsubscribers.push(
    deps.eventBus.on('transfer:settled', async (event) => {
      const transfer = event.payload.transfer

      try {
        // 기존 Transaction 찾기
        let tx = await deps.txRepo.getById(transfer.txId)

        if (tx) {
          // 기존 것 업데이트
          if (transfer.direction === 'incoming') {
            tx = settleAsDelivered(tx)
          } else {
            // outgoing이 settled면 = 상대방이 받음 (claimed)]
            if (tx.protocol === 'bolt11') {
              const ref = transfer.transportRef as { preimage?: string; effectiveFee?: number } | undefined
              const feeUpdate = ref?.effectiveFee != null && tx.fee
                ? { fee: { quoted: tx.fee.quoted, effective: sat(ref.effectiveFee) } }
                : {}
              tx = {
                ...settleAsDelivered(tx),
                ...feeUpdate,
                metadata: {
                  ...tx.metadata,
                  ...(ref?.preimage && { preimage: ref.preimage }),
                },
              }
            } else {
              tx = {
                ...tx,
                status: 'settled',
                outcome: 'claimed',
                completedAt: Date.now(),
                metadata: {
                  ...tx.metadata,
                  tokenState: 'spent', // ← 업데이트!
                },
              }
            }
          }
          await deps.txRepo.update(transfer.txId, tx)
          console.log('[TransferTxBridge] Transaction settled:', transfer.txId)
          deps.triggerTxRefresh?.()
        } else {
          // Transaction이 없으면 새로 생성 (incoming ecash 등록 시

          const amount = extractAmountFromTransfer(transfer)
          const mint = extractMintFromTransfer(transfer)

          //check true protocol
          const ref = transfer.transportRef as { type?: string; protocol?: string } | undefined
          const protocol = ref?.protocol || ref?.type?.split('-')[0] || 'ecash'

          let method: string
          let proto: string
          let metadata: Record<string, unknown>

          if (protocol === 'bolt11') {
            //bolt11 fallback 
            method = 'cashu:lightning'
            proto = 'bolt11'
            const ref = transfer.transportRef as { operationId?: string; request?: string; preimage?: string } | undefined
            metadata = {
              operationId: ref?.operationId,
              bolt11: ref?.request,
              direction: transfer.direction,
              ...(ref?.preimage && { preimage: ref.preimage }),
            }
          } else {
            //ecash fallback
            method = 'ecash'
            proto = 'cashu-token'
            const transportRef = transfer.transportRef as { content?: string; token?: string } | undefined
            const tokenContent = transportRef?.token ?? transportRef?.content
            metadata = {
              token: tokenContent,
              tokenState: 'spent',
              direction: transfer.direction,
            }
          }

          // incoming ecash 등록: receive 방향, settled 상태로 바로 생성

          const newTx = createTransaction({
            id: transfer.txId,
            direction: transfer.direction === 'outgoing' ? 'send' : 'receive',
            method,
            protocol: proto,
            amount: sat(amount),
            accountId: mint,
            outcome: transfer.direction === 'incoming' ? 'claimed' : undefined,
            metadata,
          })

          // incoming이면 이미 settled 상태이므로 completedAt 설정
          const settledTx = transfer.direction === 'incoming'
            ? { ...newTx, status: 'settled' as const, completedAt: Date.now() }
            : settleAsDelivered(newTx)

          await deps.txRepo.save(settledTx)
          deps.triggerTxRefresh?.()
        }

        // Incoming token이 수령되면, 동일한 token을 가진 pending send가 있는지 확인하고 업데이트
        if (transfer.direction === 'incoming') {
          const ref = transfer.transportRef as { content?: string; token?: string } | undefined
          const receivedToken = ref?.token ?? ref?.content
          if (receivedToken) {
            await updatePendingSendIfMatched(deps.txRepo, receivedToken)
            deps.triggerTxRefresh?.()
          }
        }
      } catch (error) {
        console.error('[TransferTxBridge] Failed to settle transaction:', error)
      }
    })
  )

  // 3. Reclaimed → Transaction을 reclaimed로 업데이트
  unsubscribers.push(
    deps.eventBus.on('transfer:reclaimed', async (event) => {
      const transfer = event.payload.transfer

      try {
        const tx = await deps.txRepo.getById(transfer.txId)
        if (!tx) {
          console.warn('[TransferTxBridge] Transaction not found for reclaimed transfer:', transfer.txId)
          return
        }

        const reclaimedTx = {
          ...tx,
          status: 'settled' as const,
          outcome: 'reclaimed' as const,
          completedAt: Date.now(),
          metadata: {
            ...tx.metadata,
            tokenState: 'spent', // ← reclaim도 spent로 처리
          },
        }
        await deps.txRepo.update(transfer.txId, reclaimedTx)
        console.log('[TransferTxBridge] Transaction reclaimed:', transfer.txId)
        deps.triggerTxRefresh?.()
      } catch (error) {
        console.error('[TransferTxBridge] Failed to reclaim transaction:', error)
      }
    })
  )

  // 4. Failed → Transaction을 failed로 업데이트
  unsubscribers.push(
    deps.eventBus.on('transfer:failed', async (event) => {
      const transfer = event.payload.transfer

      try {
        let tx = await deps.txRepo.getById(transfer.txId)
        if (!tx) {
          // TX 없으면 새로 생성 (fallback)
          const amount = extractAmountFromTransfer(transfer)
          const mint = extractMintFromTransfer(transfer)
          const ref = transfer.transportRef as { type?: string; protocol?: string } | undefined
          const protocol = ref?.protocol || ref?.type?.split('-')[0] || 'ecash'

          let method: string
          let proto: string
          let metadata: Record<string, unknown>

          if (protocol === 'bolt11') {
            method = 'cashu:lightning'
            proto = 'bolt11'
            metadata = {
              operationId: (transfer.transportRef as { operationId?: string })?.operationId,
              bolt11: (transfer.transportRef as { request?: string })?.request,
              direction: transfer.direction,
            }
          } else {
            method = 'ecash'
            proto = 'cashu-token'
            const transportRef = transfer.transportRef as { content?: string; token?: string } | undefined
            const tokenContent = transportRef?.token ?? transportRef?.content
            metadata = {
              token: tokenContent,
              direction: transfer.direction,
            }
          }

          const baseTx = createTransaction({
            id: transfer.txId,
            direction: 'send',
            method,
            protocol: proto,
            amount: sat(amount),
            accountId: mint,
            metadata,
          })
          tx = {
            ...baseTx,
            status: 'failed' as const,
            completedAt: Date.now(),
            metadata: {
              ...metadata,
              error: event.payload.reason,
            },
          }
          await deps.txRepo.save(tx)
          console.log('[TransferTxBridge] Transaction created for failed:', transfer.txId)
        } else {
          const failedTx = {
            ...tx,
            status: 'failed' as const,
            completedAt: Date.now(),
            metadata: {
              ...tx.metadata,
              error: event.payload.reason,
            },
          }
          await deps.txRepo.update(transfer.txId, failedTx)
          console.log('[TransferTxBridge] Transaction failed:', transfer.txId)
        }
        deps.triggerTxRefresh?.()
      } catch (error) {
        console.error('[TransferTxBridge] Failed to mark transaction as failed:', error)
      }
    })
  )

  return () => {
    for (const unsub of unsubscribers) {
      unsub()
    }
  }
}
