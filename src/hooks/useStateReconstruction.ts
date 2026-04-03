import { useState, useCallback, useRef } from 'react'
import { SimplePool, nip17 } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import { getDecodedToken } from '@cashu/cashu-ts'
import { useAppStore } from '@/store'
import { receiveP2PKToken } from '@/coco'
import { ProcessedEventRepository } from '@/data/repositories/processed-event.repository'
import { getTransactionRepo } from '@/data/repositories/transaction.repository'
import { FailedSwapRepository } from '@/data/repositories/failed-swap.repository'
import type { AnchorData as CachedAnchor } from '@/core/ports/driven/anchor.port'
import type { ZapMessage, ZapPaymentFulfillment } from '@/types'
import type { Transaction, FailedSwap, ProcessedEvent } from '@/core/types'

// 2 days buffer in seconds
const BUFFER_SECONDS = 2 * 24 * 60 * 60

// Minimum time between reconstructions (1 minute)
const MIN_RECONSTRUCTION_INTERVAL_MS = 60 * 1000

// Network timeout for relay queries (15 seconds)
const NETWORK_TIMEOUT_MS = 15000

// Repositories (singleton instances)
const processedEventRepo = new ProcessedEventRepository()
const transactionRepo = getTransactionRepo()
const failedSwapRepo = new FailedSwapRepository()

export interface ReconstructionProgress {
  phase: 'fetching' | 'processing' | 'done'
  total: number
  processed: number
  recovered: number
}

export interface ReconstructionResult {
  success: boolean
  eventsFound: number
  tokensRecovered: number
  amountRecovered: number
  errors: string[]
}

interface DecodedEvent {
  eventId: string
  rumorCreatedAt: number
  txId: string
  token: string
  mintUrl: string
  amount: number
}

function isPaymentFulfillment(msg: ZapMessage): msg is ZapPaymentFulfillment {
  return msg.type === 'payment_fulfillment'
}

export function useStateReconstruction() {
  const [isRecovering, setIsRecovering] = useState(false)
  const [progress, setProgress] = useState<ReconstructionProgress | null>(null)
  const lastReconstructionRef = useRef<number>(0)

  const reconstruct = useCallback(async (
    anchor: CachedAnchor,
    isRecoveryMode: boolean,
    oldestAnchor?: CachedAnchor
  ): Promise<ReconstructionResult> => {
    // Get state from unified store
    const { settings, nostrPubkey, nostrPrivkey } = useAppStore.getState()
    const relays = settings.relays
    const publicKey = nostrPubkey
    const privateKey = nostrPrivkey

    const result: ReconstructionResult = {
      success: false,
      eventsFound: 0,
      tokensRecovered: 0,
      amountRecovered: 0,
      errors: [],
    }

    // Skip if offline
    if (!navigator.onLine) {
      console.log('[Reconstruction] Offline - skipping')
      result.success = true
      return result
    }

    if (!publicKey || !privateKey) {
      result.errors.push('No keys available')
      return result
    }

    // Check minimum interval
    const now = Date.now()
    if (now - lastReconstructionRef.current < MIN_RECONSTRUCTION_INTERVAL_MS) {
      console.log('[Reconstruction] Skipping - too soon since last reconstruction')
      result.success = true
      return result
    }

    setIsRecovering(true)
    setProgress({ phase: 'fetching', total: 0, processed: 0, recovered: 0 })

    try {
      const pool = new SimplePool()
      const sk = hexToBytes(privateKey)

      // Determine start timestamp
      // In recovery mode, use oldest anchor
      // For first-time anchor (not recovery), look back 7 days to catch any missed events
      const now = Math.floor(Date.now() / 1000)
      const sevenDaysAgo = now - 7 * 24 * 60 * 60

      let startTimestamp: number
      if (isRecoveryMode && oldestAnchor) {
        startTimestamp = oldestAnchor.timestamp
      } else if (anchor.timestamp > now - 60) {
        // Anchor was just created (within last minute) - this might be first anchor for existing user
        // Look back 7 days to catch any missed events
        startTimestamp = sevenDaysAgo
        console.log('[Reconstruction] First anchor detected, looking back 7 days')
      } else {
        startTimestamp = anchor.timestamp
      }

      // Query range: [startTimestamp - 2 days, now]
      const sinceTimestamp = startTimestamp - BUFFER_SECONDS

      console.log(`[Reconstruction] Fetching events since ${new Date(sinceTimestamp * 1000).toISOString()}`)

      // Fetch kind:1059 events with timeout
      const queryPromise = pool.querySync(relays, {
        kinds: [1059],
        '#p': [publicKey],
        since: sinceTimestamp,
      })
      // Prevent unhandled rejection if timeout wins the race
      queryPromise.catch(() => {})
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), NETWORK_TIMEOUT_MS)
      )
      const events = await Promise.race([queryPromise, timeoutPromise])

      console.log(`[Reconstruction] Found ${events.length} events`)
      result.eventsFound = events.length

      // Decode and filter events
      const decodedEvents: DecodedEvent[] = []

      for (const event of events) {
        try {
          const unwrapped = await nip17.unwrapEvent(event, sk)
          const zapMsg: ZapMessage = JSON.parse(unwrapped.content)

          // Only process payment_fulfillment
          if (!isPaymentFulfillment(zapMsg)) continue

          const token = zapMsg.content.token
          if (!token.startsWith('cashu')) continue

          const decoded = getDecodedToken(token)
          const amount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0)

          decodedEvents.push({
            eventId: event.id,
            rumorCreatedAt: unwrapped.created_at,
            txId: zapMsg.content.tx_id,
            token,
            mintUrl: decoded.mint,
            amount,
          })
        } catch {
          // Decryption failure or parsing error - skip
        }
      }

      // Sort by rumor created_at (oldest first)
      decodedEvents.sort((a, b) => a.rumorCreatedAt - b.rumorCreatedAt)

      // Filter: only events after start timestamp
      const filteredEvents = decodedEvents.filter(
        (e) => e.rumorCreatedAt >= startTimestamp
      )

      console.log(`[Reconstruction] ${filteredEvents.length} events after filtering`)

      setProgress({
        phase: 'processing',
        total: filteredEvents.length,
        processed: 0,
        recovered: 0,
      })

      // Process each event
      for (let i = 0; i < filteredEvents.length; i++) {
        const event = filteredEvents[i]

        // Check if already processed
        const existing = await processedEventRepo.findByTxId(event.txId)

        if (existing) {
          console.log(`[Reconstruction] Skipping already processed tx: ${event.txId}`)
          setProgress((prev) => prev ? { ...prev, processed: i + 1 } : prev)
          continue
        }

        // Check token status with Mint
        try {
          // Get private key for P2PK
          const p2pkPrivkey = useAppStore.getState().nostrPrivkey
          if (!p2pkPrivkey) {
            throw new Error('Private key not available')
          }

          // Use Coco to receive the token (handles proofs automatically)
          const receiveResult = await receiveP2PKToken(event.token, p2pkPrivkey)

          // Save transaction
          const tx: Transaction = {
            id: `tx-gw-${event.eventId}`,
            direction: 'receive',
            type: 'nutzap',
            amount: receiveResult.amount,
            mintUrl: receiveResult.mintUrl,
            status: 'completed',
            createdAt: Date.now(),
            completedAt: Date.now(),
            memo: `복구된 결제 (TX: ${event.txId.substring(0, 12)}...)`,
          }
          await transactionRepo.save(tx)

          // Mark as processed
          const processedEvent: ProcessedEvent = {
            eventId: event.eventId,
            txId: event.txId,
            processedAt: Date.now(),
            result: 'success',
          }
          try {
            await processedEventRepo.save(processedEvent)
          } catch {
            // Handle race condition: already processed by another path
          }

          result.tokensRecovered++
          result.amountRecovered += receiveResult.amount

          console.log(`[Reconstruction] Recovered ${receiveResult.amount} sat from tx: ${event.txId}`)

          setProgress((prev) =>
            prev
              ? { ...prev, processed: i + 1, recovered: prev.recovered + 1 }
              : prev
          )
        } catch (error) {
          const errorMsg = String(error)
          const isAlreadySpent = errorMsg.toLowerCase().includes('already spent')

          // Mark as processed
          const processedEvent: ProcessedEvent = {
            eventId: event.eventId,
            txId: event.txId,
            processedAt: Date.now(),
            result: isAlreadySpent ? 'skipped' : 'failed',
            error: isAlreadySpent ? undefined : errorMsg,
          }
          try {
            await processedEventRepo.save(processedEvent)
          } catch {
            // Handle race condition: already processed by another path
          }

          if (isAlreadySpent) {
            console.log(`[Reconstruction] Token already spent: ${event.txId}`)
          } else {
            console.error(`[Reconstruction] Failed to recover: ${event.txId}`, error)
            result.errors.push(`Failed to recover ${event.txId}: ${errorMsg}`)

            // Add to failedSwaps for retry
            try {
              const failedSwap: FailedSwap = {
                id: `fs-recovery-${crypto.randomUUID()}`,
                token: event.token,
                mintUrl: event.mintUrl,
                amount: event.amount,
                error: errorMsg,
                errorCode: 'RECOVERY_FAILED',
                isRetryable: true,
                attemptCount: 1,
                lastAttemptAt: Date.now(),
                createdAt: Date.now(),
                nostrEventId: event.eventId,
                txId: event.txId,
              }
              await failedSwapRepo.save(failedSwap)
            } catch {
              // Ignore duplicate
            }
          }

          setProgress((prev) => prev ? { ...prev, processed: i + 1 } : prev)
        }
      }

      pool.close(relays)

      // Trigger balance refresh through store (Coco handles the actual balance)
      // The balance will be refreshed by the calling component

      lastReconstructionRef.current = Date.now()
      result.success = true

      setProgress({ phase: 'done', total: filteredEvents.length, processed: filteredEvents.length, recovered: result.tokensRecovered })

      console.log(`[Reconstruction] Complete - recovered ${result.tokensRecovered} tokens (${result.amountRecovered} sat)`)

      return result
    } catch (error) {
      console.error('[Reconstruction] Error:', error)
      result.errors.push(String(error))
      return result
    } finally {
      setIsRecovering(false)
      // Clear progress after a delay
      setTimeout(() => setProgress(null), 2000)
    }
  }, [])

  // Check if reconstruction should run (based on time since last)
  const shouldReconstruct = useCallback((): boolean => {
    const now = Date.now()
    return now - lastReconstructionRef.current >= MIN_RECONSTRUCTION_INTERVAL_MS
  }, [])

  return {
    isRecovering,
    progress,
    reconstruct,
    shouldReconstruct,
    lastReconstructionTime: lastReconstructionRef.current,
  }
}
