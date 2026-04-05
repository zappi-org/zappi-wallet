import { useEffect, useRef, useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { SimplePool, nip17 } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import { useAppStore } from '@/store'
import { getDecodedToken, getEncodedToken } from '@cashu/cashu-ts'
import { receiveP2PKToken } from '@/coco'
import { ServiceContext } from '@/hooks/service-context-value'
import { toNumber } from '@/core/domain/amount'
import { sendDM } from '@/services/nostr-dm'
import { subscribeNetworkStatus } from '@/hooks/useNetworkStatus'
import { ProcessedEventRepository } from '@/data/repositories/processed-event.repository'
import { getTransactionRepo } from '@/data/repositories/transaction.repository'
import { FailedSwapRepository } from '@/data/repositories/failed-swap.repository'
import type { ZapMessage, ZapPaymentFulfillment } from '@/types'
import type { Transaction, FailedSwap, ProcessedEvent } from '@/core/types'
import { parseTransactionSource } from '@/utils/transaction'
import { formatSats } from '@/utils/format'

// Connection timeout for each relay (5 seconds)
const RELAY_CONNECTION_TIMEOUT_MS = 5000

// 2-Tier health check intervals
const PASSIVE_HEALTH_CHECK_INTERVAL_MS = 30_000    // 30초
const ACTIVE_HEALTH_CHECK_INTERVAL_MS = 5_000      // 5초
const DEFAULT_ACTIVE_DURATION_MS = 30 * 60 * 1000  // 30분

// Repositories (singleton instances)
const processedEventRepo = new ProcessedEventRepository()
const transactionRepo = getTransactionRepo()
const failedSwapRepo = new FailedSwapRepository()

// Helper functions for IndexedDB-based tx_id tracking
async function isTxProcessed(txId: string): Promise<boolean> {
  return processedEventRepo.existsByTxId(txId)
}

async function markTxProcessed(
  txId: string,
  eventId: string,
  result: 'success' | 'failed' | 'skipped',
  _amount?: number,
  error?: string
): Promise<void> {
  const event: ProcessedEvent = {
    eventId,
    txId,
    processedAt: Date.now(),
    result,
    error,
  }
  try {
    await processedEventRepo.save(event)
  } catch {
    // Handle race condition: multiple relays delivering the same event simultaneously
    console.log(`[GiftWrap] txId already processed (race condition): ${txId}`)
  }
}

function isPaymentFulfillment(msg: ZapMessage): msg is ZapPaymentFulfillment {
  return msg.type === 'payment_fulfillment'
}

// NUT-18 token message format (sent via nostr-dm.ts sendTokenViaDM)
interface Nut18TokenMessage {
  type: 'cashu_token'
  token: string
  memo?: string
  request_id?: string
  sent_at: number
}

function isNut18TokenMessage(msg: unknown): msg is Nut18TokenMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Nut18TokenMessage).type === 'cashu_token' &&
    typeof (msg as Nut18TokenMessage).token === 'string'
  )
}

// Check if content is a raw Cashu token (cashuA... or cashuB... format)
function isRawCashuToken(content: string): boolean {
  const trimmed = content.trim()
  return /^cashu[ab]/i.test(trimmed)
}

// Cashu V4 JSON token format (sent by cashu.me and other wallets)
// When responding to NUT-18 payment request, cashu.me includes the request ID in the 'id' field
// POS delivery pipeline adds memo, metadata, and txId for wallet display
interface CashuV4JsonToken {
  id?: string      // NUT-18 payment request ID (if responding to a request)
  mint?: string
  unit?: string
  proofs: Array<{
    id: string
    amount: number
    secret: string
    C: string
  }>
  txId?: string    // Delivery ACK correlation
  memo?: string    // Order description (e.g., "커피 x2, 케이크 x1")
  metadata?: Record<string, unknown>  // Structured data (e.g., kiosk order items)
}

// Check if parsed JSON is a raw Cashu V4 token
function isCashuV4JsonToken(msg: unknown): msg is CashuV4JsonToken {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'proofs' in msg &&
    Array.isArray((msg as CashuV4JsonToken).proofs) &&
    (msg as CashuV4JsonToken).proofs.length > 0 &&
    typeof (msg as CashuV4JsonToken).proofs[0].C === 'string'
  )
}

export function useGiftWrapListener() {
  const { t } = useTranslation()
  const registry = useContext(ServiceContext)
  // Get state from unified store
  const settings = useAppStore((state) => state.settings)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)

  const setLastEventTimestamp = useAppStore((state) => state.setLastEventTimestamp)
  const triggerTxRefresh = useAppStore((state) => state.triggerTxRefresh)
  const addDebugLog = useAppStore((state) => state.addDebugLog)
  const addToast = useAppStore((state) => state.addToast)
  const setLastReceivedPayment = useAppStore((state) => state.setLastReceivedPayment)
  const setNostrConnectionStatus = useAppStore((state) => state.setNostrConnectionStatus)

  const poolRef = useRef<SimplePool | null>(null)
  // relay별 연결+구독 상태 추적 (url → { relay, close })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relaySubsRef = useRef<Map<string, { relay: any; close: () => void }>>(new Map())
  const configKeyRef = useRef<string>('')

  // 2-Tier health check refs
  const healthCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modeRef = useRef<'passive' | 'active'>('passive')
  const activeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Send delivery ACK to POS device (fire-and-forget)
  const sendDeliveryAck = useCallback(async (posPubkey: string, txId: string) => {
    if (!nostrPrivkey) return
    const relays = useAppStore.getState().settings.relays
    if (relays.length === 0) return

    try {
      const ackContent = JSON.stringify({ type: 'delivery_ack', txId })
      const result = await sendDM({
        recipientPubkey: posPubkey,
        content: ackContent,
        senderPrivkey: nostrPrivkey,
        relays,
      })
      if (result.success) {
        console.log(`[GiftWrap] Sent delivery ACK for txId: ${txId}`)
      } else {
        console.warn(`[GiftWrap] Failed to send ACK for txId: ${txId}`, result.error)
      }
    } catch (err) {
      console.warn('[GiftWrap] ACK send error:', err)
    }
  }, [nostrPrivkey])

  // Check if a nostr pubkey belongs to a registered POS device
  const isPOSDevice = useCallback((pubkey: string): boolean => {
    const devices = useAppStore.getState().settings.posDevices ?? []
    return devices.some(d => d.nostrPublicKey === pubkey)
  }, [])

  // Process Cashu token from fulfillment. Returns true on success.
  const processToken = useCallback(async (token: string, txId: string, eventId: string, relay: string, requestId?: string, memo?: string, metadata?: Record<string, unknown>): Promise<boolean> => {
    try {
      // Validate token format
      if (!token.startsWith('cashu')) {
        console.log('[GiftWrap] Invalid token format')
        addDebugLog({
          relay,
          type: 'payment_fulfillment',
          txId,
          status: 'failed',
          error: 'Invalid token format',
        })
        return false
      }

      // Decode token
      const decoded = getDecodedToken(token)
      const mintUrl = decoded.mint
      const proofs = decoded.proofs

      if (!proofs || proofs.length === 0) {
        console.log('[GiftWrap] No proofs in token')
        addDebugLog({
          relay,
          type: 'payment_fulfillment',
          txId,
          mintUrl,
          status: 'failed',
          error: 'No proofs in token',
        })
        return false
      }

      const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0)
      console.log(`[GiftWrap] Token details: ${totalAmount} sat from ${mintUrl}`)

      // Check if this mint is in our list
      const trustedMints = useAppStore.getState().settings.mints
      if (!trustedMints.includes(mintUrl)) {
        console.log('[GiftWrap] Warning: Mint not in trusted list:', mintUrl)
        // Still process it, but log warning
      }

      // Receive token to claim ownership
      console.log('[GiftWrap] Receiving token to claim ownership...')

      let receivedAmount: number

      // Phase 5: PaymentUseCase.redeem() 경유 (new path)
      if (registry?.payment) {
        const redeemResult = await registry.payment.redeem({ adapterId: 'cashu:ecash', input: token })
        if (!redeemResult.ok) {
          throw new Error(redeemResult.error.message)
        }
        receivedAmount = toNumber(redeemResult.value.amount)
      } else {
        // Fallback: old Coco direct
        const p2pkPrivkey = useAppStore.getState().nostrPrivkey
        if (!p2pkPrivkey) {
          throw new Error('Private key not available for P2PK signature')
        }
        const result = await receiveP2PKToken(token, p2pkPrivkey)
        receivedAmount = result.amount
      }

      // Save transaction to new data layer (deterministic ID based on event to prevent duplicates)
      const txRecordId = `tx-gw-${eventId}`
      const existingTx = await transactionRepo.findById(txRecordId)
      if (!existingTx) {
        const tx: Transaction = {
          id: txRecordId,
          direction: 'receive',
          type: 'ecash',
          amount: receivedAmount,
          mintUrl,
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
          token,
          source: parseTransactionSource(requestId),
          memo,
          metadata,
        }
        await transactionRepo.save(tx)
      }

      // Mark as processed in IndexedDB
      await markTxProcessed(txId, eventId, 'success', receivedAmount)

      console.log(`[GiftWrap] Successfully claimed ${receivedAmount} sat!`)

      // Notify ReceiveFlow if this was a NUT-18 request fulfillment
      if (requestId) {
        console.log(`[GiftWrap] Notifying of payment for request: ${requestId}`)
        setLastReceivedPayment(requestId, receivedAmount, eventId)

        import('@/services/receive-request').then(({ completeByEcashRequestId }) => {
          completeByEcashRequestId(requestId)
            .catch((err) => console.warn('[GiftWrap] ReceiveRequest completion failed:', err))
        }).catch((err) => console.warn('[GiftWrap] ReceiveRequest import failed:', err))
      }

      // Trigger transaction history refresh
      triggerTxRefresh()

      // Show toast notification
      addToast({
        type: 'success',
        message: t('toast.ecashTokenReceived', { amount: formatSats(receivedAmount) }),
        duration: 5000,
      })

      // Log successful processing
      addDebugLog({
        relay,
        type: 'payment_fulfillment',
        txId,
        amount: totalAmount,
        unit: 'sat',
        mintUrl,
        status: 'processed',
      })

      return true
    } catch (error) {
      const errorMsg = String(error)
      console.error('[GiftWrap] Token processing error:', error)

      // Check if token was already spent (means it was successfully claimed before)
      const isAlreadySpent = errorMsg.toLowerCase().includes('already spent')

      if (isAlreadySpent) {
        // Token already claimed - ensure transaction record exists (may have been lost in a crash)
        // Use deterministic ID based on eventId to prevent duplicate tx records
        const txRecordId = `tx-gw-${eventId}`
        try {
          const existingTx = await transactionRepo.findById(txRecordId)
          if (!existingTx) {
            const decoded = getDecodedToken(token)
            const amount = decoded.proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
            const mintUrl = decoded.mint
            await transactionRepo.save({
              id: txRecordId,
              direction: 'receive',
              type: 'ecash',
              amount,
              mintUrl,
              status: 'completed',
              createdAt: Date.now(),
              completedAt: Date.now(),
              token,
              source: parseTransactionSource(requestId),
              memo,
              metadata,
            })
            // Notify ReceiveFlow if applicable
            if (requestId) {
              setLastReceivedPayment(requestId, amount, eventId)
              import('@/services/receive-request').then(({ completeByEcashRequestId }) => {
                completeByEcashRequestId(requestId)
                  .catch((err) => console.warn('[GiftWrap] ReceiveRequest completion failed:', err))
              }).catch((err) => console.warn('[GiftWrap] ReceiveRequest import failed:', err))
            }
            triggerTxRefresh()
          }
        } catch {
          // Token decode failed - can't create transaction record, skip
        }
        await markTxProcessed(txId, eventId, 'skipped')
        return false
      }

      // Log failure
      addDebugLog({
        relay,
        type: 'payment_fulfillment',
        txId,
        status: 'failed',
        error: errorMsg,
      })

      // Add to failed swaps queue for retry (only for real failures)
      try {
        const decoded = getDecodedToken(token)
        const amount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0)

        // Mark as failed in IndexedDB
        await markTxProcessed(txId, eventId, 'failed', amount, errorMsg)

        const failedSwap: FailedSwap = {
          id: `fs-${crypto.randomUUID()}`,
          token,
          mintUrl: decoded.mint,
          amount,
          error: errorMsg,
          errorCode: 'SWAP_FAILED',
          isRetryable: true,
          attemptCount: 1,
          lastAttemptAt: Date.now(),
          createdAt: Date.now(),
          nostrEventId: eventId,
          txId,
        }
        await failedSwapRepo.save(failedSwap)
        console.log('[GiftWrap] Added to retry queue')
      } catch (queueError) {
        console.error('[GiftWrap] Failed to add to retry queue:', queueError)
      }

      return false
    }
  }, [addDebugLog, setLastReceivedPayment, triggerTxRefresh, addToast, t])

  // Process a Gift Wrap event (kind:1059)
  const processGiftWrap = useCallback(async (event: { id: string; created_at?: number }, url: string) => {
    if (!nostrPrivkey) {
      console.log('[GiftWrap] No private key available')
      return
    }

    try {
      console.log(`[GiftWrap] Received event from ${url} (id: ${event.id.substring(0, 8)}...)`)

      // Convert hex private key to Uint8Array
      const sk = hexToBytes(nostrPrivkey)

      // Unwrap the Gift Wrap using NIP-17
      const unwrapped = await nip17.unwrapEvent(event as Parameters<typeof nip17.unwrapEvent>[0], sk)

      const content = unwrapped.content
      const senderPubkey = unwrapped.pubkey // sender's real Nostr pubkey
      console.log(`[GiftWrap] Unwrapped content (first 100 chars): ${content.substring(0, 100)}`)

      // Helper: send ACK to POS device if sender is registered
      const maybeAck = async (txId: string, success: boolean) => {
        if (success && senderPubkey && isPOSDevice(senderPubkey)) {
          sendDeliveryAck(senderPubkey, txId)
        }
      }

      // Check for raw Cashu token first (simple DM with just a token)
      // NUT-18 spec: other wallets send cashuB token string directly
      if (isRawCashuToken(content)) {
        console.log('[GiftWrap] Raw Cashu token received in DM')
        const txId = `dm-token-${event.id.substring(0, 12)}`
        const alreadyProcessed = await isTxProcessed(txId)
        if (alreadyProcessed) return
        // Match to pending ecash request if ReceiveQR is active
        const pendingRequestId = useAppStore.getState().pendingEcashRequestId
        const success = await processToken(content.trim(), txId, event.id, url, pendingRequestId ?? undefined)
        await maybeAck(txId, success)
        return
      }

      // Try to parse as JSON
      let msg: unknown
      try {
        msg = JSON.parse(content)
      } catch {
        // Not JSON and not a raw token - skip
        console.log('[GiftWrap] Non-JSON, non-token content - skipping')
        return
      }

      // Check for NUT-18 token message format (from our sendTokenViaDM)
      if (isNut18TokenMessage(msg)) {
        const txId = msg.request_id || `nut18-${event.id.substring(0, 12)}`
        const alreadyProcessed = await isTxProcessed(txId)
        if (alreadyProcessed) return
        // Pass request_id and memo to notify ReceiveFlow
        const success = await processToken(msg.token, txId, event.id, url, msg.request_id, msg.memo)
        await maybeAck(txId, success)
        return
      }

      // Check for raw Cashu V4 JSON token (sent by cashu.me and other wallets)
      if (isCashuV4JsonToken(msg)) {
        // Use request ID from token if present (NUT-18 payment fulfillment)
        const requestId = msg.id
        // Use txId from POS delivery pipeline if present, else fall back to requestId
        const txId = msg.txId || requestId || `v4json-${event.id.substring(0, 12)}`
        const alreadyProcessed = await isTxProcessed(txId)
        if (alreadyProcessed) return
        // Convert V4 JSON to encoded token format
        const mintUrl = msg.mint || ''
        if (!mintUrl) return
        const encodedToken = getEncodedToken({
          mint: mintUrl,
          proofs: msg.proofs,
        })
        // Pass requestId, memo, and metadata for wallet display
        const success = await processToken(encodedToken, txId, event.id, url, requestId, msg.memo, msg.metadata)
        await maybeAck(txId, success)
        return
      }

      // Check for ZapMessage format
      if (typeof msg === 'object' && msg !== null && 'type' in msg) {
        const msgType = (msg as { type: string }).type

        // Skip non-ZAP messages (like anchors)
        if (msgType !== 'payment_request' && msgType !== 'payment_fulfillment') {
          return
        }

        const zapMsg = msg as ZapMessage

        // Check for duplicate tx_id using IndexedDB
        const txId = zapMsg.content.tx_id
        const alreadyProcessed = await isTxProcessed(txId)
        if (alreadyProcessed) {
          return
        }

        if (zapMsg.type === 'payment_request') {
          // Log payment request (backup용이므로 처리하지 않음)
          addDebugLog({
            relay: url,
            type: 'payment_request',
            txId: zapMsg.content.tx_id,
            amount: zapMsg.content.amount,
            unit: zapMsg.content.unit,
            mintUrl: zapMsg.content.mint_url,
            status: 'received',
          })
        }
        else if (isPaymentFulfillment(zapMsg)) {
          // Extract and process Cashu token
          await processToken(zapMsg.content.token, zapMsg.content.tx_id, event.id, url)
        }
      }

      // Update last event timestamp
      if (event.created_at) {
        setLastEventTimestamp(event.created_at)
      }
    } catch (error) {
      // Decryption failure - not our message
      if (error instanceof Error && error.message.includes('decrypt')) {
        return
      }
      console.error('[GiftWrap] Error processing event:', error)
      addDebugLog({
        relay: url,
        type: 'error',
        status: 'failed',
        error: String(error),
      })
    }
  }, [nostrPrivkey, setLastEventTimestamp, addDebugLog, processToken, isPOSDevice, sendDeliveryAck])

  // processGiftWrap를 ref로 유지 — reconnection 시 최신 콜백 사용
  const processGiftWrapRef = useRef(processGiftWrap)
  processGiftWrapRef.current = processGiftWrap

  // ─── 개별 relay 재연결+재구독 ───
  const reconnectRelay = useCallback(async (pool: SimplePool, url: string) => {
    try {
      const existing = relaySubsRef.current.get(url)
      if (existing) {
        try { existing.close() } catch { /* ignore */ }
      }

      const relayPromise = pool.ensureRelay(url)
      relayPromise.catch(() => {})
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), RELAY_CONNECTION_TIMEOUT_MS)
      )

      const relay = await Promise.race([relayPromise, timeoutPromise])

      // since 갱신 — missed events 캐치
      const lastTimestamp = useAppStore.getState().lastEventTimestamp
      const since = lastTimestamp || Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60
      const pubkey = useAppStore.getState().nostrPubkey
      if (!pubkey) return

      const filter = { kinds: [1059], '#p': [pubkey], since }
      const sub = relay.subscribe([filter], {
        onevent: (event: { id: string; created_at?: number }) => {
          processGiftWrapRef.current(event, url)
        },
      })

      relaySubsRef.current.set(url, { relay, close: () => sub.close() })
      console.log(`[GiftWrap] Reconnected to ${url}`)
    } catch (err) {
      console.warn(`[GiftWrap] Failed to reconnect to ${url}:`, err)
      relaySubsRef.current.delete(url)
    }
  }, [])

  // ─── Health check: 끊어진 relay만 재연결 ───
  const runHealthCheck = useCallback(async () => {
    const pool = poolRef.current
    if (!pool || !navigator.onLine) return

    const relays = useAppStore.getState().settings.relays
    if (!relays?.length) return

    for (const url of relays) {
      const entry = relaySubsRef.current.get(url)
      if (!entry || !entry.relay.connected) {
        console.log(`[GiftWrap] Health check: reconnecting ${url}`)
        await reconnectRelay(pool, url)
      }
    }

    const connectedCount = [...relaySubsRef.current.values()].filter(e => e.relay.connected).length
    setNostrConnectionStatus(connectedCount > 0 ? 'connected' : 'disconnected')
  }, [reconnectRelay, setNostrConnectionStatus])

  // ─── 타이머 관리 ───
  const stopHealthCheckTimer = useCallback(() => {
    if (healthCheckTimerRef.current) {
      clearInterval(healthCheckTimerRef.current)
      healthCheckTimerRef.current = null
    }
  }, [])

  const startHealthCheckTimer = useCallback(() => {
    stopHealthCheckTimer()
    const interval = modeRef.current === 'active'
      ? ACTIVE_HEALTH_CHECK_INTERVAL_MS
      : PASSIVE_HEALTH_CHECK_INTERVAL_MS
    healthCheckTimerRef.current = setInterval(() => runHealthCheck(), interval)
  }, [stopHealthCheckTimer, runHealthCheck])

  // ─── 모드 전환 API ───
  const activateListening = useCallback((durationMs = DEFAULT_ACTIVE_DURATION_MS) => {
    modeRef.current = 'active'
    if (activeTimeoutRef.current) clearTimeout(activeTimeoutRef.current)

    // 즉시 health check + 짧은 주기 타이머 시작
    runHealthCheck()
    startHealthCheckTimer()

    // 자동 Passive 복귀
    activeTimeoutRef.current = setTimeout(() => {
      modeRef.current = 'passive'
      activeTimeoutRef.current = null
      startHealthCheckTimer()
      console.log('[GiftWrap] Passive mode restored')
    }, durationMs)

    console.log(`[GiftWrap] Active mode (${durationMs / 1000}s)`)
  }, [runHealthCheck, startHealthCheckTimer])

  const deactivateListening = useCallback(() => {
    modeRef.current = 'passive'
    if (activeTimeoutRef.current) {
      clearTimeout(activeTimeoutRef.current)
      activeTimeoutRef.current = null
    }
    startHealthCheckTimer()
    console.log('[GiftWrap] Passive mode restored')
  }, [startHealthCheckTimer])

  // Start listener
  useEffect(() => {
    // Debug: log the state of conditions
    console.log('[GiftWrap] Checking conditions:', {
      hasNostrPubkey: !!nostrPubkey,
      hasNostrPrivkey: !!nostrPrivkey,
      hasSettings: !!settings,
      relaysCount: settings?.relays?.length ?? 0,
    })

    if (!nostrPubkey || !nostrPrivkey || !settings?.relays?.length) {
      console.log('[GiftWrap] Conditions not met, skipping listener start')
      return
    }

    // Create config key to detect changes (handles Strict Mode + real config changes)
    const newConfigKey = `${nostrPubkey}:${settings.relays.slice().sort().join(',')}`

    // Same config = don't re-initialize (Strict Mode double-run protection)
    if (configKeyRef.current === newConfigKey) {
      return
    }

    // Config 변경 시 기존 연결 정리
    if (configKeyRef.current !== '') {
      console.log('[GiftWrap] Config changed, reconnecting...')
      stopHealthCheckTimer()
      for (const entry of relaySubsRef.current.values()) {
        try { entry.close() } catch { /* ignore */ }
      }
      relaySubsRef.current.clear()
      poolRef.current = null
    }

    configKeyRef.current = newConfigKey

    const startListener = async () => {
      if (!navigator.onLine) {
        console.log('[GiftWrap] Offline - skipping relay connections')
        setNostrConnectionStatus('disconnected')
        return
      }

      try {
        setNostrConnectionStatus('connecting')
        const pool = new SimplePool()
        poolRef.current = pool

        console.log('[GiftWrap] Connecting to relays:', settings.relays)

        // 개별 relay 연결+구독
        for (const url of settings.relays) {
          await reconnectRelay(pool, url)
        }

        const connectedCount = relaySubsRef.current.size
        console.log(`[GiftWrap] Listening for payments on ${connectedCount} relays`)
        setNostrConnectionStatus(connectedCount > 0 ? 'connected' : 'disconnected')

        // Health check 타이머 시작
        startHealthCheckTimer()
      } catch (error) {
        console.error('[GiftWrap] Failed to start listener:', error)
        setNostrConnectionStatus('disconnected')
      }
    }

    startListener()

    // Network status → 온라인 복귀 시 health check
    const unsubNetwork = subscribeNetworkStatus((isOnline) => {
      if (isOnline) {
        console.log('[GiftWrap] Back online - running health check')
        runHealthCheck()
        startHealthCheckTimer()
      } else {
        stopHealthCheckTimer()
      }
    })

    // Visibility → foreground 복귀 시 즉시 health check
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[GiftWrap] App visible - running health check')
        runHealthCheck()
        startHealthCheckTimer()
      } else {
        stopHealthCheckTimer()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup — ref를 로컬 변수로 캡처 (React cleanup 시점 안전)
    const subs = relaySubsRef.current
    return () => {
      stopHealthCheckTimer()
      if (activeTimeoutRef.current) {
        clearTimeout(activeTimeoutRef.current)
        activeTimeoutRef.current = null
      }
      modeRef.current = 'passive'
      unsubNetwork()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      for (const entry of subs.values()) {
        try { entry.close() } catch { /* ignore */ }
      }
      subs.clear()
      poolRef.current = null
      configKeyRef.current = ''
      setNostrConnectionStatus('disconnected')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostrPubkey, nostrPrivkey, settings?.relays])

  return {
    isConnected: relaySubsRef.current.size > 0,
    activateListening,
    deactivateListening,
  }
}
