/**
 * NUT-18 HTTP poller factory — PaymentRequestService 주입용
 *
 * bootstrap 인라인 람다에서 추출. 추출 이유: 인라인 시절 `expiresAt`이 여기서
 * 유실되어 만료된 수신 요청을 3초 간격으로 최장 30분 폴링하는 결함이 있었다
 * (설계 §8.1 / reports/rate-limit-flow-audit §04). 필드 전수 전달을
 * nut18-poller-factory.test.ts가 회귀 감시한다 — 어댑터 단위 테스트만으로는
 * 배선 누락을 잡지 못함이 증명됐기 때문에 이 계층의 테스트가 별도로 존재한다.
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
