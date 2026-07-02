import type { MintInfoData } from '@/core/types'

/**
 * Mint info 조회 driving 포트 (설계 §5 — /v1/info 단일 소유).
 *
 * 상세 화면(MintInfoSheet, MintManagement 확장)과 신뢰 추가 검증이 사용한다.
 * 기존에는 화면 3곳이 각자 raw fetch를 해 limiter를 우회하고 24h metadata
 * 캐시를 무시했다 — 이제 캐시 히트 시 네트워크 0이다.
 */
export interface MintInfoUseCase {
  /**
   * NUT-06 raw info. 기본은 24h metadata 캐시 우선.
   * fresh=true면 즉시 probe(경량 1왕복) — 신뢰 추가처럼 "지금 살아있고 유효한가"
   * 검증이 목적일 때만. probe 응답은 metadata 캐시에도 역주입된다.
   */
  getInfo(mintUrl: string, opts?: { fresh?: boolean }): Promise<MintInfoData | null>
}
