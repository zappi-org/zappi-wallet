/**
 * NUT-18 HTTP Transport Polling Service
 *
 * Polls a mint's HTTP endpoint for incoming payment request fulfillments.
 * Used as fallback when Nostr relay connections are unreliable.
 *
 * Flow:
 *   Sender → POST {mintUrl}/v1/payment-request/{id} (PaymentRequestPayload)
 *   Receiver → GET {mintUrl}/v1/payment-request/{id} (this poller)
 */

import { getEncodedToken, getDecodedToken, type Proof } from '@cashu/cashu-ts'

// Configuration
const DEFAULT_INTERVAL_MS = 3000
const MAX_DURATION_MS = 30 * 60 * 1000 // 30 minutes
const REQUEST_TIMEOUT_MS = 8000
const SEND_TIMEOUT_MS = 15000

/**
 * NUT-18 PaymentRequestPayload (as submitted by sender)
 */
export interface PaymentRequestPayload {
  id?: string
  memo?: string
  mint: string
  unit: string
  proofs: Proof[]
}

export interface Nut18HttpPollerOptions {
  /** HTTP endpoint URL to poll (GET) */
  endpoint: string
  /** Payment request ID for correlation */
  requestId: string
  /** Polling interval in ms (default: 3000) */
  intervalMs?: number
  /** Max polling duration in ms (default: 30 minutes) */
  maxDurationMs?: number
}

export interface Nut18HttpPollerResult {
  /** Cancel polling */
  cancel: () => void
  /** Register callback for when payment is received */
  onPayment: (cb: (payload: { token: string; requestId: string; memo?: string }) => void) => void
  /** Register callback for errors (non-fatal, polling continues) */
  onError: (cb: (error: Error) => void) => void
}

/**
 * Start polling a mint's HTTP endpoint for NUT-18 payment fulfillment.
 * Returns a handle with cancel() and onPayment() callback registration.
 */
export function startNut18HttpPoller(options: Nut18HttpPollerOptions): Nut18HttpPollerResult {
  const {
    endpoint,
    requestId,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxDurationMs = MAX_DURATION_MS,
  } = options

  let cancelled = false
  let intervalId: ReturnType<typeof setInterval> | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let paymentCallback: ((payload: { token: string; requestId: string; memo?: string }) => void) | null = null
  let errorCallback: ((error: Error) => void) | null = null

  const cancel = () => {
    if (cancelled) return
    cancelled = true
    if (intervalId) clearInterval(intervalId)
    if (timeoutId) clearTimeout(timeoutId)
    intervalId = null
    timeoutId = null
  }

  const poll = async () => {
    if (cancelled) return

    try {
      const controller = new AbortController()
      const fetchTimeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      })
      clearTimeout(fetchTimeout)

      if (!response.ok) {
        // 404 = no payment yet, normal
        if (response.status === 404) return
        // Other errors = log but continue polling
        console.warn(`[NUT18-HTTP] Poll returned ${response.status} for ${requestId}`)
        return
      }

      const payload = await response.json() as PaymentRequestPayload

      // Validate payload has proofs
      if (!payload.proofs || !Array.isArray(payload.proofs) || payload.proofs.length === 0) {
        return
      }

      if (!payload.mint) {
        console.warn('[NUT18-HTTP] Payload missing mint URL')
        return
      }

      // Convert to encoded token
      const token = getEncodedToken({
        mint: payload.mint,
        proofs: payload.proofs,
      })

      console.log(`[NUT18-HTTP] Payment received for request ${requestId}`)

      // Stop polling
      cancel()

      // Notify
      if (paymentCallback) {
        paymentCallback({
          token,
          requestId: payload.id || requestId,
          memo: payload.memo,
        })
      }
    } catch (error) {
      if (cancelled) return
      if (error instanceof Error && error.name === 'AbortError') {
        // Timeout — continue polling
        return
      }
      console.warn('[NUT18-HTTP] Poll error:', error)
      if (errorCallback) {
        errorCallback(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  // Start polling
  intervalId = setInterval(poll, intervalMs)

  // Initial poll immediately
  poll()

  // Auto-stop after max duration
  timeoutId = setTimeout(() => {
    console.log(`[NUT18-HTTP] Max duration reached for ${requestId}, stopping`)
    cancel()
  }, maxDurationMs)

  return {
    cancel,
    onPayment: (cb) => { paymentCallback = cb },
    onError: (cb) => { errorCallback = cb },
  }
}

// ============= Sender: HTTP POST =============

/**
 * Send a NUT-18 payment via HTTP POST transport.
 * Posts PaymentRequestPayload to the receiver's endpoint URL.
 *
 * @param endpoint - The HTTP POST target URL from the payment request transport
 * @param token - Encoded Cashu token (cashuA... or cashuB...)
 * @param requestId - NUT-18 payment request ID
 * @param memo - Optional memo
 * @returns { success: boolean; error?: string }
 */
export async function sendTokenViaHttp(options: {
  endpoint: string
  token: string
  requestId?: string
  memo?: string
}): Promise<{ success: boolean; error?: string }> {
  const { endpoint, token, requestId, memo } = options

  try {
    // Decode token → domain PaymentRequestPayload
    const { buildPaymentPayload } = await import('@/core/domain/cashu-payment-payload')
    const decoded = getDecodedToken(token)

    const payload = buildPaymentPayload({
      mint: decoded.mint,
      unit: 'sat',
      proofs: decoded.proofs as import('@/core/domain/cashu-payment-payload').CashuProof[],
      id: requestId,
      memo,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.warn(`[NUT18-HTTP] POST failed: ${response.status} ${errorText}`)
      return { success: false, error: `HTTP ${response.status}` }
    }

    console.log(`[NUT18-HTTP] Token sent via HTTP POST to ${endpoint}`)
    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'Request timeout' }
    }
    const msg = error instanceof Error ? error.message : String(error)
    console.warn('[NUT18-HTTP] Send error:', msg)
    return { success: false, error: msg }
  }
}
