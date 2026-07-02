/**
 * MintInfoService — /v1/info의 단일 소유자 (설계 §5)
 *
 * 두 역할을 한 몸으로 구현한다:
 * 1. MintHealthChecker(드리븐 포트): 30초 신선도 health probe. 기존
 *    MintHealthCheckerAdapter를 갈아끼우므로 health 파사드·driving 포트·UI는
 *    전부 무변경이다.
 * 2. MintInfoUseCase(드라이빙 포트): 상세 화면용 raw NUT-06 info — 24h metadata
 *    캐시 우선(캐시 히트 시 네트워크 0).
 *
 * 이중 타격 제거의 핵심: probe(경량 1왕복) 성공 응답을 metadata에 **역주입**
 * (`MintMetadataService.ingest`)한다 — 같은 갱신 사이클에서 health와 metadata가
 * 같은 endpoint를 각자 치던 문제(감사 §04)가 응답 공유로 사라진다.
 *
 * probe는 이 코드베이스에 남는 유일한 민트 직접 fetch다 (설계 §5.4 예외 1 —
 * health는 "지금 살아있는가"라 실왕복이 필요하고, Coco getMintInfo는 5분 TTL
 * repo 하이브리드(SP-1)라 30초 신선도에 부적합. UP-2 수용 시 Coco 경유로 전환).
 */

import type {
  MintHealthChecker,
  MintHealthStatus,
} from '@/core/ports/driven/mint-health-checker.port'
import type { MintInfoUseCase } from '@/core/ports/driving/mint-info.usecase'
import type { MintInfoData, MintMetadata } from '@/core/types'
import { netLog } from '@/core/utils/net-log'
import type { MintMetadataService, MintInfoResponse } from './internal/mint-metadata'

const HEALTH_TTL_MS = 30_000
const PROBE_TIMEOUT_MS = 10_000

interface ProbeOutcome {
  status: MintHealthStatus
  info: MintInfoData | null
}

export class MintInfoService implements MintHealthChecker, MintInfoUseCase {
  /** health 스냅샷 메모리 미러 — getCached의 동기 원천 */
  private readonly mirror = new Map<string, MintHealthStatus>()
  /**
   * 동시 probe(url) 중복 방지 — mintUrl 단일 키의 in-flight 맵.
   * RequestGate 대신 자체 맵인 이유: 분기 A(metadata)가 진행 중 probe에
   * 합류하려면 in-flight를 조회할 수 있어야 한다 ([N8], 아래 joinProbeAsMetadata).
   */
  private readonly probeInFlight = new Map<string, Promise<ProbeOutcome>>()

  constructor(private readonly metadata: MintMetadataService) {
    // [N8] 교차분기 in-flight 공유 (구현 리뷰 #1): Home 마운트에서 health probe와
    // metadata 갱신이 같은 커밋에 동시 발화하는 결정적 중복 — metadata의 캐시 미스/
    // 스테일 경로가 같은 민트의 진행 중 probe에 합류해 한 왕복으로 끝낸다.
    this.metadata.setProbeJoiner((mintUrl) => this.joinProbeAsMetadata(mintUrl))
  }

  // ─── MintHealthChecker ───

  async checkMint(mintUrl: string): Promise<MintHealthStatus> {
    const cached = this.mirror.get(mintUrl)
    if (cached && Date.now() - cached.lastChecked < HEALTH_TTL_MS) {
      return { ...cached, checkMethod: 'cached' }
    }

    const { status } = await this.runProbe(mintUrl)
    return status
  }

  async checkAllMints(urls: string[]): Promise<MintHealthStatus[]> {
    return Promise.all(urls.map((url) => this.checkMint(url)))
  }

  getCached(mintUrl: string): MintHealthStatus | null {
    return this.mirror.get(mintUrl) ?? null
  }

  // ─── MintInfoUseCase ───

  async getInfo(
    mintUrl: string,
    opts?: { fresh?: boolean },
  ): Promise<MintInfoData | null> {
    if (opts?.fresh) {
      // 수용된 트레이드오프 (구현 리뷰 #6): fresh probe는 검증 성공 여부와 무관하게
      // 2xx 응답을 metadata에 역주입한다 — 신뢰 추가로 이어질 민트에는 캐시 워밍이고,
      // 사용자가 입력만 하고 안 추가한 URL은 소량의 잔여 캐시 행으로 남는다
      // (사용자 액션 바운드, 무해).
      const { info } = await this.runProbe(mintUrl)
      return info
    }

    const cached = await this.metadata.getMetadata(mintUrl)
    if (cached?.rawInfo) {
      return cached.rawInfo as MintInfoData
    }

    // rawInfo가 없는 구캐시(필드 도입 이전 레코드) — 강제 갱신으로 보강
    const refreshed = await this.metadata.refresh(mintUrl)
    return (refreshed?.rawInfo as MintInfoData | undefined) ?? null
  }

  // ─── Probe (경량 /v1/info 1왕복 — keysets 없음) ───

  private runProbe(mintUrl: string): Promise<ProbeOutcome> {
    const existing = this.probeInFlight.get(mintUrl)
    if (existing) return existing

    const promise = this.probe(mintUrl).finally(() => this.probeInFlight.delete(mintUrl))
    this.probeInFlight.set(mintUrl, promise)
    return promise
  }

  /**
   * 분기 A 합류점 ([N8]): 이 민트의 probe가 진행 중이면 그 완료(ingest 포함) 후의
   * 캐시 레코드를 metadata 결과로 돌려준다. probe가 없으면 null → 분기 A가 직접 fetch.
   */
  private joinProbeAsMetadata(mintUrl: string): Promise<MintMetadata | null> | null {
    const inflight = this.probeInFlight.get(mintUrl)
    if (!inflight) return null
    return inflight.then((outcome) =>
      outcome.status.isOnline ? this.metadata.peekCached(mintUrl) : null,
    )
  }

  /**
   * 참고 — 구 어댑터와의 의도적 시맨틱 차이 (구현 리뷰 #5): 구 코드는 body를 읽지
   * 않아 2xx면 무조건 online이었다(캡티브 포털의 가짜 200도 online). probe는 JSON
   * 파싱까지 성공해야 online — 파싱 실패는 offline으로 판정한다.
   */
  private async probe(mintUrl: string): Promise<ProbeOutcome> {
    const start = Date.now()
    const infoUrl = `${mintUrl.replace(/\/+$/, '')}/v1/info`
    netLog({ layer: 'mint', op: 'fetch', key: mintUrl, detail: '/v1/info', caller: 'mint-info' })

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      const response = await fetch(infoUrl, { method: 'GET', signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return this.record(mintUrl, start, false, `HTTP ${response.status}`)
      }

      const info = (await response.json()) as MintInfoResponse
      // 역주입 — 같은 응답으로 metadata 캐시 갱신. await하는 이유: [N8] 합류자가
      // probe 완료 직후 peekCached로 읽으므로 저장이 선행돼야 한다.
      await this.metadata.ingest(mintUrl, info).catch(() => {})

      const outcome = this.record(mintUrl, start, true)
      return { ...outcome, info: info as unknown as MintInfoData }
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'timeout'
          : error instanceof Error
            ? error.message
            : 'Unknown error'
      return this.record(mintUrl, start, false, message)
    }
  }

  private record(
    mintUrl: string,
    startedAt: number,
    isOnline: boolean,
    errorMessage?: string,
  ): ProbeOutcome {
    const status: MintHealthStatus = {
      url: mintUrl,
      isOnline,
      lastChecked: Date.now(),
      responseTimeMs: Date.now() - startedAt,
      checkMethod: 'http',
      ...(errorMessage ? { errorMessage } : {}),
    }
    this.mirror.set(mintUrl, status)
    return { status, info: null }
  }
}
