/**
 * NUT-18 HTTP poller factory — injected into PaymentRequestService.
 *
 * Extracted from a bootstrap inline lambda. The inline version dropped `expiresAt`
 * here, causing expired receive requests to poll every 3s for up to 30 minutes.
 * nut18-poller-factory.test.ts guards the full field pass-through as a regression —
 * this layer has its own test because adapter unit tests alone were proven unable
 * to catch the wiring omission.
 */

import { startNut18HttpPoller } from '@/adapters/codec/nut18-http-poller'
import type { Poller } from '@/core/ports/driving/payment-request.usecase'

export interface Nut18PollerFactoryOptions {
  endpoint: string
  requestId: string
  intervalMs?: number
  maxDurationMs?: number
  expiresAt?: number
}

type StartNut18HttpPoller = typeof startNut18HttpPoller

export function createNut18HttpPollerFactory(
  start: StartNut18HttpPoller = startNut18HttpPoller,
): (opts: Nut18PollerFactoryOptions) => Poller {
  return (opts) => {
    const poller = start({
      endpoint: opts.endpoint,
      requestId: opts.requestId,
      intervalMs: opts.intervalMs,
      maxDurationMs: opts.maxDurationMs,
      expiresAt: opts.expiresAt,
    })
    return {
      stop: poller.cancel,
      onPayment: poller.onPayment,
      onError: poller.onError,
    }
  }
}
