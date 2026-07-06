/**
 * DiagnosticsUseCase — 진단 화면 전용 읽기 표면 (설계 §12)
 *
 * 카운터 구현(adapters/telemetry/net-counters)은 composition root가 주입한다.
 * UI는 이 포트만 의존 — ui→adapters 직접 import 절단 (R2-B 5번, 감사 §2).
 */
export interface DiagnosticsUseCase {
  /** PII 없는 누적 카운터 스냅샷 (미flush 메모리 델타 합산 포함) */
  readNetCounters(): Promise<Record<string, number>>
}
